// Ce que le volet de lecture montre, et à quel moment.
//
// ⚠️ La règle a changé au cycle 1.4.10, et c'est une correction de fond.
// Sur un flux à extraction automatique, le volet rendait un **squelette gris**
// tant que le texte complet n'était pas revenu. Or le contenu du flux RSS est
// déjà en mémoire — il est arrivé avec la liste. L'application montrait donc
// un simulacre de chargement alors qu'elle tenait du vrai texte : c'est
// exactement ce qui donnait l'impression que l'interface charge en permanence.
//
// Désormais : on montre TOUT DE SUITE ce qu'on a, et l'extraction remplace le
// corps quand elle arrive. Le squelette ne sert plus que là où il n'y a
// réellement rien à montrer — un article dont le flux ne livre aucun contenu,
// et dont on attend l'extraction.
//
// Le module ne connaît ni React ni le DOM : il répond à une question, à partir
// de trois entrées. `articleBody.displayedHtml()` fabrique le HTML lui-même et
// choisit la même source ; ici on décide seulement ce que l'écran expose.

export interface ReadingBodyInput {
  /** HTML du flux RSS, tel qu'il est venu avec la liste d'articles. */
  rssHtml?: string | null;
  /** HTML extrait (« contenu complet »), ou `null` tant qu'il n'existe pas. */
  extractedHtml?: string | null;
  /** Le flux est-il réglé sur extraction automatique ? */
  autoExtract: boolean;
  /**
   * Le lecteur a-t-il demandé lui-même l'article complet (bouton, palette,
   * « Réessayer ») ? Sa demande passe outre la garde de `extractWorthShowing`.
   */
  forced?: boolean;
}

export type ReadingBodyKind =
  /** Le texte complet est là. */
  | 'extract'
  /** Le contenu du flux — définitif, ou en attendant l'extraction. */
  | 'rss'
  /** Rien à montrer, et quelque chose est en route. */
  | 'skeleton';

/** Balises qui font à elles seules un article non vide. */
const VISUAL_TAG = /<(?:img|figure|picture|iframe|video|audio|embed|object|svg)\b/i;

/**
 * Y a-t-il quelque chose à afficher dans ce HTML ?
 *
 * Du texte, ou à défaut un média : un article réduit à sa photo n'est pas vide.
 * Les paragraphes creux que beaucoup de flux traînent (`<p>&nbsp;</p>`,
 * `<p><br></p>`) ne comptent pas — les prendre pour du contenu ferait afficher
 * un corps blanc là où le squelette a encore un sens.
 */
export function hasRenderableContent(html?: string | null): boolean {
  if (!html) return false;
  if (visibleText(html).length > 0) return true;
  return VISUAL_TAG.test(html);
}

/**
 * Le texte lisible d'un HTML : balises retirées, entités décodées (un flux
 * écrit `d&eacute;faut` compte autant que l'extrait qui écrit `défaut`),
 * blancs resserrés.
 */
