// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * File d'actions hors ligne et portée (compte + serveur), relecture du
 * 2026-10-29 : le rejeu ne revérifiait ni la portée ni la session entre deux
 * actions, la mise en file lisait la portée après l'échec réseau, une action
 * en attente écrasait un geste direct plus récent, et le compteur mêlait les
 * comptes. Chaque test recharge les modules : la copie mémoire de la file est
 * un état de module.
 */

const idb = vi.hoisted(() => ({
  lists: new Map<string, { articles: unknown[]; continuation: string | null }>(),
  subs: new Map<string, unknown[]>(),
  queue: [] as Record<string, unknown>[],
}));

vi.mock('../lib/offlineStore', () => ({
  listsPatch: vi.fn(async () => {}),
  listGet: vi.fn(async (k: string) => idb.lists.get(k)),
  listPut: vi.fn(async (k: string, articles: unknown[], continuation: string | null) => { idb.lists.set(k, { articles, continuation }); }),
  listEvictOlderThan: vi.fn(async () => {}),
  listsWithoutSource: vi.fn(async () => {}),
  subsGet: vi.fn(async (k: string) => idb.subs.get(k)),
  subsPut: vi.fn(async (k: string, s: unknown[]) => { idb.subs.set(k, s); }),
  clearOfflineViews: vi.fn(async () => {}),
  queueGet: vi.fn(async () => [...idb.queue]),
  queuePut: vi.fn(async (q: Record<string, unknown>[]) => { idb.queue = [...q]; }),
}));

vi.mock('../api/feeds', () => ({
  getSubscriptionList: vi.fn(), getUnreadCounts: vi.fn(), getStreamContents: vi.fn(),
  getStarredItems: vi.fn(async () => ({ items: [], continuation: null })),
  markAsRead: vi.fn(), markAsUnread: vi.fn(), markAsStarred: vi.fn(), removeStarred: vi.fn(),
  markAllAsRead: vi.fn(), getUnreadItemIds: vi.fn(), fetchStreamPage: vi.fn(), subscribeFeed: vi.fn(),
  editFeed: vi.fn(), unsubscribeFeed: vi.fn(), getTagList: vi.fn(async () => []), getStreamItemCount: vi.fn(),
  setArticleLabel: vi.fn(), renameTag: vi.fn(), deleteTag: vi.fn(), clearWriteToken: vi.fn(), itemIdsNewerThanEntry: vi.fn(),
}));
vi.mock('../api/backend', () => ({ startActualize: vi.fn(), getActualizeStatus: vi.fn() }));
vi.mock('../i18n', () => ({ default: { t: (k: string) => k } }));

async function load() {
  vi.resetModules();
  const api = await import('../api/feeds');
  const store = await import('../lib/offlineStore');
  const { useFeedStore } = await import('./feedStore');
  const { useAuthStore } = await import('./authStore');
  return { api, store, useFeedStore, useAuthStore };
}
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
/** La connexion (changement de portée) lance un rejeu : il lit la file APRÈS
 *  son chargement et rejouerait une action mise en file juste derrière. */
const settled = async () => { await flush(); await flush(); };
const act = (id: string, scope: string | undefined, at = 1) => ({
  key: scope ? `${scope}|${id}|read` : `${id}|read`, articleId: id, type: 'read', value: true, at, attempts: 0,
  ...(scope ? { scope } : {}),
});
const netErr = () => Object.assign(new Error('Network Error'), { response: undefined });
const article = (id: string, read = false) => ({ id, title: id, read, starred: false, labels: [], tags: [], sourceId: 'feed/1' }) as never;
/** Un jeton de forme JWT portant `userId` (lu sans vérification, comme `jwtUserId`). */
const jwt = (userId: number) => `h.${btoa(JSON.stringify({ userId })).replace(/=+$/, '')}.s`;

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  localStorage.clear();
  vi.clearAllMocks();
  idb.queue = [];
  idb.lists.clear();
  idb.subs.clear();
});

