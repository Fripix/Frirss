// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore, UI_SYNC_KEYS } from './uiStore';
import { READING_COLUMN_WIDTH_DEFAULT } from '../lib/readingColumn';

describe('uiStore — colonne de lecture limitée', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ limitReadingColumn: false });
  });

  it('est désactivée par défaut (la pleine largeur reste le comportement historique)', () => {
    expect(useUiStore.getState().limitReadingColumn).toBe(false);
  });

  it('setLimitReadingColumn retient le choix, le persiste, et la clé est synchronisée', () => {
    useUiStore.getState().setLimitReadingColumn(true);
    expect(useUiStore.getState().limitReadingColumn).toBe(true);
    expect(JSON.parse(localStorage.getItem('frirss_limitReadingColumn')!)).toBe(true);
    expect(UI_SYNC_KEYS).toContain('limitReadingColumn');
    useUiStore.getState().setLimitReadingColumn(false);
  });

  it('applyServerPrefs reprend la valeur du serveur, et ignore ce qui n’est pas un booléen', () => {
    useUiStore.getState().applyServerPrefs({ limitReadingColumn: true });
    expect(useUiStore.getState().limitReadingColumn).toBe(true);
    useUiStore.getState().applyServerPrefs({ limitReadingColumn: 'yes' });
    expect(useUiStore.getState().limitReadingColumn).toBe(true);
    useUiStore.getState().applyServerPrefs({ limitReadingColumn: false });
    expect(useUiStore.getState().limitReadingColumn).toBe(false);
  });
});

describe('uiStore — largeur de la colonne de lecture', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ readingColumnWidth: READING_COLUMN_WIDTH_DEFAULT });
  });

  it('vaut 768 par défaut (les 48 rem de la largeur fixe d’origine)', () => {
    expect(useUiStore.getState().readingColumnWidth).toBe(768);
    expect(READING_COLUMN_WIDTH_DEFAULT).toBe(768);
  });

  it('setReadingColumnWidth retient le choix, le persiste, et la clé est synchronisée', () => {
    useUiStore.getState().setReadingColumnWidth(900);
    expect(useUiStore.getState().readingColumnWidth).toBe(900);
    expect(JSON.parse(localStorage.getItem('frirss_readingColumnWidth')!)).toBe(900);
    expect(UI_SYNC_KEYS).toContain('readingColumnWidth');
  });

  it('applyServerPrefs reprend une largeur valide ; hors bornes ou non numérique, le défaut gagne', () => {
    useUiStore.getState().applyServerPrefs({ readingColumnWidth: 640 });
    expect(useUiStore.getState().readingColumnWidth).toBe(640);
    useUiStore.getState().applyServerPrefs({ readingColumnWidth: 200 });
    expect(useUiStore.getState().readingColumnWidth).toBe(768);
    useUiStore.getState().applyServerPrefs({ readingColumnWidth: 'wide' });
    expect(useUiStore.getState().readingColumnWidth).toBe(768);
  });
});
