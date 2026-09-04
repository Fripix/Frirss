import { Readability } from '@mozilla/readability';
import DOMPurify from 'dompurify';
import { useAuthStore } from '../stores/authStore';
import { dropNonVideoIframes } from '../lib/youtube';

export interface ExtractedContent {
  title: string;
  content: string;
  excerpt: string;
  byline: string;
  siteName: string;
  length: number;
}

/**
 * Assainit le HTML d'un article extrait.
 *
 * Plus permissif que `sanitizeHtml()` sur un seul point, et ce point est
 * obligatoire : les <iframe> doivent survivre, sans quoi une vidéo intégrée à
 * un article extrait disparaîtrait avant qu'`injectVideoFacades` (appelé au
 * rendu, dans `ReadingPane`) puisse la transformer en façade.
 *
 * Cette permission est refermée aussitôt sur les seules vidéos que la façade
 * sait lire. Ce qu'elle laissait passer avant n'atteignait pas l'écran —
 * `ReadingPane` repasse tout par `sanitizeHtml`, qui supprime les iframes —
 * mais le résultat est ARCHIVÉ tel quel dans IndexedDB (`putExtract`), donc
 * l'innocuité ne tenait qu'au fait que chaque consommateur pense à réassainir.
 * Un stockage qui correspond au contrat d'affichage ne dépend de personne.
 */
export function sanitizeExtracted(html: string): string {
  return dropNonVideoIframes(DOMPurify.sanitize(html, {
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['allow', 'allowfullscreen'],
    ALLOW_DATA_ATTR: false,
  }));
}

/**
 * Délai au-delà duquel la route serveur est abandonnée au profit du repli.
 *
 * Sans minuteur, un serveur qui accepte la connexion et ne répond jamais tient
 * l'extraction indéfiniment. Six appelants, dont quatre sont des files
 * strictement séquentielles — `warmRunner`, `warmOfflineCache` et
 * `prepareOffline` (`src/stores/feedStore.ts`) et le préchargement N+1…N+10 du
 * volet de lecture (`ReadingPane.tsx`) — où un seul article bloqué bloque tout
 * ce qui le suit. Les deux autres sont des appels uniques :
 * `revalidateIfStale` (`src/lib/extractCache.ts`), lancé sans être attendu, et
 * `handleExtract` (`ReadingPane`), celui du bouton — où le blocage ne coûte
 * rien à une file, mais laisse « Article complet » sur « Extraction… » sans
 * erreur ni sortie.
 *
 * **Le chiffre est celui de la patience d'un lecteur, pas celui d'un budget
 * serveur.** Une version antérieure affirmait que 25 s se posait « juste
 * au-dessus du plafond de corps du serveur (20 s) », donc qu'une page en cours
 * de lecture n'était jamais abandonnée : c'était faux. Le budget réel du
 * serveur additionne la résolution pré-cache (≤ 5 s, `LOOKUP_TIMEOUT_MS`), les
 * en-têtes (≤ 30 s par saut, `TIMEOUT_MS`) et le corps (≤ 20 s,
 * `BODY_TIMEOUT_MS`) — au moins 55 s sans redirection. Une page dont les
 * en-têtes arrivent à 8 s et dont le corps se déroule 18 s aboutissait côté
 * serveur vers 26 s, après que le client l'eut abandonnée. Aucun délai client
 * tenable ne couvre ce budget : le placer au-dessus reviendrait à laisser un
 * lecteur devant « Extraction… » pendant une minute.
 *
 * Ce que ce chiffre achète, donc : au bout de 20 s la personne a déjà tourné
 * la page, et il vaut mieux lui rendre le texte que son propre navigateur sait
 * extraire. Ce qu'il coûte, assumé : sur une page vraiment lente, le repli
 * repart chercher la MÊME origine, soit deux requêtes chez elle pour cet
 * article-là — c'est déjà le coût connu d'un repli sur 415, 422 ou 502.
 * L'extraction serveur, elle, va au bout et remplit le cache : le prochain
 * appareil, lui, sera servi tout de suite.
 *
 * `AbortController` explicite plutôt qu'`AbortSignal.timeout()` : c'est ce qui
 * rend le délai pilotable par les faux minuteurs, donc testable sans faire
 * attendre la suite de tests vingt secondes.
 */
export const SERVER_EXTRACT_TIMEOUT_MS = 20_000;

/**
 * Délai du repli — la page récupérée par `/api/proxy` puis lue par le
 * navigateur.
 *
 * Cette jambe-là n'avait AUCUN minuteur, et c'est ce qui vidait le précédent
 * de son sens : la panne qu'il vise (un backend qui accepte la connexion et ne
 * répond jamais) frappe `/api/proxy` exactement comme `/api/extract`. Le blocage
 * ne disparaissait donc pas, il se décalait d'une route — la file séquentielle
 * restait bloquée pour toujours, juste une ligne plus bas.
 *
 * Même valeur que la jambe serveur, pour la même raison (la patience du
 * lecteur). Ce que cela borne, mesuré et non estimé : **~40 s** quand les deux
 * jambes se taisent, et **~100 s** au vrai pire cas — l'attente honorée après
 * un 429 (60 s au plafond, `RATE_LIMIT_MAX_WAIT_MS`) s'ajoute alors aux deux
 * budgets. C'est ce qu'un seul article peut coûter à la file avant qu'elle
 * passe au suivant ; un test à faux minuteurs fixe le chiffre.
 *
 * Le signal couvre AUSSI la lecture du corps : un amont qui distille sa page
 * octet par octet passerait sinon entre les mailles, le minuteur ayant été
 * désarmé à l'arrivée des en-têtes.
 */