describe('rejeu : la portée et la session sont revérifiées avant chaque action', () => {
  it('changement de serveur en plein rejeu : la suite reste en file, intacte (M1)', async () => {
    const { api, useFeedStore, useAuthStore } = await load();
    useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 } as never, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true });
    idb.queue = [act('a', '7@1'), act('b', '7@1')];
    const first = deferred();
    const calls: { id: string; server: unknown }[] = [];
    vi.mocked(api.markAsRead).mockImplementation(async (id) => {
      calls.push({ id: String(id), server: useAuthStore.getState().activeServerId });
      if (id === 'a') await first.promise;
    });
    const p = useFeedStore.getState().replayQueue();
    await flush();
    useAuthStore.getState().setFreshrssAuth('2', 'https://b.example');
    first.resolve();
    await p;
    expect(calls.map((c) => c.id), 'b jamais envoyée au serveur 2').toEqual(['a']);
    // `a` est gardée elle aussi : la bascule a eu lieu pendant son envoi, on ne
    // sait pas quel serveur l'a reçue (renvoyer « lu » est sans danger).
    expect(idb.queue.map((x) => `${x.articleId}:${x.attempts}`)).toEqual(['a:0', 'b:0']);
  });

  it('déconnexion en plein rejeu : rien n’est jeté (M2)', async () => {
    const { api, useFeedStore, useAuthStore } = await load();
    useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 } as never, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true });
    idb.queue = [act('a', '7@1'), act('b', '7@1'), act('c', '7@1')];
    const first = deferred();
    vi.mocked(api.markAsRead).mockImplementation(async (id) => {
      if (id === 'a') {
        await first.promise;
        // Ce que rend le vrai client une fois `serverUrl` vidé : la requête
        // part brute vers Express, route inconnue → 404.
        if (!useAuthStore.getState().serverUrl) throw Object.assign(new Error('404'), { response: { status: 404 } });
        return;
      }
      if (!useAuthStore.getState().serverUrl) throw Object.assign(new Error('404'), { response: { status: 404 } });
    });
    const p = useFeedStore.getState().replayQueue();
    await flush();
    useAuthStore.getState().logoutBackend();
    first.resolve();
    await p;
    expect(idb.queue.map((a) => a.articleId)).toEqual(['a', 'b', 'c']);
    expect(api.markAsRead).toHaveBeenCalledTimes(1);
    expect(useFeedStore.getState().failedActions).toBe(0);
  });

  // N4 : traité comme un refus, un 401 relayé jetait TOUTE la file en un
  // rejeu (50 envois, 50 abandons) — le mot de passe d'API corrigé ensuite,
  // les actions étaient perdues. Ce n'est pas plus la faute de l'action
  // qu'une déconnexion : on s'arrête, on garde tout, et on le dit.
  it('un 401 relayé de FreshRSS arrête le rejeu, garde toute la file sans consommer de tentative, et le signale (N4)', async () => {
    const { api, useFeedStore, useAuthStore } = await load();
    useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 } as never, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true });
    idb.queue = Array.from({ length: 50 }, (_, i) => act(`a${i}`, '7@1', i + 1));
    vi.mocked(api.markAsRead).mockRejectedValue(Object.assign(new Error('401'), { response: { status: 401, data: 'Unauthorized!' } }));
    await useFeedStore.getState().replayQueue();
    expect(api.markAsRead).toHaveBeenCalledTimes(1);
    expect(idb.queue.length).toBe(50);
    expect(idb.queue.every((a) => a.attempts === 0)).toBe(true);
    expect(useFeedStore.getState().failedActions).toBe(0);
    expect(useFeedStore.getState().replayRefusedByServer).toBe(true);
    // Identifiants corrigés : le rejeu suivant passe, l'avertissement tombe.
    vi.mocked(api.markAsRead).mockResolvedValue(undefined as never);
    await useFeedStore.getState().replayQueue();
    expect(idb.queue.length).toBe(0);
    expect(useFeedStore.getState().replayRefusedByServer).toBe(false);
  });

  // N3 : `memeContexte` ne comparait que les deux bouts de l'envoi. Le vrai
  // `editTag` attend `ensureToken()` avant de construire sa requête : un
  // aller-retour 1 → 2 → 1 pendant cette attente l'envoyait au serveur 2,
  // puis le contrôle d'après envoi revoyait le 1 et sortait l'action.
  it('aller-retour de serveur pendant un envoi : l’action est gardée (N3)', async () => {
    const { api, useFeedStore, useAuthStore } = await load();
    useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 } as never, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true });
    idb.queue = [act('a', '7@1')];
    const tokenFetch = deferred();
    const landedOn: unknown[] = [];
    vi.mocked(api.markAsRead).mockImplementation(async () => {
      await tokenFetch.promise;
      landedOn.push(useAuthStore.getState().activeServerId);
      await flush();
    });
    const p = useFeedStore.getState().replayQueue();
    await flush();
    useAuthStore.getState().setFreshrssAuth('2', 'https://b.example');
    tokenFetch.resolve();
    await flush();
    useAuthStore.getState().setFreshrssAuth('1', 'https://a.example');
    await p;
    await flush(); await flush();
    expect(landedOn[0]).toBe('2');
    expect(landedOn.includes('1') || idb.queue.length === 1, `envois : ${landedOn.join()}, file : ${idb.queue.length}`).toBe(true);
  });

  it('NOTRE 401 (jeton FriRSS refusé) garde l’action et les suivantes', async () => {
    const { api, useFeedStore, useAuthStore } = await load();
    useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 } as never, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true });
    idb.queue = [act('a', '7@1'), act('b', '7@1')];
    vi.mocked(api.markAsRead).mockRejectedValue(Object.assign(new Error('401'), { response: { status: 401, data: { error: 'Session expired' } } }));
    await useFeedStore.getState().replayQueue();
    expect(idb.queue.map((a) => a.articleId)).toEqual(['a', 'b']);
    expect(api.markAsRead).toHaveBeenCalledTimes(1);
    expect(useFeedStore.getState().failedActions).toBe(0);
  });
});

