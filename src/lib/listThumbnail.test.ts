import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  LIST_THUMB_WIDTH_DEFAULT, LIST_THUMB_WIDTH_MAX, LIST_THUMB_WIDTH_MIN,
  listThumbStyle, normalizeListThumbWidth,
} from './listThumbnail';

describe('taille de la vignette de liste (issue #34)', () => {
  it('reprend par défaut la vignette d’origine, 80 px de large', () => {
    expect(LIST_THUMB_WIDTH_DEFAULT).toBe(80);
    expect(LIST_THUMB_WIDTH_MIN).toBeLessThan(LIST_THUMB_WIDTH_DEFAULT);
    expect(LIST_THUMB_WIDTH_MAX).toBeGreaterThan(LIST_THUMB_WIDTH_DEFAULT);
  });

  it('garde un entier dans les bornes, rend le défaut sinon', () => {
    expect(normalizeListThumbWidth(120)).toBe(120);
    expect(normalizeListThumbWidth(LIST_THUMB_WIDTH_MIN)).toBe(LIST_THUMB_WIDTH_MIN);
    expect(normalizeListThumbWidth(LIST_THUMB_WIDTH_MAX)).toBe(LIST_THUMB_WIDTH_MAX);
    for (const bad of [LIST_THUMB_WIDTH_MIN - 1, LIST_THUMB_WIDTH_MAX + 1, 99.5, '120', null, undefined, NaN]) {
      expect(normalizeListThumbWidth(bad)).toBe(LIST_THUMB_WIDTH_DEFAULT);
    }
  });

  it('pose la largeur en variable CSS', () => {
    expect(listThumbStyle(128)).toEqual({ '--list-thumb-w': '128px' });
  });
});

describe('index.css — .article-row__thumb', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'src/styles/index.css'), 'utf8');
  const rule = css.match(/\.article-row__thumb\s*\{[^}]*\}/)?.[0] ?? '';

  // 80 × 64 : la vignette d'origine (`w-20 h-16`), sans la variable posée.
  it('garde 80 px et le rapport 5:4 d’origine par défaut', () => {
    expect(rule).toMatch(/var\(--list-thumb-w,\s*80px\)/);
    expect(rule).toMatch(/aspect-ratio:\s*5\s*\/\s*4/);
  });

  // Une grande vignette dans une liste étroite (téléphone, colonne de la vue
  // côte à côte) écrasait le titre : elle est bornée à une part de la ligne,
  // jamais sous les 80 px d'origine.
  it('se borne à une part de la ligne, sans jamais passer sous 80 px', () => {
    expect(rule).toMatch(/width:\s*min\(var\(--list-thumb-w,\s*80px\),\s*max\(80px,\s*\d+%\)\)/);
  });
});
