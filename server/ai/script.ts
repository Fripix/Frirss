/**
 * Garde de vraisemblance sur la langue qu'un modèle annonce (M-16) : un texte
 * écrit en alphabet arabe n'est pas « déjà en français », quoi qu'en dise un
 * petit modèle. On ne devine pas la langue, on vérifie seulement que
 * l'**écriture** du texte est compatible avec la langue annoncée.
 *
 * L'écriture d'une langue vient d'`Intl.Locale#maximize()` (données CLDR de
 * l'ICU de Node) : `fa` → `Arab`, `ja` → `Jpan`, `uk` → `Cyrl`. Une sous-étiquette
 * d'écriture explicite (`sr-Latn`) l'emporte ; quelques langues courantes
 * s'écrivent dans deux écritures, toutes deux acceptées. Une langue inconnue
 * (pas d'écriture probable) ne permet rien de conclure : accepté.
 */

/** Écritures composites de CLDR → écritures Unicode. */
const COMPOSITE: Record<string, string[]> = {
  Hans: ['Hani'], Hant: ['Hani'], Jpan: ['Hani', 'Hira', 'Kana'], Kore: ['Hang', 'Hani'],
};

/** Langues couramment écrites dans plus d'une écriture, sans sous-étiquette pour le dire. */
const DIGRAPHIC: Record<string, string[]> = {
  sr: ['Cyrl', 'Latn'], bs: ['Latn', 'Cyrl'], uz: ['Latn', 'Cyrl'], az: ['Latn', 'Cyrl'],
  kk: ['Cyrl', 'Latn'], ku: ['Latn', 'Arab'], pa: ['Guru', 'Arab'], tk: ['Latn', 'Cyrl'],
};

const fitCache = new Map<string, RegExp | null>();

/** Lettres compatibles avec la langue (Script_Extensions : la marque « ー » compte pour le japonais). */
function compatibleLetters(lang: string): RegExp | null {
  if (fitCache.has(lang)) return fitCache.get(lang) ?? null;
  let re: RegExp | null = null;
  try {
    const loc = new Intl.Locale(lang);
    const scripts = loc.script ? [loc.script] : DIGRAPHIC[loc.language] ?? (loc.maximize().script ? [loc.maximize().script as string] : []);
    const unicode = scripts.flatMap((s) => COMPOSITE[s] ?? [s]);
    // Une écriture qu'Unicode ne connaît pas fait lever le constructeur : inconnue.
    if (unicode.length) re = new RegExp(`[${unicode.map((s) => `\\p{scx=${s}}`).join('')}]`, 'gu');
  } catch { re = null; }
  // Les codes viennent aussi du modèle : la table reste petite.
  if (fitCache.size >= 256) fitCache.clear();
  fitCache.set(lang, re);
  return re;
}

/** Balises (attributs compris) et entités retirées : un lien ou `&nbsp;` ne sont pas du texte. */
const visibleText = (html: string) => html.replace(/<[^<>]*>/g, ' ').replace(/&(?:#\d+|#x[0-9a-f]+|[a-z]+);/gi, ' ');

const count = (text: string, re: RegExp) => {
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(text) !== null) n++;
  return n;
};
const LETTER = /\p{L}/gu;

/**
 * Le texte (HTML accepté) peut-il être dans cette langue ? Vrai si au moins la
 * moitié de ses lettres appartiennent à une écriture de la langue : quelques
 * noms propres latins dans un texte persan ne le rendent pas français, une
 * citation arabe dans un texte français ne le rend pas arabe. Sans lettre, ou
 * langue sans écriture connue : vrai (on ne peut rien conclure). Linéaire.
 */
export function textFitsLanguage(html: string, lang: string): boolean {
  const fit = compatibleLetters(lang);
  if (!fit) return true;
  const text = visibleText(html);
  const letters = count(text, LETTER);
  if (letters === 0) return true;
  return count(text, fit) * 2 >= letters;
}

/** La langue annoncée si le texte peut y être écrit, sinon `null` (inconnue). */
export function plausibleLang(lang: string | null, text: string): string | null {
  return lang && !textFitsLanguage(text, lang) ? null : lang;
}