describe('mise en file : la portée est celle du geste', () => {
  it('un ✓ fait sous le serveur 1, en échec après la bascule vers le 2, reste au serveur 1 (M3)', async () => {
    const { api, useFeedStore, useAuthStore } = await load();
    useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 } as never, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true });
    useFeedStore.setState({ articles: [article('z')], selectedFeed: null, filter: 'all', searchQuery: '' });
    let fail!: () => void;
    vi.mocked(api.markAsRead).mockImplementationOnce(() => new Promise((_, rej) => { fail = () => rej(netErr()); }));
    const p = useFeedStore.getState().toggleRead(article('z'));
    await flush();
    useAuthStore.getState().setFreshrssAuth('2', 'https://b.example');
    fail();
    await p;
    expect(idb.queue[0]?.scope).toBe('7@1');
  });

  it('retour SSO, `backendUser` encore nul : la portée vient du jeton (B4)', async () => {
    const { api, useFeedStore, useAuthStore } = await load();
    useAuthStore.setState({ backendToken: jwt(7), backendUser: null, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true });
    useFeedStore.setState({ articles: [article('x')], selectedFeed: null, filter: 'all', searchQuery: '' });
    vi.mocked(api.markAsRead).mockRejectedValueOnce(netErr());
    await useFeedStore.getState().toggleRead(article('x'));
    expect(idb.queue[0]?.scope).toBe('7@1');
    useAuthStore.setState({ backendUser: { id: 7 } as never });
    vi.mocked(api.markAsRead).mockResolvedValue(undefined as never);
    await useFeedStore.getState().replayQueue();
    expect(idb.queue.length, 'rejouée une fois l’utilisateur connu').toBe(0);
  });

  it('le compteur d’actions en attente ne compte que celles de la portée active (B5)', async () => {
    const { api, useFeedStore, useAuthStore } = await load();
    idb.queue = [act('a1', '5@1'), act('a2', '5@1'), act('a3', '5@1')];
    useAuthStore.setState({ backendToken: 'jwtB', backendUser: { id: 9 } as never, activeServerId: '4', serverUrl: 'https://b.example', isAuthenticated: true });
    await settled(); // le rejeu que lance la connexion
    useFeedStore.setState({ articles: [article('y')], selectedFeed: null, filter: 'all', searchQuery: '' });
    vi.mocked(api.markAsRead).mockRejectedValueOnce(netErr());
    await useFeedStore.getState().toggleRead(article('y'));
    expect(useFeedStore.getState().pendingActions).toBe(1);
  });
});