export const FALLBACK_EXTRACT_TIMEOUT_MS = 20_000;

/**
 * Attente maximale honorée après un 429 du backend.
 *
 * Le seau de cadence (`FRIRSS_PROXY_RATE_LIMIT`, 600/min par compte) est
 * PARTAGÉ par `/api/extract`, `/api/proxy` et le préchargement d'images. Depuis
 * que la route serveur répond à la vitesse de Redis, un second appareil peut
 * balayer `prepareOffline` bien plus vite qu'au temps où chaque article coûtait
 * une extraction complète, et atteindre le plafond. Sans ce qui suit, l'article
 * était simplement absent du jeu hors ligne, en silence (`feedStore` avale
 * l'échec) — le genre de défaut qui ne se découvre que dans l'avion.
 *
 * On honore donc `Retry-After` une fois plutôt que d'abandonner l'article, ce
 * qui cadence le balayage au lieu de le trouer. Le plafond d'une minute est
 * celui de la fenêtre du seau : au-delà, ce n'est plus une attente, c'est une
 * panne.
 *
 * ⚠️ **Ce que cela ne couvre PAS, et il faut le dire exactement.** L'attente
 * n'a lieu que si la réponse annonce un délai exploitable. Sans en-tête
 * `Retry-After`, avec un en-tête illisible, ou au-delà du plafond,
 * `retryAfterMs` rend `null` : il n'y a alors ni attente ni repli, et
 * `extractFullContent` lève `RateLimitedError` — que `feedStore` avale, donc
 * l'article est bel et bien absent du passage, en silence. Idem si le second
 * essai revient en 429. En pratique la fenêtre du seau est d'une minute et
 * `express-rate-limit` émet toujours un `Retry-After` inférieur ou égal à 60,
 * donc le cas courant est couvert — mais « on ne perd pas l'article » reste
 * faux comme énoncé général : c'est « on ne le perd pas quand le serveur dit
 * quand revenir », et le passage suivant le reprendra puisque rien n'a été mis
 * en cache.
 *
 * Et sur un 429 on ne se replie PAS sur `/api/proxy` : c'est le même seau, donc
 * un échec certain et un jeton gaspillé. Le refus tient même si la seconde
 * tentative échoue — voir le drapeau `rateLimited` plus bas.
 */
export const RATE_LIMIT_MAX_WAIT_MS = 60_000;

/** Le backend a refusé la cadence, et l'attente n'a pas suffi. */
export class RateLimitedError extends Error {
  constructor() { super('RATE_LIMITED'); this.name = 'RateLimitedError'; }
}

