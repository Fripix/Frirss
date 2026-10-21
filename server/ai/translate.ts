import { createHash } from 'node:crypto';
import { callProvider, TIMEOUT_MS, type AiCall } from './providers.js';
import { AiError } from './errors.js';
import type { Availability, ResolutionInput } from './resolve.js';
import { aiCacheKey, type AiCacheValue } from './store.js';
import { translateSystem, translateUserMessage, parseTranslation } from './prompts.js';
import { runWithFallback, SUMMARY_DEADLINE_MS, MIN_CALL_MS } from './attempt.js';
import { sameLanguage, type AiLanguage } from './languages.js';

/** Un lot d'environ 1 200 mots rend ~2 000 jetons ; Anthropic exige un plafond, on lui laisse de la marge. */
const ANTHROPIC_MAX_TOKENS = 8192;

export interface TranslateRequest {
  userId: number; articleId: string; scope: 'summary' | 'article'; targetLang: AiLanguage; segments: string[];
  resolution: ResolutionInput & { translation?: number | null };
  available: Availability[];
  fallback: boolean;
}
export interface TranslateResponse {
  segments: string[]; lang: string | null; same: boolean; providerId: number; providerName: string; model: string; fromCache: boolean; fellBackFrom?: string;
}

interface Translated { lang: string | null; same: boolean; segments: string[]; model: string }

/** Valeur de cache : `text` porte le lot en JSON, `lang` la langue source. */
function decodeCached(v: AiCacheValue, count: number): Pick<Translated, 'same' | 'segments'> {
  try {
    const d = JSON.parse(v.text) as { same?: unknown; segments?: unknown };
    if (d.same === true) return { same: true, segments: [] };
    if (Array.isArray(d.segments) && d.segments.length === count && d.segments.every((s) => typeof s === 'string')) {
      return { same: false, segments: d.segments as string[] };
    }
  } catch { /* illisible : traité comme une réponse inexploitable */ }
  throw new AiError('technical', 'segments');
}

/**
 * Spec §17.3. **Un lot = un appel** (le client découpe en lots) : une unité de
 * plafond, une entrée de cache, la même échéance de 50 s que le résumé.
 *
 * - Format strict `<s n="N">…</s>` : un segment absent, en double ou en trop
 *   invalide le lot, **rejoué une fois** sur le même fournisseur si l'échéance
 *   le permet (même réservation : c'est le même lot), sinon `technical`
 *   « segments » — et le repli peut passer au suivant.
 * - `same` (source déjà dans la langue cible) : `{ segments: [], same: true }`,
 *   mis en cache comme tel. Une langue source annoncée égale à la cible
 *   (`sameLanguage`) vaut `same` même si le modèle a traduit quand même.
 * - La clé de cache porte la langue cible et un hash du scope et des segments :
 *   `articleId` vient du client, comme pour le résumé.
 */
export async function translate(req: TranslateRequest, deps: { call?: typeof callProvider; now?: () => number } = {}): Promise<TranslateResponse> {
  const call = deps.call ?? callProvider;
  const now = deps.now ?? Date.now;
  const deadline = now() + SUMMARY_DEADLINE_MS;
  const count = req.segments.length;
  const contentHash = createHash('sha1').update(JSON.stringify([req.scope, req.segments])).digest('hex').slice(0, 16);
  const system = translateSystem(req.targetLang);
  const user = translateUserMessage(req.segments);

  const out = await runWithFallback<Translated>({
    userId: req.userId, resolution: req.resolution, available: req.available, fallback: req.fallback, deadline, now,
    cacheKeyFor: (cand) => aiCacheKey({ articleId: req.articleId, op: 'translate', providerId: cand.provider.id, model: cand.provider.model, lang: req.targetLang, contentHash }),
    call: async (cand, timeoutMs) => {
      const opts: AiCall = { system, user, timeoutMs, ...(cand.provider.type === 'anthropic' ? { maxTokens: ANTHROPIC_MAX_TOKENS } : {}) };
      let result = await call(cand.provider, cand.key, opts);
      let parsed = parseTranslation(result.text, count);
      if (!parsed.same && !parsed.segments) {
        const remaining = deadline - now();
        if (remaining < MIN_CALL_MS) throw new AiError('technical', 'segments');
        result = await call(cand.provider, cand.key, { ...opts, timeoutMs: Math.min(TIMEOUT_MS, remaining) });
        parsed = parseTranslation(result.text, count);
        if (!parsed.same && !parsed.segments) throw new AiError('technical', 'segments');
      }
      // Un petit modèle peut annoncer « lang: fr » puis traduire du français
      // en français malgré la consigne : la langue annoncée fait foi.
      if (sameLanguage(parsed.lang, req.targetLang)) return { lang: parsed.lang, same: true, segments: [], model: result.model };
      return { lang: parsed.lang, same: parsed.same, segments: parsed.segments ?? [], model: result.model };
    },
    onSuccess: async (_cand, r) => ({ text: JSON.stringify({ same: r.same, segments: r.segments }), lang: r.lang }),
  });
  const { cand, fellBackFrom } = out;
  const named = { providerId: cand.provider.id, providerName: cand.provider.name, fellBackFrom };
  if (out.fromCache) {
    const cached = out.result as AiCacheValue;
    return { ...decodeCached(cached, count), lang: cached.lang, ...named, model: cand.provider.model, fromCache: true };
  }
  const r = out.result as Translated;
  return { segments: r.segments, lang: r.lang, same: r.same, ...named, model: r.model, fromCache: false };
}