describe('attente de la portée, puis retour (M4)', () => {
  it('le retour de la portée relance le rejeu', async () => {
    const { api, useFeedStore, useAuthStore } = await load();
    useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 } as never, activeServerId: '2', serverUrl: 'https://b.example', isAuthenticated: true });
    idb.queue = [act('a', '7@1')];
    await useFeedStore.getState().replayQueue(); // serveur 2 : rien ne part
    expect(api.markAsRead).not.toHaveBeenCalled();
    vi.mocked(api.markAsRead).mockResolvedValue(undefined as never);
    useAuthStore.getState().setFreshrssAuth('1', 'https://a.example');
    await flush(); await flush();
    expect(api.markAsRead).toHaveBeenCalledWith('a');
    expect(idb.queue.length).toBe(0);
  });

  it('un geste direct réussi retire l’action en attente sur le même article', async () => {
    const { api, useFeedStore, useAuthStore } = await load();
    useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 } as never, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true });
    await settled(); // le rejeu que lance la connexion
    useFeedStore.setState({ articles: [article('a')], selectedFeed: null, filter: 'all', searchQuery: '' });
    // A marqué lu hors ligne.
    vi.mocked(api.markAsRead).mockRejectedValueOnce(netErr());
    await useFeedStore.getState().toggleRead(article('a'));
    expect(idb.queue.length).toBe(1);
    // Rendu non lu, en ligne : l'appel direct réussit.
    vi.mocked(api.markAsUnread).mockResolvedValue(undefined as never);
    await useFeedStore.getState().toggleRead(article('a', true));
    expect(idb.queue.length, 'action périmée retirée').toBe(0);
    expect(useFeedStore.getState().pendingActions).toBe(0);
    vi.mocked(api.markAsRead).mockClear();
    await useFeedStore.getState().replayQueue();
    expect(api.markAsRead, 'le dernier geste n’est pas écrasé').not.toHaveBeenCalled();
  });

  it('un geste ancien qui échoue APRÈS un geste plus récent réussi n’entre pas en file', async () => {
    const { api, useFeedStore, useAuthStore } = await load();
    useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 } as never, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true });
    useFeedStore.setState({ articles: [article('a')], selectedFeed: null, filter: 'all', searchQuery: '' });
    let fail!: () => void;
    vi.mocked(api.markAsRead).mockImplementationOnce(() => new Promise((_, rej) => { fail = () => rej(netErr()); }));
    const slow = useFeedStore.getState().toggleRead(article('a'));
    await flush();
    vi.mocked(api.markAsUnread).mockResolvedValue(undefined as never);
    await useFeedStore.getState().toggleRead(article('a', true));
    fail();
    await slow;
    expect(idb.queue.length).toBe(0);
  });

  // N1 (régression du premier tour) : `settleAction` retirait toute action de
  // même clé, y compris celle d'un geste PLUS RÉCENT que celui qui venait de
  // réussir. Le serveur gardait « lu », l'écran « non lu », rien n'était rejoué.
  it('un geste ancien qui réussit tard ne retire pas de la file le geste plus récent (N1)', async () => {
    const { api, useFeedStore, useAuthStore } = await load();
    useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 } as never, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true });
    useFeedStore.setState({ articles: [article('a')], selectedFeed: null, filter: 'all', searchQuery: '' });
    const slow = deferred();
    vi.mocked(api.markAsRead).mockImplementationOnce(() => slow.promise as never);
    const p1 = useFeedStore.getState().toggleRead(article('a', false)); // geste 1 : lu, lent
    await flush();
    vi.mocked(api.markAsUnread).mockRejectedValueOnce(Object.assign(new Error('502'), { response: { status: 502 } }));
    await useFeedStore.getState().toggleRead(article('a', true)); // geste 2 : non lu, 502 → en file
    expect(idb.queue.map((x) => x.value)).toEqual([false]);
    slow.resolve();
    await p1;
    expect(idb.queue.map((x) => x.value), 'le geste le plus récent reste en file').toEqual([false]);
  });

  // N2 : `mergeAction` remplaçait sans comparer l'ordre des gestes.
  it('un geste ancien qui échoue tard n’écrase pas en file le geste plus récent (N2)', async () => {
    const { api, useFeedStore, useAuthStore } = await load();
    useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 } as never, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true });
    useFeedStore.setState({ articles: [article('a')], selectedFeed: null, filter: 'all', searchQuery: '' });
    let fail!: () => void;
    vi.mocked(api.markAsRead).mockImplementationOnce(() => new Promise((_, rej) => { fail = () => rej(Object.assign(new Error('503'), { response: { status: 503 } })); }));
    const p1 = useFeedStore.getState().toggleRead(article('a', false)); // geste 1 : lu
    await flush();
    vi.mocked(api.markAsUnread).mockRejectedValueOnce(Object.assign(new Error('503'), { response: { status: 503 } }));
    await useFeedStore.getState().toggleRead(article('a', true)); // geste 2 : non lu, échec rapide
    fail(); // geste 1 : échec tardif
    await p1;
    expect(idb.queue.map((x) => x.value)).toEqual([false]);
  });

  it('une action relue depuis le stockage (sans numéro) est plus ancienne que tout geste de la session', async () => {
    const { api, useFeedStore, useAuthStore } = await load();
    useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 } as never, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true });
    // Rangée lors d'une session précédente, avec un numéro qui n'a plus de sens ici.
    idb.queue = [{ ...act('a', '7@1'), value: true, seq: 999 }];
    useFeedStore.setState({ articles: [article('a', true)], selectedFeed: null, filter: 'all', searchQuery: '' });
    vi.mocked(api.markAsUnread).mockResolvedValue(undefined as never);
    await useFeedStore.getState().toggleRead(article('a', true));
    expect(idb.queue.length).toBe(0);
  });

  it('un geste direct pendant le rejeu : l’action remplacée n’est pas envoyée', async () => {
    const { api, useFeedStore, useAuthStore } = await load();
    useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 } as never, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true });
    idb.queue = [act('x', '7@1'), act('a', '7@1')];
    const first = deferred();
    vi.mocked(api.markAsRead).mockImplementation(async (id) => { if (id === 'x') await first.promise; });
    const p = useFeedStore.getState().replayQueue();
    await flush();
    useFeedStore.setState({ articles: [article('a', true)], selectedFeed: null, filter: 'all', searchQuery: '' });
    vi.mocked(api.markAsUnread).mockResolvedValue(undefined as never);
    await useFeedStore.getState().toggleRead(article('a', true));
    first.resolve();
    await p;
    expect(vi.mocked(api.markAsRead).mock.calls.map((c) => c[0])).toEqual(['x']);
    expect(idb.queue.length).toBe(0);
  });
});

