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
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .trim();
  if (text.length > 0) return true;
  return VISUAL_TAG.test(html);
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
  if (hasRenderableContent(input.extractedHtml)) return 'extract';
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
