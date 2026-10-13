// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore, UI_SYNC_KEYS } from './uiStore';

describe('uiStore — vue à l’ouverture', () => {
  beforeEach(() => localStorage.clear());

  it('ouvre sur la dernière vue par défaut (comportement historique)', () => {
    expect(useUiStore.getState().startupView).toBe('last');
  });

  it('setStartupView retient, persiste, et la clé est synchronisée', () => {
    useUiStore.getState().setStartupView('unread');
    expect(useUiStore.getState().startupView).toBe('unread');
    expect(JSON.parse(localStorage.getItem('frirss_startupView')!)).toBe('unread');
    expect(UI_SYNC_KEYS).toContain('startupView');
    useUiStore.getState().setStartupView('last');
  });

  it('applyServerPrefs normalise une valeur inconnue en « dernière vue »', () => {
    useUiStore.getState().applyServerPrefs({ startupView: 'all' });
    expect(useUiStore.getState().startupView).toBe('all');
    useUiStore.getState().applyServerPrefs({ startupView: 'bogus' });
    expect(useUiStore.getState().startupView).toBe('last');
  });
});