// N7 (revient sur B12) : le cas courant est un seul compte, et les numéros
// d'article FreshRSS sont horodatés à la microseconde — une collision d'un
// serveur à l'autre est très improbable. Une action d'avant 1.8.0 adopte donc
// la première portée active, comme avant ; ne plus la rejouer la perdait sans
// un mot pour l'utilisateur à un seul compte.
describe('actions sans portée (avant 1.8.0) — N7', () => {
  it('adoptent la première portée active au rejeu : rejouées et comptées', async () => {
    const { api, useFeedStore, useAuthStore } = await load();
    useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 } as never, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true });
    idb.queue = [act('old', undefined), act('new', '7@1'), act('other', '9@3')];
    const gate = deferred();
    vi.mocked(api.markAsRead).mockImplementation(async () => { await gate.promise; });
    const p = useFeedStore.getState().replayQueue();
    await flush();
    expect(useFeedStore.getState().pendingActions, 'comptée dès l’adoption').toBe(2);
    gate.resolve();
    await p;
    expect(vi.mocked(api.markAsRead).mock.calls.map((c) => c[0])).toEqual(['old', 'new']);
    expect(idb.queue.map((a) => a.articleId)).toEqual(['other']);
  });

  it('une action adoptée cède la place à une action de la portée sur le même article', async () => {
    const { api, useFeedStore, useAuthStore } = await load();
    useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 } as never, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true });
    idb.queue = [{ ...act('a', undefined), value: true }, { ...act('a', '7@1'), value: false }];
    vi.mocked(api.markAsUnread).mockResolvedValue(undefined as never);
    await useFeedStore.getState().replayQueue();
    expect(api.markAsRead).not.toHaveBeenCalled();
    expect(api.markAsUnread).toHaveBeenCalledWith('a');
  });

  it('celles qu’aucune portée n’a encore adoptées partent à la déconnexion', async () => {
    const { useFeedStore, useAuthStore } = await load();
    // Hors ligne : pas de rejeu, donc pas d'adoption.
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    useAuthStore.setState({ backendToken: null, backendUser: null, activeServerId: null, serverUrl: '', isAuthenticated: false });
    idb.queue = [act('old', undefined), act('other', '9@3')];
    await useFeedStore.getState().replayQueue();
    useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 } as never });
    useAuthStore.getState().logoutBackend();
    await flush(); await flush();
    expect(idb.queue.map((a) => a.articleId), 'celle d’un autre compte reste pour lui').toEqual(['other']);
  });
});

