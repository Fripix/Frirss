/**
 * Taille des cartes et format de leur image en vue grille (issue #26).
 *
 * Deux réglages synchronisés, valables pour tous les thèmes : la largeur
 * MINIMALE d'une carte (les cartes s'élargissent toujours pour remplir la
 * ligne) et le recadrage de l'image. Les défauts reproduisent exactement la
 * grille d'avant : 240 px, 160 px sur téléphone, 16:9.
 */
export const GRID_CARD_WIDTH_MIN = 160;
export const GRID_CARD_WIDTH_MAX = 480;
// Au pixel près : un pas plus grand saute des largeurs qui, sur un écran
// donné, tombent pile sur le nombre de colonnes voulu.
export const GRID_CARD_WIDTH_STEP = 1;
export const GRID_CARD_WIDTH_DEFAULT = 240;

// Pas de format « original » : des images de hauteurs différentes casseraient
// l'alignement des rangées — ce serait une autre vue, pas un réglage.
export const GRID_IMAGE_RATIOS = ['16:9', '4:3', '1:1'] as const;
export type GridImageRatio = (typeof GRID_IMAGE_RATIOS)[number];

/** Un entier entre les bornes ; toute autre valeur rend le défaut. */
export function normalizeGridCardWidth(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v)
    && v >= GRID_CARD_WIDTH_MIN && v <= GRID_CARD_WIDTH_MAX
    ? v : GRID_CARD_WIDTH_DEFAULT;
}

/**
 * « Remplir la ligne » : activé, les cartes s'élargissent pour occuper toute
 * la ligne et la largeur choisie est un minimum (la grille d'origine) ;
 * désactivé, elles gardent exactement cette largeur et la grille est centrée.
 * Seul un `false` explicite le désactive : le défaut doit gagner.
 */
export function normalizeGridCardFill(v: unknown): boolean {
  return v !== false;
}

/** Sur téléphone, `index.css` remplit toujours la largeur, quelle que soit la classe. */
export function gridClassName(fill: boolean): string {
  return fill ? 'article-grid' : 'article-grid article-grid--fixed';
}

export function normalizeGridImageRatio(v: unknown): GridImageRatio {
  return (GRID_IMAGE_RATIOS as readonly unknown[]).includes(v) ? (v as GridImageRatio) : '16:9';
}

/**
 * Variables CSS posées sur `.article-grid`. Sur téléphone, la largeur est
 * réduite d'un tiers, comme l'était la grille d'origine (240 → 160) : un seul
 * curseur pour tous les écrans. `index.css` borne en plus la colonne à la
 * largeur disponible, pour qu'une grande carte ne déborde jamais à 320 px.
 */
export function gridCardStyle(width: number, ratio: GridImageRatio): Record<string, string> {
  return {
    '--grid-card-min': `${width}px`,
    '--grid-card-min-mobile': `${Math.round((width * 2) / 3)}px`,
    '--grid-card-ratio': ratio.replace(':', ' / '),
  };
}
