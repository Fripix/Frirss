// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import i18n, { loadLanguage } from './i18n';

/*
 * En ukrainien, la forme `one` couvre 1, 21, 31, 41… (CLDR : n % 10 = 1 et
 * n % 100 ≠ 11) : une chaîne `_one` qui écrit « 1 » en dur annonçait « 1 дія »
 * pour 41 actions. Et `few` (2-4, 22-24…) veut le nominatif pluriel (дії,
 * akcje), pas le génitif pluriel.
 */
beforeAll(async () => {
  await loadLanguage('uk');
  await loadLanguage('pl');
});
const uk = (key: string, opts: { count: number }) => i18n.getFixedT('uk')(key, opts);
const pl = (key: string, opts: { count: number }) => i18n.getFixedT('pl')(key, opts);

describe('pluriels ukrainiens', () => {
  it('la forme one porte le vrai nombre', () => {
    expect(uk('connection.pending', { count: 41 })).toBe('41 дія очікує');
    expect(uk('connection.pending', { count: 1 })).toBe('1 дія очікує');
    expect(uk('connection.syncFailed', { count: 21 })).toBe('Не вдалося синхронізувати 21 дію');
  });

  it('l’avertissement de suppression d’une catégorie compte ses flux', () => {
    const text = uk('preferences.categories.deleteWarning', { count: 21 });
    expect(text).toContain('21');
  });

  it('la forme few', () => {
    expect(uk('connection.pending', { count: 2 })).toBe('2 дії очікують');
    expect(uk('connection.pending', { count: 24 })).toBe('24 дії очікують');
  });
});

describe('pluriels polonais', () => {
  it('la forme few', () => {
    expect(pl('connection.pending', { count: 4 })).toBe('4 akcje oczekują');
    expect(pl('connection.pending', { count: 22 })).toBe('22 akcje oczekują');
  });
});
