// server/ai/summarize.ts
import { callProvider } from './providers.js';
import { AiError } from './errors.js';
import { resolveProvider, fallbackOrder, type Availability } from './resolve.js';
import { aiCacheKey, aiCacheGet, aiCacheSet, usageToday, bumpUsage, dailyCap } from './store.js';
import { SUMMARY_SYSTEM } from './prompts.js';
import { splitLangLine } from './lang.js';
import { htmlToText } from './text.js';

export const MIN_WORDS = 40;

export interface SummaryRequest {
  userId: number; articleId: string; title: string; html: string;
  resolution: { force?: number | null; feed?: number | null; category?: number | null; preferred?: number | null; adminDefault?: number | null };
  available: Availability[];
  fallback: boolean;
}
export interface SummaryResponse {
  text: string; lang: string | null; providerId: number; providerName: string; model: string; fromCache: boolean; fellBackFrom?: string;
}

/**
 * Spec §6 et §9. Ordre : taille de l'article, résolution, cache, plafond
 * (clé admin seulement), appel, repli (jamais sur `refused`, un seul tour),
 * usage, cache.
 */
export async function summarize(req: SummaryRequest, deps: { call?: typeof callProvider } = {}): Promise<SummaryResponse> {
  const call = deps.call ?? callProvider;
  const text = htmlToText(req.html);
  if (text.split(/\s+/).filter(Boolean).length < MIN_WORDS) throw new AiError('technical', 'article_too_short');

  const first = resolveProvider(req.resolution, req.available);
  if (!first) throw new AiError('technical', 'no_provider');
  const candidates = req.fallback ? fallbackOrder(first, req.available) : [first];

  let fellBackFrom: string | undefined;
  let lastError: AiError | null = null;
  for (const cand of candidates) {
    const key = aiCacheKey({ articleId: req.articleId, op: 'summary', providerId: cand.provider.id });
    const cached = await aiCacheGet(key);
    if (cached) return { ...cached, providerId: cand.provider.id, providerName: cand.provider.name, model: cand.provider.model, fromCache: true, fellBackFrom };

    const cap = dailyCap();
    if (cand.paidByAdmin && cap > 0 && usageToday(req.userId) >= cap) throw new AiError('quota', 'ai_daily_cap');

    try {
      const result = await call(cand.provider, cand.key, { system: SUMMARY_SYSTEM, user: `Title: ${req.title}\n\n${text}` });
      if (cand.paidByAdmin) bumpUsage(req.userId);
      const { lang, text: body } = splitLangLine(result.text);
      await aiCacheSet(key, { text: body, lang });
      return { text: body, lang, providerId: cand.provider.id, providerName: cand.provider.name, model: result.model, fromCache: false, fellBackFrom };
    } catch (err) {
      if (!(err instanceof AiError)) throw new AiError('technical', (err as Error).message);
      if (err.kind === 'refused' || !req.fallback) throw err;
      lastError = err;
      fellBackFrom = fellBackFrom ?? cand.provider.name;
    }
  }
  throw lastError ?? new AiError('technical', 'no_provider');
}
