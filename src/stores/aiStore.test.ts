// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('../api/backend', () => ({ getAiConfig: vi.fn() }));
import { getAiConfig } from '../api/backend';
import { useAiStore, aiUsable } from './aiStore';
import { useAuthStore } from './authStore';
import { useUiStore } from './uiStore';

const ON = { enabled: true, providers: [], userKeysAllowed: false, dailyCap: 50, usageToday: 0, defaultProvider: null };

beforeEach(() => {
  useAuthStore.setState({ backendToken: null });
  useAiStore.getState().reset();
});

describe('aiStore', () => {
  it('starts with no config and loads it', async () => {
    expect(useAiStore.getState().config).toBeNull();
    vi.mocked(getAiConfig).mockResolvedValue({ enabled: true, providers: [], userKeysAllowed: false, dailyCap: 50, usageToday: 0, defaultProvider: null });
    await useAiStore.getState().load();
    expect(useAiStore.getState().config?.enabled).toBe(true);
  });
  it('a failed load leaves the feature off, never throws', async () => {
    vi.mocked(getAiConfig).mockRejectedValue(new Error('network'));
    await expect(useAiStore.getState().load()).resolves.toBeUndefined();
    expect(useAiStore.getState().config).not.toBeNull();
    expect(useAiStore.getState().config?.enabled).toBe(false);
  });
  it('a failed reload keeps the config already loaded', async () => {
    useAiStore.setState({ config: ON });
    vi.mocked(getAiConfig).mockRejectedValue(new Error('network'));
    await expect(useAiStore.getState().load()).resolves.toBeUndefined();
    expect(useAiStore.getState().config).toBe(ON);
  });
  it('aiUsable needs the feature on AND at least one available provider', () => {
    const p = (available: boolean) => ({ id: 1, name: 'P', type: 'openai' as const, hasAdminKey: false, shared: false, hasUserKey: false, available });
    const cfg = { userKeysAllowed: false, dailyCap: 0, usageToday: 0, defaultProvider: null };
    expect(aiUsable(useAiStore.getState())).toBe(false); // not loaded yet
    useAiStore.setState({ config: { ...cfg, enabled: true, providers: [p(true)] } });
    expect(aiUsable(useAiStore.getState())).toBe(true);
    useAiStore.setState({ config: { ...cfg, enabled: true, providers: [p(false)] } });
    expect(aiUsable(useAiStore.getState())).toBe(false);
    useAiStore.setState({ config: { ...cfg, enabled: false, providers: [p(true)] } });
    expect(aiUsable(useAiStore.getState())).toBe(false);
  });
  describe('logout', () => {
    beforeEach(() => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 }))); });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('drops the AI config when the user logs out', () => {
      useAuthStore.setState({ backendToken: 't' });
      useAiStore.setState({ config: ON });
      useAuthStore.getState().logoutBackend();
      expect(useAiStore.getState().config).toBeNull();
    });
    it('turns auto-summary off when the user logs out', () => {
      // Le compte suivant sur ce navigateur n'a pas vu l'avertissement de coût.
      useAuthStore.setState({ backendToken: 't' });
      useUiStore.getState().setAiAutoSummary(true);
      useAuthStore.getState().logoutBackend();
      expect(useUiStore.getState().aiAutoSummary).toBe(false);
      expect(localStorage.getItem('frirss_aiAutoSummary')).toBe('false');
    });
    it('keeps the AI config while the session token merely changes', () => {
      useAuthStore.setState({ backendToken: 't' });
      useAiStore.setState({ config: ON });
      useAuthStore.setState({ backendToken: 'u' });
      expect(useAiStore.getState().config).toBe(ON);
    });
  });
});
