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
  if (visibleText(html).length > 0) return true;
  return VISUAL_TAG.test(html);
}

/** Le texte lisible d'un HTML : balises retirées, blancs resserrés. */
function visibleText(html: string): string {
  return html
    .replace(/<[^<>]*>/g, ' ')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
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
 */
export function extractWorthShowing(rssHtml?: string | null, extractedHtml?: string | null): boolean {
  if (!hasRenderableContent(extractedHtml)) return false;
  if (!rssHtml) return true;
  return visibleText(extractedHtml!).length * 2 >= visibleText(rssHtml).length;
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
  if (extractWorthShowing(input.rssHtml, input.extractedHtml)) return 'extract';
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
