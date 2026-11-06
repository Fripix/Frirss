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
  if (!hasRenderableContent(extractedHtml)) return false;
  if (!rssHtml) return true;
  if (visibleText(extractedHtml!).length * 2 < visibleText(rssHtml).length) return false;
  return extractCarriesFeed(rssHtml, extractedHtml!);
}

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

/** Accents des entités nommées (`&eacute;`) : lettre + diacritique combinant. */
const COMBINING: Record<string, string> = {
  grave: '̀', acute: '́', circ: '̂', tilde: '̃', uml: '̈', ring: '̊', cedil: '̧', caron: '̌',
};

function codePoint(n: number): string {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' ';
}

/**
 * Décode ce qu'il faut d'entités pour comparer des mots : numériques, lettres
 * accentuées nommées. Les autres (`&rsquo;`, `&amp;`…) deviennent des blancs —
 * de la ponctuation, qui sépare les mots des deux côtés de la même façon.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n: string) => codePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => codePoint(parseInt(h, 16)))
    .replace(/&([a-z])(grave|acute|circ|tilde|uml|ring|cedil|caron);/gi, (_, letter: string, accent: string) => (letter + COMBINING[accent.toLowerCase()]).normalize('NFC'))
    .replace(/&[a-z][a-z0-9]*;/gi, ' ');
}

/** Les mots distincts d'un HTML, en minuscules, adresses retirées. */
function wordsOf(html: string): Set<string> {
  const text = visibleText(html).replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ').toLowerCase();
  return new Set(text.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3));
}

function extractCarriesFeed(rssHtml: string, extractedHtml: string): boolean {
  const feed = wordsOf(rssHtml);
  if (feed.size < FEED_MIN_WORDS) return true;
  const extract = wordsOf(extractedHtml);
  let shared = 0;
  for (const word of feed) if (extract.has(word)) shared++;
  return shared >= feed.size * FEED_MIN_SHARED;
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