describe('déconnexion : seules les vues hors ligne du compte qui part sont effacées (B8)', () => {
  it('efface sous le préfixe du compte, pas tout', async () => {
    const { store, useAuthStore } = await load();
    useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 } as never, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true });
    useAuthStore.getState().logoutBackend();
    await flush();
    expect(store.clearOfflineViews).toHaveBeenCalledWith('7@');
  });
});

describe('se désabonner (B10)', () => {
  const f1 = { id: 'feed/12', title: 'Douze', categories: [] } as never;

  it('une bascule de serveur pendant l’appel ne retire rien du nouveau serveur', async () => {
    const { api, store, useFeedStore, useAuthStore } = await load();
    useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 } as never, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true });
    useFeedStore.setState({ subscriptions: [f1], selectedFeed: null, filter: 'all', searchQuery: '', articles: [] });
    const gate = deferred();
    vi.mocked(api.unsubscribeFeed).mockImplementation(async () => { await gate.promise; });
    const p = useFeedStore.getState().removeFeed('feed/12');
    await flush();
    useAuthStore.getState().setFreshrssAuth('2', 'https://b.example');
    // Le serveur 2 a son propre `feed/12`.
    const homonyme = { id: 'feed/12', title: 'Douze du serveur 2', categories: [] } as never;
    useFeedStore.setState({ subscriptions: [homonyme], articles: [{ ...(article('b2') as object), sourceId: 'feed/12' } as never] });
    gate.resolve();
    expect(await p).toBe(true);
    expect(useFeedStore.getState().subscriptions).toEqual([homonyme]);
    expect(useFeedStore.getState().articles.length).toBe(1);
    // N9 : ce qui est gardé hors ligne pour l'ANCIEN serveur est quand même
    // nettoyé, sous la portée et la clé relevées avant l'appel — sans quoi,
    // de retour hors ligne sur le serveur 1, l'accueil réaffichait le flux.
    expect(store.subsPut).toHaveBeenCalledWith('7@1|subscriptions', []);
    expect(store.listsWithoutSource).toHaveBeenCalledWith('7@1|', 'feed/12');
    expect(store.subsPut).not.toHaveBeenCalledWith(expect.stringMatching(/^7@2/), expect.anything());
  });

  it('retire les articles du flux des listes hors ligne de la portée', async () => {
    const { api, store, useFeedStore, useAuthStore } = await load();
    useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 } as never, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true });
    useFeedStore.setState({ subscriptions: [f1], selectedFeed: null, filter: 'all', searchQuery: '', articles: [] });
    vi.mocked(api.unsubscribeFeed).mockResolvedValue(undefined as never);
    expect(await useFeedStore.getState().removeFeed('feed/12')).toBe(true);
    expect(store.listsWithoutSource).toHaveBeenCalledWith('7@1|', 'feed/12');
  });
});

