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

  // Propre à l'appareil (décision du 2026-11-24), comme la largeur des panneaux.
  it('setLimitReadingColumn retient le choix sur l’appareil, sans le synchroniser', () => {
    useUiStore.getState().setLimitReadingColumn(true);
    expect(useUiStore.getState().limitReadingColumn).toBe(true);
    expect(JSON.parse(localStorage.getItem('frirss_limitReadingColumn')!)).toBe(true);
    expect(UI_SYNC_KEYS).not.toContain('limitReadingColumn');
    useUiStore.getState().setLimitReadingColumn(false);
  });

  it('applyServerPrefs ne touche pas au réglage de l’appareil', () => {
    useUiStore.getState().applyServerPrefs({ limitReadingColumn: true });
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

  it('setReadingColumnWidth retient le choix sur l’appareil, sans le synchroniser', () => {
    useUiStore.getState().setReadingColumnWidth(900);
    expect(useUiStore.getState().readingColumnWidth).toBe(900);
    expect(JSON.parse(localStorage.getItem('frirss_readingColumnWidth')!)).toBe(900);
    expect(UI_SYNC_KEYS).not.toContain('readingColumnWidth');
  });

  it('une largeur hors bornes ou non numérique rend le défaut ; le serveur n’y touche pas', () => {
    useUiStore.getState().setReadingColumnWidth(200);
    expect(useUiStore.getState().readingColumnWidth).toBe(768);
    useUiStore.getState().setReadingColumnWidth('wide' as unknown as number);
    expect(useUiStore.getState().readingColumnWidth).toBe(768);
    useUiStore.getState().setReadingColumnWidth(640);
    useUiStore.getState().applyServerPrefs({ readingColumnWidth: 900 });
    expect(useUiStore.getState().readingColumnWidth).toBe(640);
  });
});