function visibleText(html: string): string {
  return decodeEntities(html
    .replace(/<[^<>]*>/g, ' ')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * L'extrait mérite-t-il de remplacer le contenu du flux ?
 *
 * Oui s'il porte quelque chose, SAUF s'il n'a même pas la moitié du texte du
 * flux : ce n'est alors pas l'article complet, c'est un morceau de la page.
 * Sur la nouvelle mise en page du CERT-FR, l'extraction ne gardait que la
 * section « Solutions » (135 caractères) alors que le flux livrait l'avis
 * entier — une perte silencieuse, contournée seulement par « Contenu RSS »
 * (L-04). La moitié laisse passer un extrait légitimement un peu plus court
 * (le flux répète souvent titre et chapeau) ; l'écart qui trahit un morceau
 * est d'un ordre de grandeur.
 *
 * Ni s'il ne contient presque aucun mot du flux (A2, plus bas) : c'est alors
 * l'habillage de la page, même plus long que le flux.
 */
export function extractWorthShowing(rssHtml?: string | null, extractedHtml?: string | null): boolean {
  if (!rssHtml || !extractedHtml) return hasRenderableContent(extractedHtml);
  const known = answers.find((a) => a.rss === rssHtml && a.extract === extractedHtml);
  if (known) return known.worth;
  const feedText = visibleText(rssHtml);
  const extractText = visibleText(extractedHtml);
  const renderable = extractText.length > 0 || VISUAL_TAG.test(extractedHtml);
  const worth = renderable && extractText.length * 2 >= feedText.length && extractCarriesFeed(feedText, extractText);
  answers.unshift({ rss: rssHtml, extract: extractedHtml, worth });
  answers.length = Math.min(answers.length, REMEMBERED_ANSWERS);
  return worth;
}

// La même question revient plusieurs fois par rendu du volet (squelette,
// durée de lecture, avis, corps affiché), et chaque pas de la barre de
// progression de lecture re-rend le volet : la mesure lit tout le texte,
// 5,5 ms sur un article de 170 Ko (relecture du troisième round). Les
// dernières réponses sont gardées — l'article ouvert, ses voisins du
// balayage. Comparer deux fois la même chaîne ne coûte rien.
const REMEMBERED_ANSWERS = 8;
const answers: Array<{ rss: string; extract: string; worth: boolean }> = [];

// ── L'extrait contient-il le texte du flux ? (A2) ────────────────────
// Sur un billet très court (Simon Willison, ~160 caractères), aucune passe de
// Readability n'atteint son seuil de 500 et il rend la plus longue : la
// colonne du site (« This is a beat… », « Monthly briefing », « Sponsor
// me »), PLUS longue que le flux — la garde de la moitié laissait passer, et
// l'« article complet » remplaçait le texte par l'habillage. Le nettoyage du
// serveur retire désormais cette colonne-là (A3) ; cette garde-ci couvre les
// suivantes, quel que soit leur balisage.
//
// Mesure : la part des mots DISTINCTS du flux (trois lettres ou chiffres au
// moins, adresses retirées) qu'on retrouve dans l'extrait. Mesuré sur 116
// pages réelles dont le flux était connu (2026-11-06) : le billet en cause
// 13 %, une page d'abonné LWN (« please log in ») 16 % ; un vrai extrait 54 %
// et plus, sauf Ars Technica (24 à 39 %), dont l'extraction perd le chapeau
// — que le flux porte — mais garde la suite : elle reste montrée. Deux textes
// étrangers l'un à l'autre se partagent 10 à 20 % de mots courants (« les »,
// « the », « pour »), d'où le seuil d'un cinquième.
//
// Pas de jugement sur un flux de moins de `FEED_MIN_WORDS` mots distincts :
// trop peu pour conclure (titre seul, brève). Les adresses sont retirées
// avant de compter : le flux d'un agrégateur (Hacker News) n'est fait que de
// liens et de « Comments URL », sans rapport avec le texte de l'article.

/** En deçà, le flux est trop court pour juger l'extrait sur ses mots. */
export const FEED_MIN_WORDS = 20;
/** Part minimale des mots du flux que l'extrait doit contenir. */
export const FEED_MIN_SHARED = 0.2;

// Écritures sans espaces (relecture du troisième round). En chinois, en
// japonais, en thaï, les blancs ne séparent pas les mots : un « mot » était
// une proposition entière, et deux rédactions du même article — le chapeau
// du flux, le corps de la page — n'en partageaient aucune. Ces écritures se
// comparent sur des PAIRES de caractères voisins (bigrammes) : « 交通政策 »
// donne « 交通 », « 通政 », « 政策 », que l'autre rédaction partage même
// quand la phrase change. Le seuil reste le même.
//
// Une autre langue. Un flux anglais dont la page est en français (ou en
// japonais) n'en partage que des noms propres et des nombres : sous le
// seuil, la garde masquait une vraie page. Elle vise l'habillage d'un MÊME
// site ; un extrait d'une autre écriture, ou d'une autre langue reconnue, ET
// nettement plus long que le flux (`FOREIGN_MIN_LENGTH`) est montré. Le
// recouvrement n'est pas exigé nul : noms propres et nombres passent d'une
// langue à l'autre, il ne l'est jamais tout à fait.

/** Un extrait d'une autre langue doit faire au moins ce multiple du flux pour passer outre. */
export const FOREIGN_MIN_LENGTH = 2;

/** Écritures sans espaces entre les mots : comparées par paires de caractères. */
const UNSPACED_CLASS = String.raw`\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Thai}\p{scx=Lao}\p{scx=Khmer}\p{scx=Myanmar}`;
const UNSPACED = new RegExp(`[${UNSPACED_CLASS}]`, 'u');
const UNSPACED_RUNS = new RegExp(`[${UNSPACED_CLASS}]+|[^${UNSPACED_CLASS}]+`, 'gu');

/** Accents des entités nommées (`&eacute;`, `&zdot;`) : lettre + diacritique combinant. */
const COMBINING: Record<string, string> = {
  grave: '̀', acute: '́', circ: '̂', tilde: '̃', macr: '̄', breve: '̆',
  dot: '̇', uml: '̈', ring: '̊', dblac: '̋', caron: '̌', cedil: '̧', ogon: '̨',
};
const ACCENTED = /^([a-z])(grave|acute|circ|tilde|macr|breve|dot|uml|ring|dblac|caron|cedil|ogon)$/i;

/**
 * Les entités nommées qui écrivent une lettre ou un chiffre sans se
 * décomposer en lettre + accent : celles de HTML 4, les lettres latines
 * barrées et ligatures de HTML 5, le cyrillique de HTML 5.
 */
const LETTER_ENTITIES: Record<string, string> = Object.fromEntries(
  ('ordf:ª sup1:¹ sup2:² sup3:³ micro:µ ordm:º frac14:¼ frac12:½ frac34:¾ AElig:Æ aelig:æ ETH:Ð eth:ð '
  + 'Oslash:Ø oslash:ø THORN:Þ thorn:þ szlig:ß OElig:Œ oelig:œ fnof:ƒ circ:ˆ sigmaf:ς thetasym:ϑ upsih:ϒ '
  + 'piv:ϖ image:ℑ real:ℜ alefsym:ℵ odot:⊙ sdot:⋅ '
  + 'Lstrok:Ł lstrok:ł Dstrok:Đ dstrok:đ Hstrok:Ħ hstrok:ħ Tstrok:Ŧ tstrok:ŧ ENG:Ŋ eng:ŋ IJlig:Ĳ ijlig:ĳ '
  + 'kgreen:ĸ imath:ı inodot:ı jmath:ȷ napos:ŉ Lmidot:Ŀ lmidot:ŀ fflig:ﬀ filig:ﬁ fllig:ﬂ ffilig:ﬃ ffllig:ﬄ')
    .split(' ').map((pair) => pair.split(':') as [string, string]),
);
// Grec : Alpha…Omega, alpha…omega (le rang vide est celui du sigma final, à part).
'Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho - Sigma Tau Upsilon Phi Chi Psi Omega'
  .split(' ').forEach((name, i) => {
    if (name === '-') return;
    LETTER_ENTITIES[name] = String.fromCodePoint(0x391 + i);
    LETTER_ENTITIES[name.toLowerCase()] = String.fromCodePoint(0x3b1 + i);
  });
// Cyrillique : А…Я, а…я, puis Ё, Ђ…Џ (ukrainien, biélorusse, serbe, macédonien).
'A B V G D IE ZH Z I J K L M N O P R S T U F KH TS CH SH SHCH HARD Y SOFT E YU YA'
  .split(' ').forEach((stem, i) => {
    LETTER_ENTITIES[`${stem}cy`] = String.fromCodePoint(0x410 + i);
    LETTER_ENTITIES[`${stem.toLowerCase()}cy`] = String.fromCodePoint(0x430 + i);
  });
'IOcy DJcy GJcy Jukcy DScy Iukcy YIcy Jsercy LJcy NJcy TSHcy KJcy - Ubrcy DZcy'
  .split(' ').forEach((name, i) => {
    if (name === '-') return;
    LETTER_ENTITIES[name] = String.fromCodePoint(0x401 + i);
    LETTER_ENTITIES[name.toLowerCase()] = String.fromCodePoint(0x451 + i);
  });

function codePoint(n: number): string {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' ';
}

/**
 * Une entité nommée que la table ne connaît pas (symboles mathématiques,
 * variantes rares) : dans le navigateur, il la décode lui-même, une fois par
 * nom. Ailleurs (tests en Node), un blanc. Le nom est vérifié avant d'entrer
 * dans un `<textarea>` détaché, dont le contenu n'est jamais que du texte.
 */
const decodedNames = new Map<string, string>();
let entityBox: HTMLTextAreaElement | null = null;
function namedEntity(name: string): string {
  const letter = LETTER_ENTITIES[name];
  if (letter) return letter;
  const accented = ACCENTED.exec(name);
  if (accented) return (accented[1] + COMBINING[accented[2].toLowerCase()]).normalize('NFC');
  const cached = decodedNames.get(name);
  if (cached !== undefined) return cached;
  let decoded = ' ';
  if (typeof document !== 'undefined' && name.length <= 32) {
    entityBox ??= document.createElement('textarea');
    entityBox.innerHTML = `&${name};`;
    if (entityBox.value !== `&${name};`) decoded = entityBox.value;
  }
  decodedNames.set(name, decoded);
  return decoded;
}

/**
 * Décode les entités pour comparer des mots : numériques et nommées. Une
 * entité de ponctuation (`&rsquo;`, `&amp;`) écrit un séparateur, des deux
 * côtés pareil. Avant la relecture du troisième round, seules les lettres
 * accentuées nommées étaient décodées : `&oslash;`, `&szlig;`, `&lstrok;`
 * devenaient des blancs et coupaient leur mot, que l'extrait écrivait d'un
 * seul tenant.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n: string) => codePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => codePoint(parseInt(h, 16)))
    .replace(/&([a-z][a-z0-9]*);/gi, (_, name: string) => namedEntity(name));
}

/**
 * Les unités comparables d'un texte, en minuscules, adresses retirées : ses
 * mots distincts de trois caractères au moins et, dans une écriture sans
 * espaces, ses paires de caractères voisins.
 */
function wordsOf(text: string): Set<string> {
  const clean = text.replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ').normalize('NFC').toLowerCase();
  const units = new Set<string>();
  const unspaced = UNSPACED.test(clean);
  for (const token of clean.split(/[^\p{L}\p{M}\p{N}]+/u)) {
    if (!unspaced || !UNSPACED.test(token)) {
      if (token.length >= 3) units.add(token);
      continue;
    }
    for (const run of token.match(UNSPACED_RUNS) ?? []) {
      if (!UNSPACED.test(run)) {
        if (run.length >= 3) units.add(run);
        continue;
      }
      const chars = Array.from(run);
      for (let i = 1; i < chars.length; i++) units.add(chars[i - 1] + chars[i]);
    }
  }
  return units;
}

// ── Écriture et langue d'un texte ────────────────────────────────────
// Assez pour dire « autre langue », pas pour la nommer à coup sûr :
// l'écriture dominante, puis, en alphabet latin, les mots-outils des langues
// de l'interface. Sur les premiers milliers de caractères : au-delà, rien ne
// change, et le corps d'une page peut peser 170 Ko.

const LANGUAGE_SAMPLE = 4000;

const SCRIPTS: Array<[string, RegExp]> = [
  ['latin', /\p{sc=Latin}/gu], ['cyrillic', /\p{sc=Cyrillic}/gu], ['greek', /\p{sc=Greek}/gu],
  ['arabic', /\p{sc=Arabic}/gu], ['hebrew', /\p{sc=Hebrew}/gu], ['hangul', /\p{sc=Hangul}/gu],
  ['thai', /\p{sc=Thai}/gu], ['devanagari', /\p{sc=Devanagari}/gu],
  ['kana', /[\p{sc=Hiragana}\p{sc=Katakana}]/gu], ['han', /\p{sc=Han}/gu],
];

/** L'écriture dominante d'un texte ; le japonais (kanji et kana) à part du chinois. */
function scriptOf(sample: string): string | null {
  const count: Record<string, number> = {};
  for (const [name, re] of SCRIPTS) count[name] = sample.match(re)?.length ?? 0;
  if (count.kana > (count.kana + count.han) * 0.1) {
    count.japanese = count.kana + count.han;
    count.kana = 0;
    count.han = 0;
  }
  let best: string | null = null;
  for (const [name, n] of Object.entries(count)) if (n > 0 && (!best || n > count[best])) best = name;
  return best;
}

const STOPWORDS: Record<string, string> = {
  en: 'the and of to is that with for this are was from have which were their been has would will they by',
  fr: 'le la les des et est une du qui dans pour pas sur avec au aux cette sont été ses nous mais ou plus',
  de: 'der die und das ist nicht mit ein eine auf den dem sich auch für von zu wird werden im sie',
  es: 'el la los las y del es por con una para se al como más fue su sus entre pero este esta',
  it: 'il la gli della che è per non sono alla nel di delle dei anche questo ha più lo una',
  nl: 'het een van en is niet op dat voor met zijn ook wordt aan er bij naar deze worden om',
  pt: 'os as do da dos das não com uma em ao mais foi são pelo pela também seu sua mas',
  pl: 'i w z na się nie jest to że do o jak po przez dla od ale czy są już',
};
const STOPWORD_LANGS = new Map<string, string[]>();
for (const [lang, words] of Object.entries(STOPWORDS)) {
  for (const word of words.split(' ')) STOPWORD_LANGS.set(word, [...(STOPWORD_LANGS.get(word) ?? []), lang]);
}

/** La langue d'un texte en alphabet latin, si ses mots-outils la désignent nettement. */
function latinLanguageOf(sample: string): string | null {
  const count: Record<string, number> = {};
  for (const word of sample.toLowerCase().split(/[^\p{L}]+/u)) {
    for (const lang of STOPWORD_LANGS.get(word) ?? []) count[lang] = (count[lang] ?? 0) + 1;
  }
  const [first, second] = Object.entries(count).sort((a, b) => b[1] - a[1]);
  if (!first || first[1] < 5 || (second && first[1] < second[1] * 1.5)) return null;
  return first[0];
}

/** Les deux textes sont-ils d'écritures, ou de langues reconnues, différentes ? */
function otherLanguage(feedText: string, extractText: string): boolean {
  const a = feedText.slice(0, LANGUAGE_SAMPLE);
  const b = extractText.slice(0, LANGUAGE_SAMPLE);
  const scriptA = scriptOf(a);
  const scriptB = scriptOf(b);
  if (!scriptA || !scriptB) return false;
  if (scriptA !== scriptB) return true;
  if (scriptA !== 'latin') return false;
  const langA = latinLanguageOf(a);
  const langB = latinLanguageOf(b);
  return !!langA && !!langB && langA !== langB;
}

function extractCarriesFeed(feedText: string, extractText: string): boolean {
  const feed = wordsOf(feedText);
  if (feed.size < FEED_MIN_WORDS) return true;
  const extract = wordsOf(extractText);
  let shared = 0;
  for (const word of feed) if (extract.has(word)) shared++;
  if (shared >= feed.size * FEED_MIN_SHARED) return true;
  return extractText.length >= feedText.length * FOREIGN_MIN_LENGTH && otherLanguage(feedText, extractText);
}

/**
 * L'extrait est-il ce que le volet montre ? La garde de `extractWorthShowing`
 * (L-04) ne vaut que pour l'extraction automatique : une demande explicite du
 * lecteur montre l'extrait, même court, pourvu qu'il porte quelque chose.
 * Sans cela, « Article complet » ne changeait rien à l'écran et le bouton
 * passait pourtant à « Contenu RSS » (relecture 1.9.0).
 */
export function extractShown(rssHtml?: string | null, extractedHtml?: string | null, forced = false): boolean {
  return forced ? hasRenderableContent(extractedHtml) : extractWorthShowing(rssHtml, extractedHtml);
}

/**
 * Ce que le volet doit rendre.
 *
 * Dans cet ordre : l'extraction si elle a abouti, sinon le flux s'il porte
 * quoi que ce soit, sinon le squelette — mais **seulement** si une extraction
 * automatique est en route. Sans elle, un article vide reste vide : afficher
 * un squelette que rien ne viendra remplacer serait un mensonge permanent.
 */
export function readingBodyKind(input: ReadingBodyInput): ReadingBodyKind {
  if (extractShown(input.rssHtml, input.extractedHtml, input.forced)) return 'extract';
  if (hasRenderableContent(input.rssHtml)) return 'rss';
  return input.autoExtract ? 'skeleton' : 'rss';
}

/** Le squelette prend-il la place du corps ? */
export function showsSkeleton(input: ReadingBodyInput): boolean {
  return readingBodyKind(input) === 'skeleton';
}

/**
 * La pastille « x min » est-elle affichée ?
 *
 * Elle l'est dès qu'il y a un corps. Sa valeur porte sur le texte **montré**,
 * et grandit donc quand l'extraction remplace le contenu du flux. C'est
 * assumé : le corps change sous les yeux du lecteur, la durée le suit. La
 * cacher jusqu'à l'extraction — l'ancienne règle — n'avait de sens que tant
 * qu'il n'y avait rien à mesurer.
 */
export function showsReadingTime(input: ReadingBodyInput): boolean {
  return !showsSkeleton(input);
}
