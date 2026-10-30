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
import { useAuthStore } from '../stores/authStore';

const get = vi.mocked(getPreferences);
const save = vi.mocked(savePreferences);

const b64url = (v: string) => btoa(v).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
let jtiSeq = 0;
/** Un jeton de session FriRSS pour `userId` (chaque appel en donne un nouveau, comme un renouvellement). */
const jwtFor = (userId: number) => `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ userId, jti: `j${++jtiSeq}` }))}.sig`;
/** Ouvre la session de `userId` dans ce navigateur (store + localStorage, relu par un module neuf). */
function signIn(userId: number): string {
  const token = jwtFor(userId);
  localStorage.setItem('frirss_backendToken', token);
  useAuthStore.setState({ backendToken: token, backendUser: null });
  return token;
}

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

  // Une modification faite pendant la panne n'était suivie par personne : la
  // lecture finalement réussie la recouvrait de la valeur du serveur, sans
  // rien dire (PWA ouverte hors ligne). Elle gagne et repart.
  it('une modification faite pendant la panne survit à la lecture qui réussit, puis part', async () => {
    get.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValue({ showFavicons: true, viewMode: 'list' });
    await hydratePrefs();
    useUiStore.setState({ showFavicons: false });
    await vi.advanceTimersByTimeAsync(6000);
    expect(get).toHaveBeenCalledTimes(2);
    expect(useUiStore.getState().showFavicons).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ showFavicons: false }));
  });

  it('… aussi avec un compte connecté et plusieurs réessais', async () => {
    signIn(7);
    get.mockRejectedValueOnce(new Error('Network Error')).mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValue({ showFavicons: true, viewMode: 'list' });
    await hydratePrefs();
    useUiStore.setState({ showFavicons: false });
    await vi.advanceTimersByTimeAsync(5_500);   // premier réessai, encore en échec
    await vi.advanceTimersByTimeAsync(10_500);  // second réessai, réussi
    expect(get).toHaveBeenCalledTimes(3);
    expect(useUiStore.getState().showFavicons).toBe(false);
  });

  it('une erreur ne touche pas aux préférences locales', async () => {
    get.mockRejectedValue(http(503));
    await hydratePrefs();
    expect(useUiStore.getState().showFavicons).toBe(true);
  });

  // Le serveur plafonne les préférences d'un compte : ce refus ne passera pas
  // tout seul. `armPushRetry` retentait sans fin, sans rien dire.
  it('un total dépassé n’est pas retenté, et se dit une seule fois', async () => {
    get.mockResolvedValue({ showFavicons: true });
    await hydratePrefs();
    await vi.advanceTimersByTimeAsync(1000);
    save.mockClear();
    save.mockRejectedValue(Object.assign(new Error('413'), { response: { status: 413, data: { code: 'preferences_too_large' } } }));
    useUiStore.setState({ toasts: [] });
    useUiStore.setState({ showFavicons: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().toasts).toHaveLength(1);
    // Un autre réglage réessaie (le compte a pu maigrir), sans redire la même chose.
    useUiStore.setState({ showFavicons: true });
    useUiStore.setState({ showDateSeparators: true } as never);
    await vi.advanceTimersByTimeAsync(1000);
    expect(useUiStore.getState().toasts.length).toBeLessThanOrEqual(1);
    save.mockReset();
    save.mockResolvedValue(undefined as never);
  });

  // `refreshPrefs` relance l'envoi à chaque relecture (60 s, focus) : le même
  // lot refusé repartait chaque minute.
  it('ne renvoie pas un lot déjà refusé à la relecture suivante', async () => {
    get.mockResolvedValue({ showFavicons: true });
    await hydratePrefs();
    await vi.advanceTimersByTimeAsync(1000);
    save.mockClear();
    save.mockRejectedValue(Object.assign(new Error('413'), { response: { status: 413, data: { code: 'preferences_too_large' } } }));
    useUiStore.setState({ showFavicons: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
    await refreshPrefs();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  // Dit une fois, jusqu'au prochain envoi réussi : annuler le changement, puis
  // le refaire, ne disait plus rien.
  it('redit le refus après une annulation', async () => {
    get.mockResolvedValue({ showFavicons: true });
    await hydratePrefs();
    await vi.advanceTimersByTimeAsync(1000);
    save.mockRejectedValue(Object.assign(new Error('413'), { response: { status: 413, data: { code: 'preferences_too_large' } } }));
    useUiStore.setState({ toasts: [], showFavicons: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(useUiStore.getState().toasts).toHaveLength(1);
    useUiStore.setState({ showFavicons: true });
    await vi.advanceTimersByTimeAsync(1000);
    useUiStore.setState({ showFavicons: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(useUiStore.getState().toasts).toHaveLength(2);
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
    signIn(1);
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

  // La relecture part, l'utilisateur change un réglage, son envoi (minuscule)
  // aboutit AVANT la réponse de la lecture (qui transporte `appLogo`), lue côté
  // serveur avant l'écriture : sa vieille valeur ne doit pas revenir.
  it('a re-read that started before a successful push never undoes it', async () => {
    const server = fakeServer({ viewMode: 'normal' });
    await hydratePrefs();
    const stale = structuredClone(server);
    let release: () => void = () => {};
    get.mockImplementationOnce(() => new Promise((r) => { release = () => r(stale); }));
    const pending = refreshPrefs();
    await vi.advanceTimersByTimeAsync(0);
    expect(get).toHaveBeenCalledTimes(2);
    useUiStore.getState().setViewMode('compact');
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.viewMode).toBe('compact'); // l'envoi a réussi
    release();
    await pending;
    expect(useUiStore.getState().viewMode).toBe('compact');

    // Et la valeur connue reste celle envoyée : rien ne repart, rien ne revient.
    await refreshPrefs();
    expect(useUiStore.getState().viewMode).toBe('compact');
    expect(save).toHaveBeenCalledTimes(1);
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

  // PWA ouverte sans réseau, réglage changé, puis l'app est tuée en arrière-
  // plan (courant sur iOS) avant le retour du réseau : la clé sale ne vivait
  // qu'en mémoire, et la lecture réussie du démarrage suivant recouvrait la
  // valeur locale de celle du serveur.
  it('une modification faite pendant une panne survit au rechargement avant le retour du réseau', async () => {
    fakeServer({ viewMode: 'normal', showFavicons: true });
    await hydratePrefs(); // une session précédente, réussie : le compte est connu ici

    // Démarrage hors ligne : la lecture échoue, l'utilisateur change un réglage.
    vi.clearAllTimers();
    vi.resetModules();
    const b1 = await import('../api/backend');
    const s1 = await import('./prefsSync');
    const { useUiStore: ui1 } = await import('../stores/uiStore');
    vi.mocked(b1.getPreferences).mockReset().mockRejectedValue(new Error('Network Error'));
    await s1.hydratePrefs();
    ui1.getState().setViewMode('compact');

    // L'app est tuée, puis rouverte avec le réseau.
    vi.clearAllTimers();
    vi.resetModules();
    const b2 = await import('../api/backend');
    const s2 = await import('./prefsSync');
    const { useUiStore: ui2 } = await import('../stores/uiStore');
    const state: Record<string, unknown> = { viewMode: 'normal', showFavicons: true };
    vi.mocked(b2.getPreferences).mockReset().mockImplementation(async () => structuredClone(state));
    vi.mocked(b2.savePreferences).mockReset().mockImplementation(async (q) => { Object.assign(state, q); });
    try {
      await s2.hydratePrefs();
      expect(ui2.getState().viewMode).toBe('compact');
      await vi.advanceTimersByTimeAsync(1000);
      expect(state.viewMode).toBe('compact');
    } finally {
      s1.stopSync();
      s2.stopSync();
    }
  });

  // Avant la première lecture réussie, le retour du réseau attendait le
  // réessai suivant (jusqu'à 60 s) : personne n'écoutait `online`.
  it('relit dès le retour du réseau, sans attendre le réessai', async () => {
    get.mockReset().mockRejectedValueOnce(new Error('Network Error')).mockResolvedValue({ viewMode: 'normal' });
    await hydratePrefs();
    expect(get).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('a renewed token for the same user keeps the dirty keys', async () => {
    fakeServer({ viewMode: 'normal' });
    await hydratePrefs();
    save.mockRejectedValue(new Error('Network Error'));
    useUiStore.getState().setViewMode('compact');
    await vi.advanceTimersByTimeAsync(1000);
    const server = fakeServer({ viewMode: 'normal' });
    signIn(1); // nouveau jeton, même compte
    await hydratePrefs();
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.viewMode).toBe('compact');
  });

  // Retour OIDC : le jeton de B est posé par-dessus celui de A, encore
  // stocké, sans passer par la déconnexion (donc sans `stopSync`). Les clés
  // sales de A ne doivent ni s'appliquer ni partir sur le compte de B.
  it('dirty keys of another account are never applied nor pushed', async () => {
    fakeServer({ viewMode: 'normal' });
    await hydratePrefs();
    save.mockRejectedValue(new Error('Network Error'));
    useUiStore.getState().setViewMode('compact'); // A, hors ligne
    await vi.advanceTimersByTimeAsync(1000);
    expect(localStorage.getItem('frirss_prefsDirty')).toContain('viewMode');

    // Rechargement sur le retour OIDC de B : la page d'avant meurt avec ses
    // minuteurs (le réessai d'envoi de A).
    vi.clearAllTimers();
    vi.resetModules();
    signIn(2);
    const backend = await import('../api/backend');
    const sync = await import('./prefsSync');
    const { useUiStore: freshUi } = await import('../stores/uiStore');
    const stateB: Record<string, unknown> = { viewMode: 'magazine', showFavicons: true };
    vi.mocked(backend.getPreferences).mockImplementation(async () => structuredClone(stateB));
    const saveB = vi.mocked(backend.savePreferences).mockReset().mockImplementation(async (p) => { Object.assign(stateB, p); });
    try {
      await sync.hydratePrefs();
      expect(freshUi.getState().viewMode).toBe('magazine');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(saveB.mock.calls).toEqual([]);
      expect(stateB.viewMode).toBe('magazine');
    } finally {
      sync.stopSync();
    }
  });

  it('a token switch in the same page drops the previous account’s pending push', async () => {
    fakeServer({ viewMode: 'normal' });
    await hydratePrefs();
    useUiStore.getState().setViewMode('compact'); // A, envoi différé en attente
    const stateB = fakeServer({ viewMode: 'magazine' });
    signIn(2);
    await hydratePrefs();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save).not.toHaveBeenCalled();
    expect(stateB.viewMode).toBe('magazine');
    expect(useUiStore.getState().viewMode).toBe('magazine');
  });

  // Même cas, mais la lecture de B traîne : l'envoi différé de A (800 ms), son
  // réessai ou le retour du réseau ne doivent pas partir pendant cette lecture,
  // avec le jeton de B déjà posé.
  it('a token switch drops the previous account’s push before B’s read answers', async () => {
    fakeServer({ viewMode: 'normal' });
    await hydratePrefs();
    useUiStore.getState().setViewMode('compact'); // A, envoi différé en attente
    let answer: (v: Record<string, unknown>) => void = () => {};
    get.mockImplementation(() => new Promise((r) => { answer = r; }));
    signIn(2);
    const reading = hydratePrefs();
    await vi.advanceTimersByTimeAsync(1000);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save).not.toHaveBeenCalled();
    answer({ viewMode: 'magazine' });
    await reading;
    expect(useUiStore.getState().viewMode).toBe('magazine');
  });

  // Deux retours au premier plan rapprochés : les réponses arrivent dans le
  // désordre. Seule la dernière relecture lancée applique. Le cas qui mord :
  // une clé passée ailleurs à « compact » puis revenue à « normal » ; la
  // relecture récente (« normal », rien à changer) répond d'abord, l'ancienne
  // (« compact ») ensuite — elle reposait la valeur intermédiaire.
  it('an older re-read answering last never overwrites a newer one', async () => {
    fakeServer({ viewMode: 'normal' });
    await hydratePrefs();
    const releases: Array<(v: Record<string, unknown>) => void> = [];
    get.mockImplementation(() => new Promise((r) => { releases.push(r); }));
    const first = refreshPrefs();
    await vi.advanceTimersByTimeAsync(0);
    const second = refreshPrefs();
    await vi.advanceTimersByTimeAsync(0);
    expect(releases).toHaveLength(2);
    releases[1]({ viewMode: 'normal' }); // la plus récente répond d'abord
    await second;
    releases[0]({ viewMode: 'compact' }); // l'ancienne, périmée, ensuite
    await first;
    expect(useUiStore.getState().viewMode).toBe('normal');

    // La valeur connue n'est pas la périmée : revenir à « compact » est bien
    // un changement à envoyer.
    save.mockReset().mockResolvedValue(undefined);
    useUiStore.getState().setViewMode('compact');
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledWith({ viewMode: 'compact' });
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

  // Deux onglets : celui resté sur l'ancien compte se déconnecte (un 401)
  // après qu'un autre a ouvert un autre compte — il effaçait les réglages en
  // attente de ce compte-là.
  it('logging out leaves another account’s pending keys alone', async () => {
    fakeServer({ viewMode: 'normal' });
    await hydratePrefs();
    localStorage.setItem('frirss_prefsOwner', '999');
    localStorage.setItem('frirss_prefsDirty', '["showFavicons"]');
    stopSync();
    expect(localStorage.getItem('frirss_prefsDirty')).toBe('["showFavicons"]');
    expect(localStorage.getItem('frirss_prefsOwner')).toBe('999');
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
