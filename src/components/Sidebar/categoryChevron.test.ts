import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/*
 * Le chevron qui replie une catégorie de la barre latérale faisait 12 px de
 * large : sous la cible de 24 px de WCAG 2.5.8 à la souris, et loin des 44 pt
 * au doigt. La zone sensible grandit, l'icône et la mise en page non : des
 * marges négatives rendent exactement ce que la zone ajoute, la ligne garde
 * ses 12 px d'encombrement.
 */
const ROOT = path.resolve(__dirname, '../..');
const css = fs.readFileSync(path.join(ROOT, 'styles/index.css'), 'utf8');
const sidebar = fs.readFileSync(path.join(ROOT, 'components/Sidebar/Sidebar.tsx'), 'utf8');

const ICON = 12;

/** Déclarations de `.category-chevron` dans un morceau de CSS. */
function decls(chunk: string): Record<string, string> {
  const m = chunk.match(/\.category-chevron\s*\{([^}]*)\}/);
  if (!m) return {};
  return Object.fromEntries(
    m[1].split(';').map((d) => d.split(':').map((s) => s.trim())).filter((p) => p.length === 2 && p[0]) as [string, string][],
  );
}
const px = (v: string | undefined) => (v === undefined ? NaN : parseFloat(v));

/** Taille de la zone sensible et encombrement en mise en page, sur un axe. */
function axis(d: Record<string, string>, size: 'width' | 'height') {
  const [a, b] = size === 'width' ? ['margin-left', 'margin-right'] : ['margin-top', 'margin-bottom'];
  const target = px(d[size]);
  return { target, footprint: target + px(d[a]) + px(d[b]) };
}

const outsideMedia = css.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, '');
const coarseBlocks = [...css.matchAll(/@media \(pointer: coarse\)\s*\{((?:[^{}]*\{[^}]*\})*[^{}]*)\}/g)].map((m) => m[1]);

describe('chevron de catégorie — cible', () => {
  it('le bouton porte la classe, sans marge ni rembourrage utilitaires', () => {
    // Du `<button` qui précède l'appel jusqu'à `aria-expanded` : ses attributs.
    const at = sidebar.indexOf('toggleCategory(cat.id)');
    expect(at, 'bouton du chevron').toBeGreaterThan(-1);
    const button = sidebar.slice(sidebar.lastIndexOf('<button', at), sidebar.indexOf('aria-expanded', at));
    expect(button).toContain('category-chevron');
    expect(button).not.toMatch(/-my-1|py-1/);
  });

  it('au moins 24 × 24 px à la souris, sans changer l’encombrement', () => {
    const d = decls(outsideMedia);
    for (const side of ['width', 'height'] as const) {
      const { target, footprint } = axis(d, side);
      expect(target, side).toBeGreaterThanOrEqual(24);
      expect(footprint, side).toBe(ICON);
    }
  });

  it('44 × 44 px au doigt, sans changer l’encombrement', () => {
    const d = decls(coarseBlocks.find((b) => b.includes('.category-chevron')) ?? '');
    for (const side of ['width', 'height'] as const) {
      const { target, footprint } = axis(d, side);
      expect(target, side).toBeGreaterThanOrEqual(44);
      expect(footprint, side).toBe(ICON);
    }
  });
});
