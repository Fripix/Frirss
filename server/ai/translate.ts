import { createHash } from 'node:crypto';
import { callProvider, type AiCall } from './providers.js';
import { AiError } from './errors.js';
import type { Availability, ResolutionInput } from './resolve.js';
import { aiCacheKey, type AiCacheValue } from './store.js';
import { translateSystem, translateUserMessage, translateNotSameHint, parseTranslation } from './prompts.js';
import { runWithFallback, MIN_CALL_MS } from './attempt.js';
import { shareInflight, inflightKey } from './inflight.js';
import { sameLanguage, type AiLanguage } from './languages.js';
import { segmentWordCount, isEcho } from './text.js';
import { textFitsLanguage } from './script.js';

/** Un lot d'environ 1 200 mots rend ~2 000 jetons ; Anthropic exige un plafond, on lui laisse de la marge. */
const ANTHROPIC_MAX_TOKENS = 8192;

export interface TranslateRequest {
  userId: number; articleId: string; scope: 'summary' | 'article'; targetLang: AiLanguage; segments: string[];
  resolution: ResolutionInput & { translation?: number | null };
  available: Availability[];
  fallback: boolean;
  /** « Régénérer » / « Retraduire » : ni cache lu, ni génération en cours partagée ; le résultat remplace le cache. */
  regenerate?: boolean;
  /**
   * Rejeu d'une traduction déjà montrée : le cache serveur seulement. Jamais
   * d'appel, jamais d'unité de plafond, et pas de génération partagée (un rejeu
   * ne doit ni en créer une ni s'y rattacher : un vrai appel qui s'y joindrait
   * recevrait `not_cached`). Sans entrée : `technical` « not_cached ».
   */
  cacheOnly?: boolean;
}
export interface TranslateResponse {
  segments: string[]; lang: string | null; same: boolean; providerId: number; providerName: string; model: string; fromCache: boolean; fellBackFrom?: string;
}

/**
 * Échéance d'un lot, proportionnelle à son nombre de mots : la sortie d'une
 * traduction est aussi longue que son entrée, et les 50 s du résumé ne
 * suffisaient pas à un Ollama local sur un lot de 1 200 mots (502 « timeout »,
 * sans repli : l'échéance était déjà dépensée). Rien de propre à un
 * fournisseur, rien à régler. Un lot court a moins que les 50 s du résumé, et
 * c'est voulu (un résumé traduit, une centaine de mots : ~40 s). Plafond 110 s : le nginx du conteneur accorde
 * 120 s à `/api/` (`proxy_read_timeout`), on garde 10 s de marge.
 */
export const TRANSLATE_DEADLINE_BASE_MS = 30_000;
export const TRANSLATE_DEADLINE_PER_WORD_MS = 75;
export const TRANSLATE_DEADLINE_MAX_MS = 110_000;

export function translateDeadlineMs(words: number): number {
  return Math.min(TRANSLATE_DEADLINE_MAX_MS, TRANSLATE_DEADLINE_BASE_MS + TRANSLATE_DEADLINE_PER_WORD_MS * words);
}

/** Réponse inexploitable : erreur finale, sans repli vers le candidat suivant (`AiError.noFallback`). */
const malformed = () => Object.assign(new AiError('technical', 'segments'), { noFallback: true });

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

/** L'entrée de cache dit-elle « déjà dans la cible » ? Illisible : non (elle échouera au décodage). */
function cachedSame(v: AiCacheValue): boolean {
  try {
    return (JSON.parse(v.text) as { same?: unknown }).same === true;
  } catch {
    return false;
  }
}

/**
 * Spec §17.3. **Un lot = un appel** (le client découpe en lots) : une unité de
 * plafond, une entrée de cache, une échéance proportionnelle au lot
 * (`translateDeadlineMs`) pour tous les candidats, repli compris. Le premier
 * appel peut la prendre entière (au-delà des 60 s de `TIMEOUT_MS`) ; le
 * suivant reçoit ce qui reste.
 *
 * - Format strict `<seg n="N">…</seg>` : un segment absent, en double ou en trop
 *   invalide le lot, **rejoué une fois** sur le même fournisseur si l'échéance
 *   le permet (même réservation : c'est le même lot), sinon `technical`
 *   « segments », **sans repli** (`noFallback`) : un Ollama local au contexte
 *   trop court tronque sa sortie, et le candidat suivant pouvait être payant.
 *   Le client rejoue alors le lot coupé en deux (`useArticleTranslation`).
 * - **Écho** (`isEcho`) : des segments recopiés tels quels alors que la langue
 *   source annoncée est connue et n'est pas la cible sont une réponse
 *   inexploitable, même chemin (rejeu, puis « segments » sans repli), jamais
 *   mise en cache.
 * - `same` (source déjà dans la langue cible) : `{ segments: [], same: true }`,
 *   mis en cache comme tel. Une langue source annoncée égale à la cible
 *   (`sameLanguage`) vaut `same` même si le modèle a traduit quand même.
 * - La clé de cache porte la langue cible et un hash du scope et des segments :
 *   `articleId` vient du client, comme pour le résumé.
 */
