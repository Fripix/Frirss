import { describe, it, expect } from 'vitest';
import { clampToViewport, MENU_MARGIN } from './clampToViewport';

const iphone = { vw: 390, vh: 844 };
const menu = { w: 236, h: 300 };

describe('clampToViewport', () => {
  it('laisse une position qui tient déjà', () => {
    expect(clampToViewport({ x: 40, y: 100, ...menu, ...iphone }))
      .toEqual({ left: 40, top: 100 });
  });

  it('ramène un menu ancré au bord droit', () => {
    // Le cas réel : le tiroir mobile fait min(360, 85 % de la largeur) — 331 px
    // sur un iPhone de 390 — et le menu s'ancrait au bord droit de la ligne.
    // 331 + 236 = 567 : il s'ouvrait hors écran, d'où « l'appui long ne fait
    // rien ».
    const { left } = clampToViewport({ x: 331, y: 200, ...menu, ...iphone });
    expect(left + menu.w).toBeLessThanOrEqual(iphone.vw - MENU_MARGIN);
    expect(left).toBe(390 - 236 - MENU_MARGIN);
  });

  it('ramène un menu qui dépasserait en bas', () => {
    const { top } = clampToViewport({ x: 40, y: 800, ...menu, ...iphone });
    expect(top + menu.h).toBeLessThanOrEqual(iphone.vh - MENU_MARGIN);
  });

  it("ne pousse jamais hors de l'écran par la gauche ou par le haut", () => {
    // Un menu plus large que la fenêtre : mieux vaut le coin visible que rien.
    expect(clampToViewport({ x: 300, y: 500, w: 500, h: 900, ...iphone }))
      .toEqual({ left: MENU_MARGIN, top: MENU_MARGIN });
  });

  it('accepte une position négative sans la propager', () => {
    expect(clampToViewport({ x: -50, y: -20, ...menu, ...iphone }))
      .toEqual({ left: MENU_MARGIN, top: MENU_MARGIN });
  });
});
