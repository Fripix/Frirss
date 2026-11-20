// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore, UI_SYNC_KEYS } from './uiStore';

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
