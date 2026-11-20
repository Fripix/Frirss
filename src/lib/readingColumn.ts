/**
 * Largeur de la colonne de lecture limitée (Préférences › Apparence ›
 * Tailles, section « Colonne de lecture »).
 *
 * Un réglage synchronisé, compagnon de l'interrupteur `limitReadingColumn` :
 * la largeur choisie devient le plafond de la colonne quand l'interrupteur
 * est actif. Le défaut reproduit la largeur fixe d'origine (48 rem à
 * 16 px), pour que les lecteurs déjà réglés ne voient aucun changement.
 */
export const READING_COLUMN_WIDTH_MIN = 480;
export const READING_COLUMN_WIDTH_MAX = 1200;
// 8 px ≈ un demi-caractère : assez fin pour caler la colonne sur la mesure
// voulue, assez grand pour que le curseur reste maniable sur 720 px.
export const READING_COLUMN_WIDTH_STEP = 8;
export const READING_COLUMN_WIDTH_DEFAULT = 768;

/** Un entier entre les bornes ; toute autre valeur rend le défaut. */
export function normalizeReadingColumnWidth(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v)
    && v >= READING_COLUMN_WIDTH_MIN && v <= READING_COLUMN_WIDTH_MAX
    ? v : READING_COLUMN_WIDTH_DEFAULT;
}
