/**
 * Largeur de la fenêtre du sélecteur de couleur d'étiquette. Huit pastilles
 * par rangée : 20 px à la souris, 28 px au doigt (`index.css`, `pointer:
 * coarse`), écart de 4 px, 12 px de marge intérieure de chaque côté. Au doigt,
 * 276 px : elle tient encore dans un écran de 320 px.
 */
export function swatchPopoverWidth(coarse: boolean): number {
  return coarse ? 8 * 28 + 7 * 4 + 2 * 12 : 220;
}

export function isCoarsePointer(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
}
