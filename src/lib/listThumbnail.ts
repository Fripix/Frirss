/**
 * Taille de la vignette des lignes d'articles en vue Aperçu (issue #34).
 *
 * Un seul réglage synchronisé, sa largeur ; la hauteur suit le rapport 5:4 de
 * la vignette d'origine (80 × 64, `w-20 h-16`). Le défaut la reproduit
 * exactement, comme les réglages de la grille (`gridCards.ts`) : pas
 * d'interrupteur, le curseur à sa valeur de départ est l'affichage d'origine.
 * `index.css` borne en plus la vignette à une part de la ligne : dans une
 * liste étroite, une grande vignette écrasait le titre.
 */
export const LIST_THUMB_WIDTH_MIN = 56;
export const LIST_THUMB_WIDTH_MAX = 160;
export const LIST_THUMB_WIDTH_STEP = 4;
export const LIST_THUMB_WIDTH_DEFAULT = 80;

/** Un entier entre les bornes ; toute autre valeur rend le défaut. */
export function normalizeListThumbWidth(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v)
    && v >= LIST_THUMB_WIDTH_MIN && v <= LIST_THUMB_WIDTH_MAX
    ? v : LIST_THUMB_WIDTH_DEFAULT;
}

/** Variable CSS posée sur la zone de défilement de la liste. */
export function listThumbStyle(width: number): Record<string, string> {
  return { '--list-thumb-w': `${width}px` };
}
