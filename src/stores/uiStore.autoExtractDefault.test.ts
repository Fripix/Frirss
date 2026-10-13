// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore, UI_SYNC_KEYS } from './uiStore';

describe('uiStore — article complet par défaut', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ feedSettings: {} });
  });

  it('est désactivé par défaut (décision du propriétaire, 2026-10-13)', () => {
    expect(useUiStore.getState().autoExtractDefault).toBe(false);
  });

  it('setAutoExtractDefault retient le choix, le persiste, et la clé est synchronisée', () => {
    useUiStore.getState().setAutoExtractDefault(true);
    expect(useUiStore.getState().autoExtractDefault).toBe(true);
    expect(JSON.parse(localStorage.getItem('frirss_autoExtractDefault')!)).toBe(true);
    expect(UI_SYNC_KEYS).toContain('autoExtractDefault');
    useUiStore.getState().setAutoExtractDefault(false);
  });

  it('applyServerPrefs reprend la valeur du serveur, et ignore ce qui n’est pas un booléen', () => {
    useUiStore.getState().applyServerPrefs({ autoExtractDefault: true });
    expect(useUiStore.getState().autoExtractDefault).toBe(true);
    useUiStore.getState().applyServerPrefs({ autoExtractDefault: 'yes' });
    expect(useUiStore.getState().autoExtractDefault).toBe(true);
    useUiStore.getState().applyServerPrefs({ autoExtractDefault: false });
    expect(useUiStore.getState().autoExtractDefault).toBe(false);
  });

  it('setFeedAutoExtract pose oui, non, ou retire la surcharge', () => {
    useUiStore.getState().setFeedAutoExtract('feed/1', true);
    expect(useUiStore.getState().feedSettings['feed/1']).toEqual({ autoExtract: true });
    useUiStore.getState().setFeedAutoExtract('feed/1', false);
    expect(useUiStore.getState().feedSettings['feed/1']).toEqual({ autoExtract: false });
    useUiStore.getState().setFeedAutoExtract('feed/1', '');
    expect(useUiStore.getState().feedSettings).toEqual({});
  });
});
