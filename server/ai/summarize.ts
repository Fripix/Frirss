import { createHash } from 'node:crypto';
import { callProvider } from './providers.js';
import { AiError } from './errors.js';
import { resolveProvider, fallbackOrder, type Availability } from './resolve.js';
import { aiCacheKey, aiCacheGet, aiCacheSet, usageToday, bumpUsage, dailyCap } from './store.js';
import { SUMMARY_SYSTEM } from './prompts.js';
import { splitLangLine } from './lang.js';
import { htmlToText, countWords } from './text.js';

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
 *
 * - Un candidat plafonné est sauté, pas échoué : le repli passe au suivant
 *   (clé de l'utilisateur, fournisseur gratuit) et `fellBackFrom` reste vide.
 * - La clé de cache porte un hash du contenu : `articleId` vient du client, sans
 *   lui un utilisateur pourrait lire ou empoisonner le résumé d'un autre.
 */
export async function summarize(req: SummaryRequest, deps: { call?: typeof callProvider } = {}): Promise<SummaryResponse> {
  const call = deps.call ?? callProvider;
  const text = htmlToText(req.html);
  if (countWords(text) < MIN_WORDS) throw new AiError('technical', 'article_too_short');

  const first = resolveProvider(req.resolution, req.available);
  if (!first) throw new AiError('technical', 'no_provider');
  const candidates = req.fallback ? fallbackOrder(first, req.available) : [first];
  const contentHash = createHash('sha1').update(text).digest('hex').slice(0, 16);

  let fellBackFrom: string | undefined;
  let lastError: AiError | null = null;
  let capped = false;
  for (const cand of candidates) {
    const key = aiCacheKey({ articleId: req.articleId, op: 'summary', providerId: cand.provider.id, contentHash });
    let cached = null;
    try { cached = await aiCacheGet(key); } catch { /* cache illisible = absence */ }
    if (cached) return { ...cached, providerId: cand.provider.id, providerName: cand.provider.name, model: cand.provider.model, fromCache: true, fellBackFrom };

    const cap = dailyCap();
    if (cand.paidByAdmin && cap > 0 && usageToday(req.userId) >= cap) {
      if (!req.fallback) throw new AiError('quota', 'ai_daily_cap');
      capped = true;
      continue;
    }

    let result;
    try {
      result = await call(cand.provider, cand.key, { system: SUMMARY_SYSTEM, user: `Title: ${req.title}\n\n${text}` });
    } catch (err) {
      const e = err instanceof AiError ? err : new AiError('technical', 'provider_error');
      if (e.kind === 'refused' || !req.fallback) throw e;
      lastError = e;
      fellBackFrom = fellBackFrom ?? cand.provider.name;
      continue;
    }
    // Le résultat est payé : ni l'usage ni le cache ne doivent le perdre ou le faire passer pour un échec du fournisseur.
    if (cand.paidByAdmin) bumpUsage(req.userId);
    const { lang, text: body } = splitLangLine(result.text);
    try { await aiCacheSet(key, { text: body, lang }); } catch { /* le résumé est servi, il ne sera juste pas mis en cache */ }
    return { text: body, lang, providerId: cand.provider.id, providerName: cand.provider.name, model: result.model, fromCache: false, fellBackFrom };
  }
  if (lastError) throw lastError;
  throw new AiError(capped ? 'quota' : 'technical', capped ? 'ai_daily_cap' : 'no_provider');
}
