import { createHash } from 'node:crypto';
import { callProvider } from './providers.js';
import { AiError } from './errors.js';
import type { Availability } from './resolve.js';
import { aiCacheKey, type AiCacheValue } from './store.js';
import { summarySystem, summaryUserMessage, DEFAULT_SUMMARY_RATIO } from './prompts.js';
import { splitLangLine } from './lang.js';
import { htmlToText, countWords } from './text.js';
import { runWithFallback, SUMMARY_DEADLINE_MS } from './attempt.js';
import { shareInflight, inflightKey } from './inflight.js';

export { SUMMARY_DEADLINE_MS };
export const MIN_WORDS = 40;

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
 * Spec §6 et §9. Taille de l'article d'abord, puis la boucle commune
 * (`runWithFallback`, `attempt.ts`) : résolution, cache, plafond, appel, repli.
 *
 * - La clé de cache porte un hash du contenu : `articleId` vient du client, sans
 *   lui un utilisateur pourrait lire ou empoisonner le résumé d'un autre.
 */
export async function summarize(req: SummaryRequest, deps: { call?: typeof callProvider; now?: () => number } = {}): Promise<SummaryResponse> {
  const call = deps.call ?? callProvider;
  const now = deps.now ?? Date.now;
  const deadline = now() + SUMMARY_DEADLINE_MS;
  const text = htmlToText(req.html);
  if (countWords(text) < MIN_WORDS) throw new AiError('technical', 'article_too_short');

  // Le titre fait partie du prompt : deux titres pour un même corps sont deux résumés.
  const ratio = req.ratio ?? DEFAULT_SUMMARY_RATIO;
  const contentHash = createHash('sha1').update(`${req.title}\0${text}`).digest('hex').slice(0, 16);

  const generate = async (): Promise<SummaryResponse> => {
    const out = await runWithFallback({
      userId: req.userId, resolution: req.resolution, available: req.available, fallback: req.fallback, deadline, now,
      cacheKeyFor: (cand) => aiCacheKey({ articleId: req.articleId, op: 'summary', providerId: cand.provider.id, model: cand.provider.model, ratio, contentHash }),
      call: async (cand, timeoutMs) => {
        const result = await call(cand.provider, cand.key, { system: summarySystem(ratio), user: summaryUserMessage(req.title, text), timeoutMs });
        return { ...splitLangLine(result.text), model: result.model };
      },
      onSuccess: async (_cand, r) => ({ text: r.text, lang: r.lang }),
    });
    const { cand, fellBackFrom } = out;
    const named = { providerId: cand.provider.id, providerName: cand.provider.name, fellBackFrom };
    if (out.fromCache) {
      const cached = out.result as AiCacheValue;
      return { text: cached.text, lang: cached.lang, ...named, model: cand.provider.model, fromCache: true };
    }
    const r = out.result as { text: string; lang: string | null; model: string };
    return { text: r.text, lang: r.lang, ...named, model: r.model, fromCache: false };
  };

  // Une demande identique à une génération en cours s'y rattache (`inflight.ts`) :
  // même compte, même contenu, même longueur visée, même routage.
  const key = inflightKey(req.userId, 'summary', { articleId: req.articleId, contentHash, ratio, resolution: req.resolution, fallback: req.fallback });
  const { value, shared } = await shareInflight(key, generate);
  return shared ? { ...value, fromCache: true } : value;
}
