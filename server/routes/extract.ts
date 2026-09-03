import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import { fetchUpstream, finishError, proxyRateLimit, redactUrl, targetAllowedLiteral } from './proxy.js';
import { cacheEnabled, cacheGet, cacheSet, extractKey } from '../cache.js';
import { extractArticle } from '../extract.js';

const router = Router();

/**
 * Taille maximale du corps téléchargé avant analyse.
 *
 * `upstream.text()` mettait le corps entier dans une chaîne JS, sans plafond :
 * une URL publique quelconque suffisait à faire avaler plusieurs Go au seul
 * processus Node qui sert toute l'instance, puis à les passer à linkedom et
 * Readability. Une page d'article très riche pèse quelques centaines de Ko ;
 * 5 Mo laisse dix fois la marge et ferme la porte.
 */
const MAX_HTML_BYTES = 5_000_000;

/**
 * Temps maximal passé à lire le corps, en-têtes déjà reçus.
 *
 * Le minuteur de `fetchUpstream` est désarmé dès l'arrivée des en-têtes : il
 * couvre l'établissement de la connexion, pas le corps. Sans ce second
 * plafond, un serveur qui distille son corps octet par octet garde le
 * gestionnaire et la socket indéfiniment. 20 s est très au-dessus du temps de
 * transfert d'un article réel.
 */
const BODY_TIMEOUT_MS = 20_000;

/** Types de contenu dont il y a un article à extraire. */
const HTML_TYPES = /^(text\/html|application\/xhtml\+xml)\b/i;

/** Plafond dépassé : échec ordinaire, le client se replie sur son extracteur. */
class BodyTooLargeError extends Error {}

/**
 * Un dépassement de délai porte le nom qu'`AbortError` porte ailleurs, pour
 * que `finishError` le classe en 504 comme n'importe quel délai amont.
 */
function abortError(): Error {
  return Object.assign(new Error('body read timed out'), { name: 'AbortError' });
}

/**
 * Lit le corps d'une réponse en bornant les octets ET la durée.
 *
 * Le flux est annulé dès qu'une borne est atteinte : la socket est rendue,
 * plutôt que gardée le temps que l'amont daigne finir.
 *
 * Exportée pour être testable avec des bornes minuscules — les vraies valeurs
 * rendraient le test du délai insupportablement lent.
 */
export async function readBoundedText(resp: Response, maxBytes: number, timeoutMs: number): Promise<string> {
  // Réponse sans flux (204, ou un double de test minimal) : rien à borner.
  if (!resp.body) return await resp.text();

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    reader.cancel().catch(() => {});
  }, timeoutMs);

  try {
    let total = 0;
    let out = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new BodyTooLargeError();
        }
        out += decoder.decode(value, { stream: true });
      }
    } catch (err) {
      // L'annulation par le minuteur termine la lecture en cours — selon
      // l'implémentation par un `done`, ou par un rejet. Les deux sont le même
      // événement, et doivent donner le même verdict.
      if (!timedOut || err instanceof BodyTooLargeError) throw err;
    }
    // Sans ce contrôle, un corps tronqué par le minuteur passerait pour un
    // corps complet — et Readability extrairait un demi-article.
    if (timedOut) throw abortError();
    return out + decoder.decode();
  } finally {
    clearTimeout(timer);
  }
}

// L'authentification d'abord, la cadence ensuite : la clé du seau est
// l'identifiant de l'utilisateur, pas son IP.
router.use(requireAuth);

// Même plafond que `/api/proxy`, même variable d'environnement, même forme :
// l'extraction d'article est le plus gros consommateur de ce budget et migre
// du proxy vers cette route. La laisser sans plafond — ou lui en inventer un
// second — reviendrait à rendre la protection documentée contournable en
// changeant d'URL.
const EXTRACT_RATE_LIMIT = proxyRateLimit();
if (EXTRACT_RATE_LIMIT > 0) {
  router.use(rateLimit({
    windowMs: 60_000,
    max: EXTRACT_RATE_LIMIT,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.user.id),
    message: { error: 'Too many proxied requests, please slow down' },
  }));
}

router.get('/', async (req, res) => {
  const url = typeof req.query.url === 'string' ? req.query.url : '';
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Missing url' });
  // Pré-contrôle littéral, comme le proxy : la garde réelle (résolution DNS,
  // et à chaque saut de redirection) reste dans `fetchUpstream`.
  if (!targetAllowedLiteral(url)) {
    console.warn('Extract error:', 'blocked target →', redactUrl(url));
    return res.status(403).json({ error: 'Target host not allowed' });
  }

  const key = cacheEnabled ? extractKey(url) : null;
  if (key) {
    const hit = await cacheGet(key);
    if (hit != null) {
      res.set('X-From-Cache', '1');
      res.set('Content-Type', 'application/json');
      return res.send(hit);
    }
  }

  let html: string;
  try {
    // `fetchUpstream` et pas `fetch` : c'est lui qui porte la garde anti-SSRF
    // et les réécritures PROXY_REWRITES. Un appel direct rouvrirait la porte
    // que le proxy ferme.
    const upstream = await fetchUpstream(url, { headers: { Accept: 'text/html' } });
    if (!upstream.ok) return res.status(502).json({ error: 'Upstream request failed' });
    // Le type est vérifié AVANT de lire quoi que ce soit : une vidéo ou un PDF
    // n'a pas d'article à extraire, et n'a donc aucune raison d'être avalé.
    const ctype = upstream.headers.get('content-type') || '';
    if (!HTML_TYPES.test(ctype)) {
      upstream.body?.cancel().catch(() => {});
      return res.status(415).json({ error: 'Unsupported content type' });
    }
    html = await readBoundedText(upstream, MAX_HTML_BYTES, BODY_TIMEOUT_MS);
  } catch (err) {
    // Dépassement de taille : échec ordinaire, le client se replie. Le reste
    // (cible refusée, délai, panne amont) est classé exactement comme sur
    // `/api/proxy` — deux routes ne doivent pas décrire le même échec de deux
    // façons.
    if (err instanceof BodyTooLargeError) {
      return res.status(502).json({ error: 'Upstream response too large' });
    }
    return finishError(res, err, url, 'Extract error:');
  }

  const article = extractArticle(url, html);
  // Pas d'article lisible : on le dit, et le client extrait de son côté. Un
  // corps vide renvoyé en 200 le priverait de son repli.
  if (!article) return res.status(422).json({ error: 'Not extractable' });

  const body = JSON.stringify(article);
  // Écriture au mieux : un Redis en panne ne doit pas priver le client de sa
  // réponse, qui est déjà calculée.
  if (key) cacheSet(key, body).catch(() => {});
  res.set('Content-Type', 'application/json');
  res.send(body);
});

export default router;