// Troisième relecture (rev-off3) : les bords du rejeu.
describe('rejeu : bords (rev-off3)', () => {
  const login = (s: { setState: (p: object) => void }) =>
    s.setState({ backendToken: 'jwt', backendUser: { id: 7 }, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true });
  const err401 = () => Object.assign(new Error('401'), { response: { status: 401, data: 'Unauthorized!' } });
  const err503 = () => Object.assign(new Error('503'), { response: { status: 503 } });
  const quiet = async () => { await flush(); await flush(); await flush(); };

  // R1 : la portée était relevée APRÈS le chargement de la file, et l'adoption
  // passait avant tout contrôle. Une déconnexion pendant ce chargement faisait
  // adopter les actions d'avant 1.8.0 sous « @ » : jamais rejouées, jamais
  // comptées, jamais retirées.
  it('une déconnexion pendant le premier chargement : pas d’adoption sous « @ » (R1)', async () => {
    const { api, store, useFeedStore, useAuthStore } = await load();
    idb.queue = [act('old', undefined)];
    const firstRead = deferred<Record<string, unknown>[]>();
    vi.mocked(store.queueGet).mockImplementationOnce(() => firstRead.promise as never);
    login(useAuthStore); // lance le rejeu, bloqué sur la lecture
    await flush();
    const snapshot = [...idb.queue];
    useAuthStore.getState().logoutBackend();
    await quiet();
    firstRead.resolve(snapshot);
    await quiet();
    expect(idb.queue.filter((a) => a.scope === '@'), 'adoptée sous une portée fantôme').toEqual([]);
    vi.mocked(api.markAsRead).mockResolvedValue(undefined as never);
    login(useAuthStore);
    await quiet();
    await useFeedStore.getState().replayQueue();
    expect(idb.queue.filter((a) => a.articleId === 'old')).toEqual([]);
  });

  // R2 : l'abonnement remettait l'avertissement à faux à la bascule, puis la
  // fin du rejeu de l'ancien serveur le reposait — affiché sur le nouveau.
  it('bascule pendant l’écriture finale : le refus du serveur 1 ne s’affiche pas sur le 2 (R2)', async () => {
    const { api, store, useFeedStore, useAuthStore } = await load();
    idb.queue = [act('a', '7@1')];
    vi.mocked(api.markAsRead).mockRejectedValue(err401());
    const finalPut = deferred();
    vi.mocked(store.queuePut).mockImplementationOnce(async (q) => { await finalPut.promise; idb.queue = [...q] as never; });
    login(useAuthStore);
    await quiet();
    expect(api.markAsRead).toHaveBeenCalledTimes(1);
    useAuthStore.getState().setFreshrssAuth('2', 'https://b.example');
    await flush();
    finalPut.resolve();
    await quiet();
    expect(useFeedStore.getState().replayRefusedByServer).toBe(false);
  });

  // R3 : plus rien en attente, et le bandeau répétait « FreshRSS refuse les
  // actions en attente » jusqu'au rechargement.
  it('le refus tombe quand un geste direct règle la dernière action de la portée (R3)', async () => {
    const { api, useFeedStore, useAuthStore } = await load();
    idb.queue = [act('a', '7@1')];
    vi.mocked(api.markAsRead).mockRejectedValueOnce(err401());
    login(useAuthStore);
    await quiet();
    expect(useFeedStore.getState().replayRefusedByServer).toBe(true);
    useFeedStore.setState({ articles: [article('a')], selectedFeed: null, filter: 'all', searchQuery: '' });
    vi.mocked(api.markAsRead).mockResolvedValue(undefined as never);
    await useFeedStore.getState().toggleRead(article('a'));
    expect(idb.queue.length).toBe(0);
    expect(useFeedStore.getState().replayRefusedByServer).toBe(false);
  });

  it('le refus tombe quand un rejeu trouve la file vide (R3)', async () => {
    const { useFeedStore, useAuthStore } = await load();
    login(useAuthStore);
    await quiet();
    useFeedStore.setState({ replayRefusedByServer: true });
    await useFeedStore.getState().replayQueue();
    expect(useFeedStore.getState().replayRefusedByServer).toBe(false);
  });

  // R4 : le rejeu est un quatrième sens. Un envoi réussi n'inscrivait rien
  // dans `settledGestures` : un geste plus ancien encore en vol entrait en
  // file après lui, et le rejeu suivant écrasait la dernière intention.
  it('un envoi réussi du rejeu règle les gestes plus anciens encore en vol (R4)', async () => {
    const { api, useFeedStore, useAuthStore } = await load();
    login(useAuthStore);
    await quiet();
    useFeedStore.setState({ articles: [article('a')], selectedFeed: null, filter: 'all', searchQuery: '' });
    let fail!: () => void;
    vi.mocked(api.markAsRead).mockImplementationOnce(() => new Promise((_, rej) => { fail = () => rej(netErr()); }));
    const p1 = useFeedStore.getState().toggleRead(article('a')); // geste 1 : lu, en vol
    await flush();
    vi.mocked(api.markAsUnread).mockRejectedValueOnce(netErr());
    await useFeedStore.getState().toggleRead(article('a', true)); // geste 2 : non lu → file
    expect(idb.queue.map((x) => x.value)).toEqual([false]);
    vi.mocked(api.markAsUnread).mockResolvedValue(undefined as never);
    await useFeedStore.getState().replayQueue(); // retour du réseau
    expect(idb.queue.length).toBe(0);
    fail(); // geste 1 : délai dépassé
    await p1;
    expect(idb.queue.map((x) => x.value), 'le geste dépassé n’entre pas en file').toEqual([]);
  });

  // R6 : `queueLoaded` ne passait à vrai qu'après l'attente ; deux premiers
  // chargements lisaient chacun la file, et le plus lent écrasait en mémoire
  // ce que l'autre venait de mettre en file.
  it('deux premiers chargements concurrents partagent une seule lecture (R6)', async () => {
    const { api, store, useFeedStore, useAuthStore } = await load();
    login(useAuthStore); // le rejeu de connexion lance la 1re lecture…
    const slowRead = deferred<Record<string, unknown>[]>();
    vi.mocked(store.queueGet).mockImplementationOnce(() => slowRead.promise as never);
    useFeedStore.setState({ articles: [article('a'), article('b')], selectedFeed: null, filter: 'all', searchQuery: '' });
    // FreshRSS en difficulté : tout envoi échoue (le rejeu garde « a » pour
    // un nouvel essai, il ne l'envoie pas).
    vi.mocked(api.markAsRead).mockRejectedValue(err503());
    const g = useFeedStore.getState().toggleRead(article('a')); // …et l'échec, une 2e
    await quiet();
    slowRead.resolve([]);
    await g;
    await quiet();
    await useFeedStore.getState().toggleRead(article('b'));
    expect(store.queueGet).toHaveBeenCalledTimes(1);
    expect(idb.queue.map((x) => x.articleId).sort(), 'a perdue').toEqual(['a', 'b']);
  });
});
