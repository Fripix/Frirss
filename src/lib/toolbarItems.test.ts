import { describe, it, expect } from 'vitest';
import {
  TOOLBAR_ITEMS,
  DEFAULT_TOOLBAR_VISIBILITY,
  normalizeToolbarVisibility,
  resetToolbarZone,
  separatorsBefore,
  type ToolbarVisibility,
} from './toolbarItems';

const allHidden = (): ToolbarVisibility =>
  Object.fromEntries(Object.keys(DEFAULT_TOOLBAR_VISIBILITY).map((k) => [k, false])) as unknown as ToolbarVisibility;

describe('registre des éléments masquables', () => {
  it('11 éléments dans la barre de la liste, 12 dans le volet, ids uniques', () => {
    expect(TOOLBAR_ITEMS.filter((i) => i.zone === 'list')).toHaveLength(11);
    expect(TOOLBAR_ITEMS.filter((i) => i.zone === 'reading')).toHaveLength(12);
    expect(new Set(TOOLBAR_ITEMS.map((i) => i.id)).size).toBe(TOOLBAR_ITEMS.length);
  });

  it('tout est visible par défaut, barres comprises', () => {
    expect(Object.values(DEFAULT_TOOLBAR_VISIBILITY).every((v) => v === true)).toBe(true);
    expect(DEFAULT_TOOLBAR_VISIBILITY.listBar).toBe(true);
    expect(DEFAULT_TOOLBAR_VISIBILITY.shortcutBar).toBe(true);
  });
});

describe('normalizeToolbarVisibility — une valeur venue du stockage ou de la synchro', () => {
  it('une valeur inutilisable donne le défaut complet', () => {
    for (const v of [undefined, null, [], 'x', 42]) {
      expect(normalizeToolbarVisibility(v)).toEqual(DEFAULT_TOOLBAR_VISIBILITY);
    }
  });

  it('une clé absente vaut visible (appareil resté sur une version antérieure)', () => {
    const v = normalizeToolbarVisibility({ star: false });
    expect(v.star).toBe(false);
    expect(v.share).toBe(true);
    expect(v.listBar).toBe(true);
  });

  it('une valeur non booléenne vaut visible, une clé inconnue est ignorée', () => {
    const v = normalizeToolbarVisibility({ star: 'no', bogus: false });
    expect(v.star).toBe(true);
    expect('bogus' in v).toBe(false);
  });
});

describe('resetToolbarZone — « Tout réafficher »', () => {
  it('la liste remet ses éléments et la barre entière, rien d’autre', () => {
    const v = resetToolbarZone(allHidden(), 'list');
    for (const i of TOOLBAR_ITEMS) expect(v[i.id]).toBe(i.zone === 'list');
    expect(v.listBar).toBe(true);
    expect(v.shortcutBar).toBe(false);
  });

  it('les raccourcis ne remettent que leur barre', () => {
    const v = resetToolbarZone(allHidden(), 'shortcuts');
    expect(v.shortcutBar).toBe(true);
    expect(v.listBar).toBe(false);
    expect(TOOLBAR_ITEMS.every((i) => v[i.id] === false)).toBe(true);
  });
});

describe('separatorsBefore — jamais de séparateur orphelin', () => {
  it('un séparateur entre deux groupes visibles, jamais en tête', () => {
    expect(separatorsBefore([true, true, true])).toEqual([false, true, true]);
  });
  it('les groupes vides ne comptent pas, ni avant ni après', () => {
    expect(separatorsBefore([false, true, false, true])).toEqual([false, false, false, true]);
    expect(separatorsBefore([true, false, false])).toEqual([false, false, false]);
    expect(separatorsBefore([false, false])).toEqual([false, false]);
  });
});
