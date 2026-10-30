import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { swatchPopoverWidth } from '../../lib/swatchPopover';

/*
 * Les pastilles du sélecteur de couleur d'étiquette faisaient 20 × 20 px au
 * doigt. 28 px au toucher, sans grossir le reste : la fenêtre s'élargit
 * d'autant, et tient encore dans un écran de 320 px.
 */
const css = fs.readFileSync(path.resolve(__dirname, '../../styles/index.css'), 'utf8');

describe('sélecteur de couleur — pastilles au doigt', () => {
  it('passent à 28 px sous un pointeur grossier', () => {
    const coarse = css.slice(css.indexOf('@media (pointer: coarse) {'));
    const block = coarse.slice(0, coarse.indexOf('\n}\n'));
    expect(block).toMatch(/\.label-swatch-grid button\s*\{[^}]*width:\s*28px;[^}]*height:\s*28px;/);
  });

  it('la fenêtre loge huit pastilles de 28 px et tient à 320 px', () => {
    const coarse = swatchPopoverWidth(true);
    expect(coarse).toBeGreaterThanOrEqual(8 * 28 + 7 * 4 + 2 * 12);
    expect(coarse + 16).toBeLessThanOrEqual(320);
    expect(swatchPopoverWidth(false)).toBe(220);
  });
});
