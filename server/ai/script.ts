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

interface Fit {
  /** Un caractère d'une écriture de la langue (Script_Extensions : la marque « ー » compte pour le japonais). */
  letter: RegExp;
  /** La langue s'écrit-elle (aussi) en latin ? */
  latin: boolean;
}

const fitCache = new Map<string, Fit | null>();

/** Écritures de la langue, ou `null` si elle n'en a pas de connue. */
function compatibleScripts(lang: string): Fit | null {
  if (fitCache.has(lang)) return fitCache.get(lang) ?? null;
  let fit: Fit | null = null;
  try {
    const loc = new Intl.Locale(lang);
    const scripts = loc.script ? [loc.script] : DIGRAPHIC[loc.language] ?? (loc.maximize().script ? [loc.maximize().script as string] : []);
    const unicode = scripts.flatMap((s) => COMPOSITE[s] ?? [s]);
    // Une écriture qu'Unicode ne connaît pas fait lever le constructeur : inconnue.
    if (unicode.length) {
      fit = { letter: new RegExp(`^[${unicode.map((s) => `\\p{scx=${s}}`).join('')}]`, 'u'), latin: unicode.includes('Latn') };
    }
  } catch { fit = null; }
  // Les codes viennent aussi du modèle : la table reste petite.
  if (fitCache.size >= 256) fitCache.clear();
  fitCache.set(lang, fit);
  return fit;
}

/** Balises (attributs compris) et entités retirées : un lien ou `&nbsp;` ne sont pas du texte. */
const visibleText = (html: string) => html.replace(/<[^<>]*>/g, ' ').replace(/&(?:#\d+|#x[0-9a-f]+|[a-z]+);/gi, ' ');

/**
 * Les unités de sens du texte : un idéogramme ou un kana vaut un mot (le chinois
 * et le japonais ne séparent pas leurs mots), toute autre suite de lettres
 * (marques combinantes comprises) en vaut un. Compter les LETTRES donnait cinq
 * voix à « Docker » contre une à « 镜 » : un texte technique chinois mêlé de
 * noms de produits passait pour « pas du chinois » (relecture 1.9.0).
 */
const UNIT = /[\p{scx=Hani}\p{scx=Hira}\p{scx=Kana}]|(?:(?![\p{scx=Hani}\p{scx=Hira}\p{scx=Kana}])[\p{L}\p{M}])+/gu;
const LATIN = /^\p{scx=Latn}/u;

/**
 * Part minimale de l'écriture d'une langue NON latine dans un texte qui
 * prétend être dans cette langue. Les mots latins y sont des emprunts courants
 * (« React Server Components 와 Next.js App Router » est du coréen) : ils ne
 * votent pas contre la cible, mais un texte anglais qui cite un mot chinois
 * n'est pas du chinois pour autant.
 */
const NON_LATIN_MIN_SHARE = 0.1;

/**
 * Le texte (HTML accepté) peut-il être dans cette langue ? Jugé sur ses mots
 * (`UNIT`), pas sur ses lettres :
 * - langue écrite en latin : au moins la moitié des mots dans une de ses
 *   écritures — quelques noms propres latins dans un texte persan ne le
 *   rendent pas français, une citation arabe dans un texte français ne le rend
 *   pas arabe, et un texte chinois truffé de noms de produits n'est pas
 *   français ;
 * - autre langue : les mots latins (emprunts, noms de produits) sont mis à
 *   part ; parmi les autres, au moins la moitié dans une écriture de la langue,
 *   et cette écriture fait au moins `NON_LATIN_MIN_SHARE` de tout le texte.
 * Sans lettre, ou langue sans écriture connue : vrai (on ne peut rien
 * conclure). Linéaire.
 */
export function textFitsLanguage(html: string, lang: string): boolean {
  const fit = compatibleScripts(lang);
  if (!fit) return true;
  let total = 0;
  let fitting = 0;
  let latin = 0;
  for (const [unit] of visibleText(html).matchAll(UNIT)) {
    total++;
    if (fit.letter.test(unit)) fitting++;
    else if (LATIN.test(unit)) latin++;
  }
  if (total === 0) return true;
  if (fit.latin) return fitting * 2 >= total;
  return fitting * 2 >= total - latin && fitting >= total * NON_LATIN_MIN_SHARE;
}

/** La langue annoncée si le texte peut y être écrit, sinon `null` (inconnue). */
export function plausibleLang(lang: string | null, text: string): string | null {
  return lang && !textFitsLanguage(text, lang) ? null : lang;
}
