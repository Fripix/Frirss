import { decodeEntities } from './searchMatch';

/** Longueur de l'aperçu d'une carte, en caractères décodés. */
export const PREVIEW_LENGTH = 200;

/**
 * Le texte retenu avant décodage. Assez pour {@link PREVIEW_LENGTH} caractères
 * même dans un texte riche en entités ; borné parce que le résumé d'un flux
 * porte souvent l'article entier, et que le balayage de la recherche normalise
 * des milliers d'articles.
 */
const DECODE_WINDOW = PREVIEW_LENGTH * 8;

/**
 * L'aperçu d'une carte, en texte : les balises retirées, puis les entités
 * décodées par le décodeur de l'extrait de recherche (`decodeEntities`). Sans
 * le décodage, « Health &amp; Bioscience » s'affichait tel quel (M-14). Le
 * décodage vient APRÈS le retrait : `&lt;b&gt;` est du texte, pas une balise.
 * Les balises s'effacent sans laisser d'espace, comme avant : « <b>mot</b>. »
 * ne devient pas « mot . ».
 */
export function previewText(html: string | undefined): string {
  if (!html) return '';
  const text = html.replace(/<[^<>]*>/g, '');
  return decodeEntities(text.slice(0, DECODE_WINDOW)).slice(0, PREVIEW_LENGTH);
}
