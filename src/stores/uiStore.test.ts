// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore } from './uiStore';

describe('uiStore', () => {
  beforeEach(() => localStorage.clear());

  it('setAppLogo stores then clears the logo', () => {
    useUiStore.getState().setAppLogo('https://example.com/logo.png');
    expect(useUiStore.getState().appLogo).toBe('https://example.com/logo.png');
    expect(localStorage.getItem('frirss_appLogo')).toBe('https://example.com/logo.png');

    useUiStore.getState().setAppLogo(null);
    expect(useUiStore.getState().appLogo).toBe(null);
    expect(localStorage.getItem('frirss_appLogo')).toBe(null);
  });

  it('setAppTitle falls back to FriRSS for empty input', () => {
    useUiStore.getState().setAppTitle('   ');
    expect(useUiStore.getState().appTitle).toBe('FriRSS');
    useUiStore.getState().setAppTitle('My Reader');
    expect(useUiStore.getState().appTitle).toBe('My Reader');
  });

  it('applyServerPrefs applies raw-string prefs', () => {
    useUiStore.getState().applyServerPrefs({ viewMode: 'compact', appTitle: 'Hello' });
    expect(useUiStore.getState().viewMode).toBe('compact');
    expect(useUiStore.getState().appTitle).toBe('Hello');
  });

  it('applyServerPrefs ignores non-object input', () => {
    const before = useUiStore.getState().viewMode;
    useUiStore.getState().applyServerPrefs(null);
    expect(useUiStore.getState().viewMode).toBe(before);
  });
});
