// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../api/backend', () => ({
  getPreferences: vi.fn(),
  savePreferences: vi.fn(),
}));

import { getPreferences, savePreferences } from '../api/backend';
import { hydratePrefs, refreshPrefs, stopSync } from './prefsSync';
import { useUiStore } from '../stores/uiStore';
import { useFeedStore } from '../stores/feedStore';
import { useAiStore } from '../stores/aiStore';

const get = vi.mocked(getPreferences);
const save = vi.mocked(savePreferences);

const http = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

/**
 * Un échec de lecture n'est PAS un compte sans préférences. Le confondre
 * réécrivait toutes les préférences synchronisées du compte avec l'état local
 * de ce navigateur — par exemple le résumé IA automatique, remis à faux par la
 * déconnexion, écrasait le vrai enregistré, sur tous les appareils.
 */
describe('hydratePrefs — lecture en échec', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    get.mockReset();
    save.mockReset().mockResolvedValue(undefined);
    useUiStore.setState({ showFavicons: true });
  });

  afterEach(() => {
    stopSync();
    vi.useRealTimers();
  });

  it.each([
    ['une erreur 500', http(500)],
    ['une erreur réseau', new Error('Network Error')],
  ])('%s : rien n’est écrit sur le serveur', async (_label, err) => {
    get.mockRejectedValue(err);
    await hydratePrefs();
    expect(save).not.toHaveBeenCalled();

    // Pas d'écriture différée non plus : sans lecture réussie, aucune valeur
    // connue du serveur, donc rien ne dit ce qui a vraiment changé ici.
    useUiStore.setState({ showFavicons: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
  });

  it('une erreur ne touche pas aux préférences locales', async () => {
    get.mockRejectedValue(http(503));
    await hydratePrefs();
    expect(useUiStore.getState().showFavicons).toBe(true);
  });

  it('réessaie plus tard, et la lecture réussie décide', async () => {
    get.mockRejectedValueOnce(http(502)).mockResolvedValue({ showFavicons: false });
    await hydratePrefs();
    expect(get).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(get).toHaveBeenCalledTimes(2);
    expect(useUiStore.getState().showFavicons).toBe(false);
    expect(save).not.toHaveBeenCalled();

    // La synchronisation tourne enfin : un changement est poussé.
    useUiStore.setState({ showFavicons: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('ne réessaie pas après un 401 : la session est terminée', async () => {
    get.mockRejectedValue(http(401));
    await hydratePrefs();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(get).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it('la déconnexion annule le nouvel essai en attente', async () => {
    get.mockRejectedValue(new Error('Network Error'));
    await hydratePrefs();
    stopSync();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('hydratePrefs — compte réellement neuf', () => {
  beforeEach(() => {
    get.mockReset();
    save.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => stopSync());

  it('un 200 avec {} amorce le serveur depuis l’état local', async () => {
    get.mockResolvedValue({});
    useUiStore.setState({ showFavicons: false });
    await hydratePrefs();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({ showFavicons: false });
  });

  it('un compte qui a déjà des préférences n’est pas réamorcé', async () => {
    get.mockResolvedValue({ showFavicons: true });
    await hydratePrefs();
    expect(save).not.toHaveBeenCalled();
  });
});

/**
 * Un faux serveur qui fusionne clé par clé, comme `server/routes/preferences.ts`
 * (`INSERT OR REPLACE`) : ce qu'un envoi écrit, la lecture suivante le rend.
 */
function fakeServer(initial: Record<string, unknown>) {
  const state: Record<string, unknown> = structuredClone(initial);
  get.mockReset().mockImplementation(async () => structuredClone(state));
  save.mockReset().mockImplementation(async (p) => { Object.assign(state, structuredClone(p)); });
  return state;
}

const refused = (key: string) =>
  Object.assign(new Error('HTTP 400'), { response: { status: 400, data: { code: 'value_too_large', key } } });

/**
 * Reproduit le 2026-10-27 : chaque changement poussait l'instantané complet et
 * le serveur n'était relu qu'au démarrage. Un appareil resté ouvert écrasait
 * donc le panneau IA replié ailleurs dès qu'il repliait une catégorie.
 */
describe('prefsSync — clés modifiées seulement', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    useUiStore.setState({ showFavicons: true, aiPanelCollapsed: false, viewMode: 'normal', collapsedCategories: {} });
  });

  afterEach(() => {
    stopSync();
    vi.useRealTimers();
  });

  it('only changed keys are pushed', async () => {
    fakeServer({ aiPanelCollapsed: false, showFavicons: true });
    await hydratePrefs();
    useUiStore.getState().setAiPanelCollapsed(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toEqual({ aiPanelCollapsed: true });
  });

  it('a stale device never overwrites another device’s key', async () => {
    const server = fakeServer({ aiPanelCollapsed: false, collapsedCategories: {} });
    await hydratePrefs();
    server.aiPanelCollapsed = true; // replié sur un autre appareil
    useUiStore.getState().toggleCategoryCollapsed('cat-1');
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toEqual({ collapsedCategories: { 'cat-1': true } });
    expect(server.aiPanelCollapsed).toBe(true);
  });

  it('a change undone before the push sends nothing', async () => {
    fakeServer({ showFavicons: true });
    await hydratePrefs();
    useUiStore.setState({ showFavicons: false });
    useUiStore.setState({ showFavicons: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
  });

  it('refreshPrefs applies server changes but never a dirty key', async () => {
    const server = fakeServer({ viewMode: 'normal', showFavicons: true });
    await hydratePrefs();
    save.mockRejectedValue(new Error('Network Error')); // la modification reste sale
    useUiStore.getState().setViewMode('compact');
    await vi.advanceTimersByTimeAsync(1000);
    server.viewMode = 'magazine';
    server.showFavicons = false;
    await refreshPrefs();
    expect(useUiStore.getState().viewMode).toBe('compact');
    expect(useUiStore.getState().showFavicons).toBe(false);
  });

  it('refreshPrefs flushes a pending push first', async () => {
    const server = fakeServer({ showFavicons: true });
    await hydratePrefs();
    useUiStore.setState({ showFavicons: false });
    await refreshPrefs(); // avant les 800 ms
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(get.mock.invocationCallOrder[1]);
    expect(server.showFavicons).toBe(false);
    expect(useUiStore.getState().showFavicons).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('a change made during the re-read is not overwritten by it', async () => {
    const server = fakeServer({ viewMode: 'normal' });
    await hydratePrefs();
    let release: () => void = () => {};
    get.mockImplementationOnce(() => new Promise((r) => { release = () => r(structuredClone(server)); }));
    const pending = refreshPrefs();
    await vi.advanceTimersByTimeAsync(0);
    expect(get).toHaveBeenCalledTimes(2); // la relecture est en route
    useUiStore.getState().setViewMode('compact');
    server.viewMode = 'magazine'; // la lecture rapporte un autre changement
    release();
    await pending;
    expect(useUiStore.getState().viewMode).toBe('compact');
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.viewMode).toBe('compact');
  });

  it('dirty keys survive a reload', async () => {
    fakeServer({ viewMode: 'normal', showFavicons: true });
    await hydratePrefs();
    save.mockRejectedValue(new Error('Network Error'));
    useUiStore.getState().setViewMode('compact');
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalled();

    // Rechargement : modules neufs, stores relus depuis le localStorage.
    vi.resetModules();
    const backend = await import('../api/backend');
    const sync = await import('./prefsSync');
    const { useUiStore: freshUi } = await import('../stores/uiStore');
    const state: Record<string, unknown> = { viewMode: 'normal', showFavicons: true };
    vi.mocked(backend.getPreferences).mockImplementation(async () => structuredClone(state));
    vi.mocked(backend.savePreferences).mockImplementation(async (p) => { Object.assign(state, p); });
    try {
      await sync.hydratePrefs();
      expect(freshUi.getState().viewMode).toBe('compact');
      await vi.advanceTimersByTimeAsync(1000);
      expect(vi.mocked(backend.savePreferences).mock.calls.at(-1)?.[0]).toEqual({ viewMode: 'compact' });
      expect(state.viewMode).toBe('compact');
    } finally {
      sync.stopSync();
    }
  });

  it('logging out forgets dirty keys and the known server values', async () => {
    fakeServer({ viewMode: 'normal' });
    await hydratePrefs();
    save.mockRejectedValue(new Error('Network Error'));
    useUiStore.getState().setViewMode('compact');
    await vi.advanceTimersByTimeAsync(1000);
    expect(localStorage.getItem('frirss_prefsDirty')).not.toBeNull();
    stopSync();
    expect(localStorage.getItem('frirss_prefsDirty')).toBeNull();
    expect(localStorage.getItem('frirss_prefsKnown')).toBeNull();
  });

  it('a refused key leaves the batch', async () => {
    const server = fakeServer({ appLogo: 'data:image/png;base64,OLD', viewMode: 'normal' });
    await hydratePrefs();
    save.mockRejectedValueOnce(refused('appLogo'));
    useUiStore.getState().setAppLogo('data:image/png;base64,HUGE');
    useUiStore.getState().setViewMode('compact');
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toEqual({ viewMode: 'compact' });
    expect(server.viewMode).toBe('compact');
    expect(useUiStore.getState().appLogo).toBe('data:image/png;base64,OLD');

    // Et elle ne reste pas sale : le changement suivant part seul.
    useUiStore.setState({ showFavicons: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(save.mock.calls[2][0]).toEqual({ showFavicons: false });
  });

  it('retries on online', async () => {
    const server = fakeServer({ showFavicons: true });
    await hydratePrefs();
    save.mockRejectedValueOnce(new Error('Network Error'));
    useUiStore.setState({ showFavicons: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(server.showFavicons).toBe(false);
  });

  it('retries on return to foreground (refreshPrefs)', async () => {
    const server = fakeServer({ showFavicons: true });
    await hydratePrefs();
    save.mockRejectedValueOnce(new Error('Network Error'));
    useUiStore.setState({ showFavicons: false });
    await vi.advanceTimersByTimeAsync(1000);
    await refreshPrefs();
    expect(save).toHaveBeenCalledTimes(2);
    expect(server.showFavicons).toBe(false);
    expect(useUiStore.getState().showFavicons).toBe(false);
  });

  it('retries with a growing delay, never only on the next change', async () => {
    const server = fakeServer({ showFavicons: true });
    await hydratePrefs();
    save.mockRejectedValueOnce(new Error('Network Error')).mockRejectedValueOnce(new Error('Network Error'));
    useUiStore.setState({ showFavicons: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(save).toHaveBeenCalledTimes(2); // le délai a doublé
    await vi.advanceTimersByTimeAsync(5_000);
    expect(save).toHaveBeenCalledTimes(3);
    expect(server.showFavicons).toBe(false);
  });

  it('articleOrder changed by refreshPrefs reloads the list', async () => {
    const loadArticles = vi.fn(async () => {});
    useFeedStore.setState({ loadArticles, selectedFeed: null });
    useUiStore.setState({ articleOrder: 'newest' });
    const server = fakeServer({ articleOrder: 'newest' });
    await hydratePrefs();
    await refreshPrefs();
    expect(loadArticles).not.toHaveBeenCalled();
    server.articleOrder = 'oldest';
    await refreshPrefs();
    expect(useUiStore.getState().articleOrder).toBe('oldest');
    expect(loadArticles).toHaveBeenCalledTimes(1);
  });

  it('reloads the AI configuration only when an ai* key changed', async () => {
    const load = vi.spyOn(useAiStore.getState(), 'load').mockResolvedValue(undefined);
    const server = fakeServer({ showFavicons: true, aiPanelCollapsed: false });
    await hydratePrefs();
    load.mockClear();
    server.showFavicons = false;
    await refreshPrefs();
    expect(load).not.toHaveBeenCalled();
    server.aiPanelCollapsed = true;
    await refreshPrefs();
    expect(load).toHaveBeenCalledTimes(1);
    load.mockRestore();
  });

  it('a re-read never forces the defaults of a missing key', async () => {
    const server = fakeServer({ showFavicons: true, aiAutoSummary: true });
    await hydratePrefs();
    expect(useUiStore.getState().aiAutoSummary).toBe(true);
    delete server.aiAutoSummary;
    server.showFavicons = false;
    await refreshPrefs();
    expect(useUiStore.getState().showFavicons).toBe(false);
    expect(useUiStore.getState().aiAutoSummary).toBe(true);
  });
});
