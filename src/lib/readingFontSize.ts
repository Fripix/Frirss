/*
 * Taille du corps des articles. Deux valeurs : celle du thème (ordinateur,
 * synchronisée) et celle de l'appareil tactile (téléphone, tablette, locale).
 * Le curseur des Préférences et les boutons A− / A+ du panneau de lecture
 * agissent sur la même valeur avec les mêmes bornes : avant, le curseur
 * s'arrêtait à 12-20 quand les boutons allaient de 10 à 24, et il ne faisait
 * rien du tout sur un appareil tactile.
 */
export const READING_BODY_BOUNDS = {
  desktop: { min: 10, max: 24 },
  touch: { min: 13, max: 26 },
} as const;

/** Un cran au-dessus du défaut du thème : on lit plus loin d'un écran tactile. */
export const MOBILE_READING_DEFAULT = 17;

export function clampReadingBody(px: number, touch: boolean): number {
  const { min, max } = touch ? READING_BODY_BOUNDS.touch : READING_BODY_BOUNDS.desktop;
  return Math.max(min, Math.min(max, px));
}