/** Exécute `run` sous un signal d'abandon armé pour `timeoutMs`. */
async function withTimeout<T>(timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Délai d'attente annoncé par un 429, en millisecondes, ou `null` si la
 * réponse n'en annonce aucun exploitable.
 *
 * `Retry-After` en secondes (ce qu'émet `express-rate-limit`) ou en date HTTP.
 * Une valeur négative devient zéro, une valeur au-delà du plafond est refusée
 * plutôt que tronquée : attendre moins que demandé, c'est retomber sur un 429.
 */
export function retryAfterMs(headers: Headers, now = Date.now()): number | null {
  const raw = headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw.trim());
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - now;
  if (!Number.isFinite(ms)) return null;
  if (ms > RATE_LIMIT_MAX_WAIT_MS) return null;
  return Math.max(0, ms);
}

/**
 * Fetch the full article content from its original URL,
 * parse it with Mozilla Readability, and sanitize with DOMPurify.
 *
 * Returns { title, content, excerpt, byline, siteName, length } or throws.
 */
export async function extractFullContent(url: string): Promise<ExtractedContent> {
  const { backendToken } = useAuthStore.getState();

  // Le serveur fait autorité quand il répond : il extrait une fois pour toute
  // l'instance et, quand Redis est là, partage le résultat entre appareils et
  // entre comptes. Toute réponse absente, en erreur, trop lente ou illisible
  // fait tomber sur l'extraction locale ci-dessous, qui reste le filet — la
  // route peut manquer (serveur plus ancien), refuser la page (415, 422) ou
  // échouer à la joindre (502, 504).
  //
  // Ce repli ne couvre PAS l'absence de Redis : sans cache, la route extrait
  // quand même et répond 200 — elle ne garde simplement rien, et le prochain
  // appareil repaiera l'extraction.
  //
  // Le HTML rendu par la route est BRUT, délibérément : `createDOMPurify` sur
  // `linkedom` ne filtre rien (pas de `NodeFilter`, donc DOMPurify bascule sans
  // bruit en mode « environnement non supporté » et rend l'entrée telle
  // quelle). C'est donc ICI qu'il est assaini, avant d'être rendu à l'appelant
  // et donc avant d'être archivé dans IndexedDB (`putExtract`) : sauter cette
  // étape publie une XSS stockée, atteignable depuis n'importe quel flux dont
  // la page d'origine porte un `onclick` ou un `onerror`.
  const auth: Record<string, string> = backendToken ? { Authorization: `Bearer ${backendToken}` } : {};

  // Une tentative, bornée : le contenu quand la route répond utilement, le
  // marqueur `RATE_LIMITED` sur un 429, `null` dans tous les autres cas (repli).
  const RATE_LIMITED = Symbol('rate-limited');
  const askServer = () => withTimeout(SERVER_EXTRACT_TIMEOUT_MS, async (signal) => {
    const served = await fetch(`/api/extract?url=${encodeURIComponent(url)}`, { headers: auth, signal });
    if (served.status === 429) return { limited: RATE_LIMITED, wait: retryAfterMs(served.headers) } as const;
    if (!served.ok) return null;
    const data = (await served.json()) as Partial<ExtractedContent>;
    // Champ par champ, exactement comme le chemin local plus bas. Un
    // `{ ...data }` recopierait dans IndexedDB (`putExtract`) toute clé que
    // la route viendrait à ajouter, et laisserait passer un `title` absent —
    // `ExtractRecord extends ExtractedContent` ne vaudrait alors que ce que
    // vaut le JSON reçu.
    if (data && typeof data.content === 'string' && data.content) {
      return {
        title: data.title || '',
        content: sanitizeExtracted(data.content),
        excerpt: data.excerpt || '',
        byline: data.byline || '',
        siteName: data.siteName || '',
        length: data.length || 0,
      };
    }
    return null;
  });

  // Le drapeau est posé dès le PREMIER 429 et il survit à l'échec de la
  // seconde tentative : sans cela, une seconde tentative qui LÈVE — abandon au
  // bout de `SERVER_EXTRACT_TIMEOUT_MS`, panne réseau — était avalée par le
  // `catch` du repli, et `/api/proxy` recevait la requête que ce chemin existe
  // justement pour éviter. Seule une seconde réponse qui n'est PLUS un 429 le
  // lève : le seau a laissé passer, le navigateur peut retenter sa chance.
  let rateLimited = false;
  try {
    let served = await askServer();
    if (served && 'limited' in served) {
      rateLimited = true;
      // Cadence dépassée : on attend ce que le backend demande, une fois,
      // plutôt que de laisser tomber l'article — voir `RATE_LIMIT_MAX_WAIT_MS`.
      // Sans délai exploitable (`retryAfterMs` rend alors `null`), il n'y a
      // rien à attendre : l'article est abandonné pour ce passage.
      if (served.wait != null) {
        const wait = served.wait;
        await new Promise((resolve) => setTimeout(resolve, wait));
        served = await askServer();
        rateLimited = !!(served && 'limited' in served);
      }
    }
    if (served && !('limited' in served)) return served;
  } catch { /* repli */ }

  // Le seau est partagé avec `/api/proxy` : y aller après un 429 est un échec
  // certain, doublé d'un jeton gaspillé.
  if (rateLimited) throw new RateLimitedError();

  // Fetch through the same-origin backend proxy (avoids CORS; the target is
  // passed in a header, auth via the FriRSS JWT).
  //
  // Borné lui aussi (`FALLBACK_EXTRACT_TIMEOUT_MS`) : un backend coincé coince
  // cette route-ci exactement comme la précédente, et ne minuter que la
  // première ne faisait que déplacer le blocage d'une ligne.
  const html = await withTimeout(FALLBACK_EXTRACT_TIMEOUT_MS, async (signal) => {
    const response = await fetch('/api/proxy', {
      headers: {
        'X-Proxy-Target': url,
        'X-Proxy-Accept': 'text/html',
        ...auth,
      },
      signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // Le corps est lu SOUS le signal : sans cela le minuteur retomberait à
    // l'arrivée des en-têtes, et une page distillée octet par octet tiendrait
    // encore la file.
    return await response.text();
  });

  // Parse into a DOM document that Readability can work with
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Resolve relative URLs in the parsed document
  const base = doc.createElement('base');
  base.href = url;
  doc.head.prepend(base);

  // Extract readable content
  const reader = new Readability(doc, {
    charThreshold: 50,
  });
  const result = reader.parse();

  if (!result || !result.content) {
    throw new Error('NO_CONTENT');
  }

  const cleanContent = sanitizeExtracted(result.content);

  return {
    title: result.title || '',
    content: cleanContent,
    excerpt: result.excerpt || '',
    byline: result.byline || '',
    siteName: result.siteName || '',
    length: result.length || 0,
  };
}
