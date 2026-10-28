import { describe, expect, it } from 'vitest';
import {
  GRID_CARD_WIDTH_DEFAULT,
  GRID_CARD_WIDTH_MAX,
  GRID_CARD_WIDTH_MIN,
  GRID_IMAGE_RATIOS,
  gridCardStyle,
  normalizeGridCardWidth,
  normalizeGridImageRatio,
} from './gridCards';

describe('normalizeGridCardWidth', () => {
  it('garde un multiple de 20 entre 160 et 480', () => {
    expect(normalizeGridCardWidth(160)).toBe(160);
    expect(normalizeGridCardWidth(320)).toBe(320);
    expect(normalizeGridCardWidth(480)).toBe(480);
  });

  it('rend le défaut actuel, 240, pour toute autre valeur', () => {
    // Client plus ancien, chaîne, valeur trafiquée : jamais une grille cassée.
    expect(GRID_CARD_WIDTH_DEFAULT).toBe(240);
    for (const v of [undefined, null, '300', 150, 500, 250, 240.5, NaN, Infinity]) {
      expect(normalizeGridCardWidth(v)).toBe(240);
    }
  });

  it('borne le curseur aux mêmes valeurs', () => {
    expect([GRID_CARD_WIDTH_MIN, GRID_CARD_WIDTH_MAX]).toEqual([160, 480]);
  });
});

describe('normalizeGridImageRatio', () => {
  it('accepte les trois formats proposés, 16:9 en tête', () => {
    expect(GRID_IMAGE_RATIOS).toEqual(['16:9', '4:3', '1:1']);
    for (const r of GRID_IMAGE_RATIOS) expect(normalizeGridImageRatio(r)).toBe(r);
  });

  it('rend 16:9 pour toute autre valeur', () => {
    for (const v of [undefined, null, '3:2', 'original', 1, {}]) {
      expect(normalizeGridImageRatio(v)).toBe('16:9');
    }
  });
});

describe('gridCardStyle', () => {
  it('par défaut, reproduit exactement la grille actuelle', () => {
    expect(gridCardStyle(240, '16:9')).toEqual({
      '--grid-card-min': '240px',
      '--grid-card-min-mobile': '160px',
      '--grid-card-ratio': '16 / 9',
    });
  });

  it('réduit la largeur d’un tiers sur téléphone, arrondie au pixel', () => {
    expect(gridCardStyle(480, '1:1')['--grid-card-min-mobile']).toBe('320px');
    expect(gridCardStyle(260, '4:3')['--grid-card-min-mobile']).toBe('173px');
  });

  it('écrit le format en syntaxe CSS', () => {
    expect(gridCardStyle(240, '4:3')['--grid-card-ratio']).toBe('4 / 3');
    expect(gridCardStyle(240, '1:1')['--grid-card-ratio']).toBe('1 / 1');
  });
});
