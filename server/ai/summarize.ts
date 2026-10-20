import { createHash } from 'node:crypto';
import { callProvider, TIMEOUT_MS } from './providers.js';
import { AiError } from './errors.js';
import { resolveProvider, fallbackOrder, type Availability } from './resolve.js';
import { aiCacheKey, aiCacheGet, aiCacheSet, bumpUsage, refundUsage, dailyCap } from './store.js';
import { summarySystem, summaryUserMessage, DEFAULT_SUMMARY_RATIO } from './prompts.js';
import { splitLangLine } from './lang.js';
import { htmlToText, countWords } from './text.js';

export const MIN_WORDS = 40;
/**
 * Échéance de TOUTE la demande, repli compris. Les candidats s'essaient l'un
 * après l'autre : avec 60 s chacun, un premier fournisseur lent atteignait les
 * 60 s de nginx (504 au client) et le serveur appelait ensuite le suivant —
 * peut-être payant, compté, mis en cache — sans que personne attende. 50 s
 * tiennent sous un reverse proxy réglé par défaut ; le nginx du conteneur en
 * accorde 120 à `/api/`, pour ne jamais couper une demande que le serveur tient
 * encore.
 */
export const SUMMARY_DEADLINE_MS = 50_000;
/** Sous ce reste, un appel n'a aucune chance d'aboutir : on n'en lance plus. */
const MIN_CALL_MS = 2_000;

export interface SummaryRequest {
  userId: number; articleId: string; title: string; html: string;
  resolution: { force?: number | null; feed?: number | null; category?: number | null; preferred?: number | null; adminDefault?: number | null };
  available: Availability[];
  fallback: boolean;
  /** Longueur visée en pour cent de l'article ; validée par la route. */
  ratio?: number;
}
export interface SummaryResponse {
  text: string; lang: string | null; providerId: number; providerName: string; model: string; fromCache: boolean; fellBackFrom?: string;
}

/**
 * Spec §6 et §9. Ordre : taille de l'article, résolution, cache, plafond
 * (clé admin seulement, réservé avant l'appel et rendu s'il échoue), appel,
 * repli (jamais sur `refused`, un seul tour), cache.
 *
 * - Un candidat plafonné est sauté, pas échoué : le repli passe au suivant
 *   (clé de l'utilisateur, fournisseur gratuit) et `fellBackFrom` reste vide.
 * - La clé de cache porte un hash du contenu : `articleId` vient du client, sans
 *   lui un utilisateur pourrait lire ou empoisonner le résumé d'un autre.
 */
export async function summarize(req: SummaryRequest, deps: { call?: typeof callProvider; now?: () => number } = {}): Promise<SummaryResponse> {
  const call = deps.call ?? callProvider;
  const now = deps.now ?? Date.now;
  const deadline = now() + SUMMARY_DEADLINE_MS;
  const text = htmlToText(req.html);
  if (countWords(text) < MIN_WORDS) throw new AiError('technical', 'article_too_short');

  const first = resolveProvider(req.resolution, req.available);
  if (!first) throw new AiError('technical', 'no_provider');
  const candidates = req.fallback ? fallbackOrder(first, req.available) : [first];
  // Le titre fait partie du prompt : deux titres pour un même corps sont deux résumés.
  const ratio = req.ratio ?? DEFAULT_SUMMARY_RATIO;
  const contentHash = createHash('sha1').update(`${req.title}\0${text}`).digest('hex').slice(0, 16);

  let fellBackFrom: string | undefined;
  let lastError: AiError | null = null;
  let capped = false;
  for (const cand of candidates) {
    const key = aiCacheKey({ articleId: req.articleId, op: 'summary', providerId: cand.provider.id, model: cand.provider.model, ratio, contentHash });
    let cached = null;
    try { cached = await aiCacheGet(key); } catch { /* cache illisible = absence */ }
    if (cached) return { ...cached, providerId: cand.provider.id, providerName: cand.provider.name, model: cand.provider.model, fromCache: true, fellBackFrom };

    const remaining = deadline - now();
    if (remaining < MIN_CALL_MS) {
      if (lastError) throw lastError;
      throw new AiError('technical', 'deadline');
    }

    // Réservation AVANT l'appel : lire le compteur puis l'incrémenter après
    // laissait N requêtes simultanées passer toutes la vérification. SQLite
    // incrémente et rend le compte d'un seul geste ; au-delà du plafond, on
    // rend la place et le candidat est plafonné.
    if (cand.paidByAdmin) {
      const cap = dailyCap();
      if (bumpUsage(req.userId) > cap && cap > 0) {
        refundUsage(req.userId);
        if (!req.fallback) throw new AiError('quota', 'ai_daily_cap');
        capped = true;
        console.warn('AI fallback:', cand.provider.name, 'quota', 'daily cap reached');
        continue;
      }
    }

    let result;
    try {
      result = await call(cand.provider, cand.key, {
        system: summarySystem(ratio), user: summaryUserMessage(req.title, text),
        timeoutMs: Math.min(TIMEOUT_MS, remaining),
      });
    } catch (err) {
      // Un appel raté n'est pas payé : la place réservée est rendue.
      if (cand.paidByAdmin) refundUsage(req.userId);
      // Que des chaînes : jamais l'objet d'erreur brut, qui peut porter la requête et ses en-têtes (donc la clé).
      if (!(err instanceof AiError)) console.error('AI provider error:', cand.provider.name, (err as Error)?.name, (err as Error)?.message);
      const e = err instanceof AiError ? err : new AiError('technical', 'provider_error');
      e.ownKey = cand.own;
      if (e.kind === 'refused' || !req.fallback) throw e;
      // Sans cette ligne, une bascule rattrapée ne laisse aucune trace : une coupure
      // réseau vers Ollama a ainsi basculé vers Claude (payant) sans rien dire.
      // Chaînes seulement ; le message est déjà masqué (clé) et coupé par l'adaptateur.
      console.warn('AI fallback:', cand.provider.name, e.kind, e.message);
      lastError = e;
      fellBackFrom = fellBackFrom ?? cand.provider.name;
      continue;
    }
    // Le résultat est payé (et déjà compté par la réservation) : le cache ne doit pas le faire passer pour un échec du fournisseur.
    const { lang, text: body } = splitLangLine(result.text);
    try { await aiCacheSet(key, { text: body, lang }); } catch { /* le résumé est servi, il ne sera juste pas mis en cache */ }
    return { text: body, lang, providerId: cand.provider.id, providerName: cand.provider.name, model: result.model, fromCache: false, fellBackFrom };
  }
  if (lastError) throw lastError;
  throw new AiError(capped ? 'quota' : 'technical', capped ? 'ai_daily_cap' : 'no_provider');
}
