/** Marge conservée entre un menu flottant et le bord de la fenêtre. */
export const MENU_MARGIN = 8;

export interface ClampInput {
  /** Position souhaitée, en coordonnées de fenêtre. */
  x: number;
  y: number;
  /** Encombrement du menu. */
  w: number;
  h: number;
  /** Fenêtre visible. */
  vw: number;
  vh: number;
}

/**
 * Ramène un menu flottant à l'intérieur de la fenêtre.
 *
 * ⚠️ Le menu contextuel d'un flux portait le commentaire « keep menu in
 * viewport » au-dessus d'un `left: x, top: y` brut : l'intention était écrite,
 * jamais implémentée. Sur un iPhone, le tiroir de la barre latérale fait
 * `min(360, 85 %)` — 331 px sur 390 — et le menu s'ancre au bord droit de la
 * ligne : 331 + 236 de largeur minimale, il s'ouvrait presque entièrement hors
 * écran. Le geste paraissait donc sans effet, alors que le menu était bien là.
 *
 * Le débordement par la gauche ou par le haut l'emporte sur celui de droite ou
 * du bas : un menu plus large que la fenêtre doit montrer son coin supérieur
 * gauche, là où commencent ses libellés, plutôt que sa fin.
 */
export function clampToViewport({ x, y, w, h, vw, vh }: ClampInput): { left: number; top: number } {
  return {
    left: Math.max(MENU_MARGIN, Math.min(x, vw - w - MENU_MARGIN)),
    top: Math.max(MENU_MARGIN, Math.min(y, vh - h - MENU_MARGIN)),
  };
}
