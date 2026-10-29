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

  it('un 401 relayé de FreshRSS compte comme un échec de l’action, la file ne reste pas bloquée (B6)', async () => {
    const { api, useFeedStore, useAuthStore } = await load();
    useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 } as never, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true });
    idb.queue = [act('a', '7@1'), act('b', '7@1')];
    vi.mocked(api.markAsRead).mockRejectedValue(Object.assign(new Error('401'), { response: { status: 401, data: 'Unauthorized!' } }));
    await useFeedStore.getState().replayQueue();
    expect(idb.queue.length).toBe(0);
    expect(useFeedStore.getState().failedActions).toBe(2);
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

describe('actions sans portée (avant 1.8.0) — B12', () => {
  it('ne sont jamais rejouées automatiquement, et partent avec le compte qui se déconnecte', async () => {
    const { api, useFeedStore, useAuthStore } = await load();
    useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 } as never, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true });
    idb.queue = [act('old', undefined), act('new', '7@1'), act('other', '9@3')];
    vi.mocked(api.markAsRead).mockResolvedValue(undefined as never);
    await useFeedStore.getState().replayQueue();
    expect(vi.mocked(api.markAsRead).mock.calls.map((c) => c[0])).toEqual(['new']);
    expect(idb.queue.map((a) => a.articleId)).toEqual(['old', 'other']);
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
    expect(store.subsPut).not.toHaveBeenCalled();
    expect(store.listsWithoutSource).not.toHaveBeenCalled();
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
