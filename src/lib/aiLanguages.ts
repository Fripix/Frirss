/**
 * Langues cibles proposées à la traduction (spec §17) : liste fermée, sans
 * `ru` ni `he`. Même liste, même ordre que `server/ai/languages.ts` (un test
 * le vérifie). Module pur : utilisable des deux côtés de l'application. Les
 * noms affichés viennent d'`Intl.DisplayNames`, jamais d'une clé de traduction.
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

/**
 * Écriture d'un code chinois quand il la fixe : `Hant` / `TW` / `HK` / `MO`
 * → traditionnel, `Hans` / `CN` / `SG` → simplifié, `zh` seul → inconnue.
 */
function chineseScript(p: string[]): 'Hans' | 'Hant' | null {
  for (const sub of p.slice(1)) {
    if (sub === 'hant' || TRADITIONAL_REGIONS.has(sub)) return 'Hant';
    if (sub === 'hans' || sub === 'cn' || sub === 'sg') return 'Hans';
  }
  return null;
}

/** Langue cible par défaut pour une langue d'interface (repli : `en`). */
export function targetLanguage(uiLang: string): AiLanguage {
  const p = parts(uiLang);
  const primary = p[0] ?? '';
  if (primary === 'zh') return chineseScript(p) === 'Hant' ? 'zh-Hant' : 'zh-Hans';
  return isAiLanguage(primary) ? primary : 'en';
}

/**
 * Deux codes désignent-ils la même langue ? Comparaison sur la sous-étiquette
 * principale ; seules deux écritures chinoises explicitement différentes
 * (`zh-Hant` contre `zh-Hans`) sont distinguées. `null` : langue inconnue.
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

/** Nom de la langue dans la langue d'interface ; repli sur le code. */
export function languageName(code: AiLanguage, uiLang: string): string {
  try {
    return new Intl.DisplayNames([uiLang], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}
