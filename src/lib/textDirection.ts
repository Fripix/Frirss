/**
 * Sens d'écriture d'un texte dont on connaît la langue (code BCP 47), pour
 * l'attribut `dir` (M-15 : un résumé persan affiché de gauche à droite).
 * `dir="auto"` ne suffit pas seul : il suit le premier caractère fort, et un
 * résumé persan qui commence par « iPhone » partait de gauche à droite.
 *
 * Une liste plutôt qu'`Intl.Locale#textInfo` : celui-ci manque à Firefox, et le
 * sens doit être le même partout. La sous-étiquette d'écriture, quand elle est
 * là, l'emporte sur la langue (`ku-Arab`, `ar-Latn`).
 */
const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'iw', 'ur', 'ps', 'yi', 'ji', 'dv', 'ug', 'sd', 'ckb', 'syr', 'prs', 'azb', 'mzn', 'glk', 'lrc', 'bal', 'ks']);
const RTL_SCRIPTS = new Set(['arab', 'hebr', 'thaa', 'syrc', 'nkoo', 'adlm', 'rohg', 'mand', 'samr', 'yezi']);

/** `rtl` / `ltr` selon la langue ; `auto` (le navigateur décide) si elle est inconnue ou illisible. */
export function languageDir(lang: string | null | undefined): 'rtl' | 'ltr' | 'auto' {
  if (!lang || !/^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$/.test(lang)) return 'auto';
  const [primary, ...rest] = lang.toLowerCase().split(/[-_]/);
  const script = rest.find((p) => p.length === 4 && /^[a-z]{4}$/.test(p));
  if (script) return RTL_SCRIPTS.has(script) ? 'rtl' : 'ltr';
  return RTL_LANGUAGES.has(primary) ? 'rtl' : 'ltr';
}
