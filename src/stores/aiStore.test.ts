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
  // Une session ouverte : une réponse arrivée sans jeton est ignorée.
  useAuthStore.setState({ backendToken: 'tok' });
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
  describe('a load that outlives its session', () => {
    it('is ignored when the user logged out while it was in flight', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
      let answer!: (v: unknown) => void;
      vi.mocked(getAiConfig).mockReturnValue(new Promise((r) => { answer = r; }) as never);
      const loading = useAiStore.getState().load();
      useAuthStore.getState().logoutBackend();
      answer(ON);
      await loading;
      vi.unstubAllGlobals();
      expect(useAiStore.getState().config).toBeNull();
    });
    it('is ignored when another account signed in meanwhile, failure included', async () => {
      let fail!: (e: unknown) => void;
      vi.mocked(getAiConfig).mockReturnValue(new Promise((_r, reject) => { fail = reject; }) as never);
      const loading = useAiStore.getState().load();
      useAuthStore.setState({ backendToken: 'other' });
      fail(new Error('network'));
      await loading;
      expect(useAiStore.getState().config).toBeNull();
    });
    it('is ignored when there was no session to begin with', async () => {
      useAuthStore.setState({ backendToken: null });
      vi.mocked(getAiConfig).mockResolvedValue(ON);
      await useAiStore.getState().load();
      expect(useAiStore.getState().config).toBeNull();
    });
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
    it('turns the automatic summary translation off when the user logs out', () => {
      useAuthStore.setState({ backendToken: 't' });
      useUiStore.getState().setAiAutoSummaryTranslate(true);
      useAuthStore.getState().logoutBackend();
      expect(useUiStore.getState().aiAutoSummaryTranslate).toBe(false);
      expect(localStorage.getItem('frirss_aiAutoSummaryTranslate')).toBe('false');
    });
    it('clears both cost confirmations when the user logs out', () => {
      useAuthStore.setState({ backendToken: 't' });
      useUiStore.getState().setAiAutoTranslateConfirmed(true);
      useUiStore.getState().setAiAutoSummaryConfirmed(true);
      useAuthStore.getState().logoutBackend();
      expect(useUiStore.getState().aiAutoTranslateConfirmed).toBe(false);
      expect(useUiStore.getState().aiAutoSummaryConfirmed).toBe(false);
      expect(localStorage.getItem('frirss_aiAutoTranslateConfirmed')).toBe('false');
    });
    it('forgets the per-category and per-feed automations and provider choices when the user logs out', () => {
      // Le compte suivant hériterait sinon des traductions et résumés
      // automatiques du précédent, et de ses fournisseurs — peut-être payants.
      useAuthStore.setState({ backendToken: 't' });
      const ui = useUiStore.getState();
      ui.setAiCategoryAutoTranslate('Tech', true);
      ui.setAiCategoryAutoSummary('Dev', true);
      ui.setAiCategoryProvider('Tech', 3);
      ui.setFeedAiAutoTranslate('feed/1', true);
      ui.setFeedAiAutoSummary('feed/1', false);
      ui.setFeedAiProvider('feed/1', 3);
      ui.setFeedLayout('feed/1', 'grid');
      ui.setFeedAiProvider('feed/2', 4);
      useAuthStore.getState().logoutBackend();
      const n = useUiStore.getState();
      expect(n.aiCategoryAutoTranslate).toEqual({});
      expect(n.aiCategoryAutoSummary).toEqual({});
      expect(n.aiCategoryProviders).toEqual({});
      for (const entry of Object.values(n.feedSettings)) {
        for (const k of ['aiAutoTranslate', 'aiAutoSummary', 'aiProvider']) expect(entry).not.toHaveProperty(k);
      }
      // Les autres réglages du flux restent ; une entrée vidée disparaît.
      expect(n.feedSettings['feed/1']).toEqual({ layout: 'grid' });
      expect(n.feedSettings).not.toHaveProperty('feed/2');
      expect(JSON.parse(localStorage.getItem('frirss_feedSettings')!)).toEqual(n.feedSettings);
      expect(JSON.parse(localStorage.getItem('frirss_aiCategoryAutoTranslate')!)).toEqual({});
      expect(JSON.parse(localStorage.getItem('frirss_aiCategoryAutoSummary')!)).toEqual({});
      expect(JSON.parse(localStorage.getItem('frirss_aiCategoryProviders')!)).toEqual({});
    });
    it('forgets the preferred and translation providers, but keeps the target language and the fallback, when the user logs out', () => {
      useAuthStore.setState({ backendToken: 't' });
      const ui = useUiStore.getState();
      ui.setAiPreferredProvider(3);
      ui.setAiTranslationProvider(4);
      ui.setAiTranslationLanguage('de');
      ui.setAiFallback(false);
      useAuthStore.getState().logoutBackend();
      const n = useUiStore.getState();
      expect([n.aiPreferredProvider, n.aiTranslationProvider]).toEqual([null, null]);
      expect(localStorage.getItem('frirss_aiPreferredProvider')).toBe('null');
      expect(localStorage.getItem('frirss_aiTranslationProvider')).toBe('null');
      expect([n.aiTranslationLanguage, n.aiFallback]).toEqual(['de', false]);
      ui.setAiFallback(true);
    });
    it('keeps the AI config while the session token merely changes', () => {
      useAuthStore.setState({ backendToken: 't' });
      useAiStore.setState({ config: ON });
      useAuthStore.setState({ backendToken: 'u' });
      expect(useAiStore.getState().config).toBe(ON);
    });
  });
});