export async function translate(req: TranslateRequest, deps: { call?: typeof callProvider; now?: () => number } = {}): Promise<TranslateResponse> {
  const call = deps.call ?? callProvider;
  const now = deps.now ?? Date.now;
  const budget = translateDeadlineMs(req.segments.reduce((n, s) => n + segmentWordCount(s), 0));
  const deadline = now() + budget;
  const count = req.segments.length;
  const contentHash = createHash('sha1').update(JSON.stringify([req.scope, req.segments])).digest('hex').slice(0, 16);
  const system = translateSystem(req.targetLang);
  const user = translateUserMessage(req.segments);
  // Le lot peut-il être déjà dans la langue cible ? Jugé sur son écriture, une fois.
  const sameFits = textFitsLanguage(req.segments.join('\n'), req.targetLang);

  const generate = async (): Promise<TranslateResponse> => {
    const out = await runWithFallback<Translated>({
      userId: req.userId, resolution: req.resolution, available: req.available, fallback: req.fallback, deadline, maxCallMs: budget, now, skipCacheRead: req.regenerate, cacheOnly: req.cacheOnly,
      cacheKeyFor: (cand) => aiCacheKey({ articleId: req.articleId, op: 'translate', providerId: cand.provider.id, model: cand.provider.model, lang: req.targetLang, contentHash }),
      call: async (cand, timeoutMs) => {
        const opts: AiCall = { system, user, timeoutMs, ...(cand.provider.type === 'anthropic' ? { maxTokens: ANTHROPIC_MAX_TOKENS } : {}) };
        type Parsed = ReturnType<typeof parseTranslation>;
        // « Déjà dans la cible » : `same`, ou une langue source annoncée égale
        // à la cible. Refusé quand l'écriture du lot ne peut pas être celle de
        // la cible (M-16 : un résumé persan « déjà en français », en cache).
        const claimsSame = (p: Parsed) => p.same || sameLanguage(p.lang, req.targetLang);
        const refusedSame = (p: Parsed) => !sameFits && claimsSame(p);
        // Inexploitable : format cassé, écho (segments recopiés alors que la
        // langue source annoncée, connue, n'est pas la cible), ou « déjà dans
        // la cible » refusé sans traduction à servir. Une langue inconnue ne
        // permet rien de conclure ; égale à la cible (et vraisemblable), c'est `same`.
        const unusable = (p: Parsed) => p.segments
          ? (refusedSame(p) || (p.lang !== null && !sameLanguage(p.lang, req.targetLang))) && isEcho(req.segments, p.segments)
          : !p.same || refusedSame(p);
        let result = await call(cand.provider, cand.key, opts);
        let parsed = parseTranslation(result.text, count);
        if (unusable(parsed)) {
          const remaining = deadline - now();
          if (remaining < MIN_CALL_MS) throw malformed();
          // Le même prompt rendrait le même « déjà dans la cible » : le rejeu le contredit.
          const replay = refusedSame(parsed) ? { ...opts, user: user + translateNotSameHint(req.targetLang) } : opts;
          result = await call(cand.provider, cand.key, { ...replay, timeoutMs: remaining });
          parsed = parseTranslation(result.text, count);
          if (unusable(parsed)) throw malformed();
        }
        // Ici, un « déjà dans la cible » refusé a forcément des segments : une
        // vraie traduction, servie comme telle, langue source inconnue (celle
        // annoncée est fausse).
        if (refusedSame(parsed)) return { lang: sameLanguage(parsed.lang, req.targetLang) ? null : parsed.lang, same: false, segments: parsed.segments ?? [], model: result.model };
        // Un petit modèle peut annoncer « lang: fr » puis traduire du français
        // en français malgré la consigne : la langue annoncée fait foi, dès
        // lors que l'écriture du lot le permet.
        if (sameLanguage(parsed.lang, req.targetLang)) return { lang: parsed.lang, same: true, segments: [], model: result.model };
        return { lang: parsed.lang, same: parsed.same, segments: parsed.segments ?? [], model: result.model };
      },
      onSuccess: async (_cand, r) => ({ text: JSON.stringify({ same: r.same, segments: r.segments }), lang: r.lang }),
      // La garde d'écriture, relue à la lecture (R3-03) : un « déjà dans la
      // cible » mis en cache avant elle, sur un lot dont l'écriture ne peut
      // pas être celle de la cible (un texte persan « déjà en français »), est
      // ignoré, puis remplacé par la nouvelle réponse.
      acceptCached: (cached) => sameFits || !cachedSame(cached),
    });
    const { cand, fellBackFrom } = out;
    const named = { providerId: cand.provider.id, providerName: cand.provider.name, fellBackFrom };
    if (out.fromCache) {
      const cached = out.result as AiCacheValue;
      return { ...decodeCached(cached, count), lang: cached.lang, ...named, model: cand.provider.model, fromCache: true };
    }
    const r = out.result as Translated;
    return { segments: r.segments, lang: r.lang, same: r.same, ...named, model: r.model, fromCache: false };
  };

  // Un lot identique à un lot en cours s'y rattache (`inflight.ts`) : même
  // compte, même contenu (scope et segments), même langue cible, même routage.
  // Une retraduction n'y passe pas : elle demande un NOUVEL appel. Un rejeu
  // `cacheOnly` non plus : il ne génère rien, il ne doit rien rejoindre.
  if (req.regenerate || req.cacheOnly) return generate();
  const key = inflightKey(req.userId, 'translate', { articleId: req.articleId, contentHash, lang: req.targetLang, resolution: req.resolution, fallback: req.fallback });
  const { value, shared } = await shareInflight(key, generate);
  return shared ? { ...value, fromCache: true } : value;
}
