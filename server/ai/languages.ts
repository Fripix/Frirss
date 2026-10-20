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
