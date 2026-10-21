/**
 * Langues cibles proposées à la traduction (spec §17) : liste fermée, sans
 * `ru` ni `he`. Les noms affichés viennent d'`Intl.DisplayNames`, jamais d'une
 * clé de traduction.
 */
export const AI_LANGUAGES = ['fr', 'en', 'de', 'es', 'it', 'nl', 'pl', 'pt', 'uk', 'zh-Hans', 'zh-Hant', 'sv', 'da', 'nb', 'fi', 'cs', 'ro', 'hu', 'el', 'ca', 'ja', 'ko', 'ar', 'tr', 'hi', 'id', 'vi', 'th'] as const;
export type AiLanguage = typeof AI_LANGUAGES[number];

export function isAiLanguage(v: unknown): v is AiLanguage {
  return typeof v === 'string' && (AI_LANGUAGES as readonly string[]).includes(v);
}

const TRADITIONAL_REGIONS = new Set(['tw', 'hk', 'mo']);

/** Sous-étiquettes en minuscules, séparateur `-` ou `_` accepté. */
function parts(tag: string): string[] {
  return tag.trim().toLowerCase().split(/[-_]/).filter(Boolean);
}

/** `Hant` / `TW` / `HK` / `MO` → traditionnel, `Hans` / `CN` / `SG` → simplifié, `zh` seul → inconnue. */
function chineseScript(p: string[]): 'Hans' | 'Hant' | null {
  for (const sub of p.slice(1)) {
    if (sub === 'hant' || TRADITIONAL_REGIONS.has(sub)) return 'Hant';
    if (sub === 'hans' || sub === 'cn' || sub === 'sg') return 'Hans';
  }
  return null;
}

/**
 * Deux codes désignent-ils la même langue ? **Même règle que `sameLanguage`
 * de `src/lib/aiLanguages.ts`** (un test de parité le vérifie) : sous-étiquette
 * principale, une région ne compte pas, seules deux écritures chinoises
 * explicitement différentes sont distinguées. `null` : langue inconnue.
 */
export function sameLanguage(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const pa = parts(a);
  const pb = parts(b);
  if (!pa[0] || pa[0] !== pb[0]) return false;
  if (pa[0] === 'zh') {
    const sa = chineseScript(pa);
    const sb = chineseScript(pb);
    if (sa && sb && sa !== sb) return false;
  }
  return true;
}
