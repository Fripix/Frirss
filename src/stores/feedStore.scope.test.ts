// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * Données hors ligne et file d'actions, d'un compte ou d'un serveur à l'autre
 * sur le même navigateur (relecture 1.8.0) : la base `frirss-offline` n'était
 * rangée ni par compte ni par serveur, la file était rejouée vers le serveur
 * actif quel qu'il soit (et jetée sans session), une action mise en file
 * pendant un rejeu était écrasée, et la réponse d'un serveur quitté
 * s'affichait sur le nouveau.
 */



// IndexedDB simulée : une seule base pour tout le navigateur, comme en vrai.
const idb = vi.hoisted(() => ({
  lists: new Map<string, { articles: unknown[]; continuation: string | null }>(),
  subs: new Map<string, unknown[]>(),
  queue: [] as unknown[],
}));

vi.mock('../lib/offlineStore', () => ({
  listGet: vi.fn(async (k: string) => idb.lists.get(k)),
  listPut: vi.fn(async (k: string, articles: unknown[], continuation: string | null) => { idb.lists.set(k, { articles, continuation }); }),
  listEvictOlderThan: vi.fn(async () => {}),
  listsWithoutSource: vi.fn(async () => {}),
  subsGet: vi.fn(async (k: string) => idb.subs.get(k)),
  subsPut: vi.fn(async (k: string, s: unknown[]) => { idb.subs.set(k, s); }),
  clearOfflineViews: vi.fn(async () => { idb.lists.clear(); idb.subs.clear(); }),
  queueGet: vi.fn(async () => [...idb.queue]),
  queuePut: vi.fn(async (q: unknown[]) => { idb.queue = [...q]; }),
}));

vi.mock('../api/feeds', () => ({
  getSubscriptionList: vi.fn(),
  getUnreadCounts: vi.fn(),
  getStreamContents: vi.fn(),
  getStarredItems: vi.fn(async () => ({ items: [], continuation: null })),
  markAsRead: vi.fn(),
  markAsUnread: vi.fn(),
  markAsStarred: vi.fn(),
  removeStarred: vi.fn(),
  markAllAsRead: vi.fn(),
  getUnreadItemIds: vi.fn(),
  fetchStreamPage: vi.fn(),
  subscribeFeed: vi.fn(),
  editFeed: vi.fn(),
  unsubscribeFeed: vi.fn(),
  getTagList: vi.fn(async () => []),
  getStreamItemCount: vi.fn(),
  setArticleLabel: vi.fn(),
  renameTag: vi.fn(),
  deleteTag: vi.fn(),
  clearWriteToken: vi.fn(),
  itemIdsNewerThanEntry: vi.fn(),
}));
vi.mock('../api/backend', () => ({ startActualize: vi.fn(), getActualizeStatus: vi.fn() }));
vi.mock('../i18n', () => ({ default: { t: (k: string) => k } }));

import * as api from '../api/feeds';
import { useFeedStore } from './feedStore';
import { useAuthStore } from './authStore';
import type { Article, Subscription } from '../types';

const netErr = () => Object.assign(new Error('Network Error'), { response: undefined });
const art = (id: string, extra: Partial<Article> = {}): Article => ({
  id, title: id, summary: '', content: '', author: '', url: '', source: 'S', sourceId: 'feed/1',
  published: Date.now(), read: false, starred: false, labels: [], tags: [], ...extra,
});
function deferred<T = void>() {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
// La copie en mémoire de la file survit d'un test à l'autre : on ne compte
// que l'action de l'article visé.
const queued = (id: string) => idb.queue.filter((a) => (a as { articleId: string }).articleId === id).length;

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  useAuthStore.setState({ backendToken: 'jwtA', activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true });
});

describe('file hors ligne', () => {
  it('une action mise en file PENDANT un rejeu n’est pas perdue', async () => {
    idb.queue = [];
    useFeedStore.setState({ articles: [art('x'), art('y')], selectedFeed: null, filter: 'all', searchQuery: '' });
    // 1. Hors ligne : X marqué lu → en file.
    vi.mocked(api.markAsRead).mockRejectedValueOnce(netErr());
    await useFeedStore.getState().toggleRead(art('x'));
    expect(idb.queue.length).toBe(1);

    // 2. Le réseau revient : rejeu, dont l'écriture de X reste en vol.
    const replayX = deferred();
    vi.mocked(api.markAsRead).mockReturnValueOnce(replayX.promise);
    const replay = useFeedStore.getState().replayQueue();
    await flush();

    // 3. Pendant ce temps, un favori sur Y échoue (réseau instable) → en file.
    vi.mocked(api.markAsStarred).mockRejectedValueOnce(netErr());
    await useFeedStore.getState().toggleStar(art('y'));
    expect(idb.queue.some((a) => (a as { articleId: string }).articleId === 'y')).toBe(true);

    // 4. Le rejeu se termine.
    replayX.resolve();
    await replay;

    // Attendu : le favori de Y reste en attente. Constaté : la file est écrasée par `remaining`.
    const left = idb.queue.map((a) => (a as { articleId: string }).articleId);
    expect(left, 'favori de Y perdu').toContain('y');
  });

  it('une action mise en file sur le serveur 1 attend ce serveur, jamais le 2', async () => {
    idb.queue = [];
    useFeedStore.setState({ articles: [art('x')], selectedFeed: null, filter: 'all', searchQuery: '' });
    vi.mocked(api.markAsRead).mockRejectedValueOnce(netErr());
    await useFeedStore.getState().toggleRead(art('x'));
    expect(queued('x')).toBe(1);

    // Bascule vers le serveur 2 avant le retour du réseau.
    useAuthStore.getState().setFreshrssAuth('2', 'https://b.example');
    let serverAtCall: unknown = null;
    vi.mocked(api.markAsRead).mockImplementation(async () => { serverAtCall = useAuthStore.getState().activeServerId; });
    await useFeedStore.getState().replayQueue();
    // Elle n'est pas envoyée au serveur 2 (le même numéro d'article y désigne
    // autre chose) : elle attend que le serveur 1 redevienne actif.
    expect(serverAtCall, 'jamais rejouée vers le serveur 2').toBeNull();
    expect(queued('x')).toBe(1);
    useAuthStore.getState().setFreshrssAuth('1', 'https://a.example');
    await useFeedStore.getState().replayQueue();
    expect(serverAtCall).toBe('1');
    expect(queued('x')).toBe(0);
  });

  it('un rejeu sans session (écran de connexion) garde les actions', async () => {
    idb.queue = [];
    useFeedStore.setState({ articles: [art('x')], selectedFeed: null, filter: 'all', searchQuery: '' });
    vi.mocked(api.markAsRead).mockRejectedValueOnce(netErr());
    await useFeedStore.getState().toggleRead(art('x'));
    // Session expirée pendant la coupure → déconnecté ; App rejoue au montage / à `online`
    // quelle que soit la session. Le proxy répond 401 (ou 404 sans serverUrl).
    useAuthStore.getState().logoutBackend();
    vi.mocked(api.markAsRead).mockRejectedValue(Object.assign(new Error('401'), { response: { status: 401 } }));
    await useFeedStore.getState().replayQueue();
    expect(queued('x'), 'action perdue sans avoir été tentée sous une session').toBe(1);
  });
});

describe('déconnexion puis autre compte sur le même navigateur', () => {
  it('le compte B ne voit ni les abonnements ni la liste d’accueil du compte A', async () => {
    idb.lists.clear(); idb.subs.clear(); idb.queue = [];
    const subA = { id: 'feed/1', title: 'Flux privé de A', categories: [] } as unknown as Subscription;
    // Session de A : chargement normal, persisté pour le hors-ligne.
    vi.mocked(api.getSubscriptionList).mockResolvedValueOnce([subA]);
    vi.mocked(api.getUnreadCounts).mockResolvedValueOnce([]);
    vi.mocked(api.getStreamContents).mockResolvedValue({
      items: [{ id: 'a1', title: 'Article privé de A', origin: { streamId: 'feed/1', title: 'A' } }],
      continuation: null,
    } as never);
    useFeedStore.setState({ subscriptions: [], selectedFeed: null, filter: 'all', searchQuery: '' });
    await useFeedStore.getState().loadSubscriptions();
    await useFeedStore.getState().loadArticles();
    await flush();
    expect(idb.subs.size).toBeGreaterThan(0);

    // A se déconnecte ; B se connecte, son FreshRSS ne répond pas (ou B est hors ligne).
    useAuthStore.getState().logoutBackend();
    useAuthStore.getState().setBackendAuth('jwtB', null);
    useAuthStore.getState().setFreshrssAuth('9', 'https://b.example');
    vi.mocked(api.getSubscriptionList).mockRejectedValue(netErr());
    vi.mocked(api.getUnreadCounts).mockRejectedValue(netErr());
    vi.mocked(api.getStreamContents).mockRejectedValue(netErr());
    useFeedStore.getState().resetAndReload(); // ce que fait App au changement d'activeServerId
    await flush(); await flush(); await flush();

    const s = useFeedStore.getState();
    expect.soft(s.subscriptions.map((x) => x.title), 'barre latérale de B').not.toContain('Flux privé de A');
    expect.soft(s.articles.map((a) => a.title), 'liste de B').not.toContain('Article privé de A');
  });
});

describe('changement de serveur pendant un chargement', () => {
  it('la réponse du serveur quitté ne s’affiche pas sur le nouveau', async () => {
    idb.lists.clear();
    useFeedStore.setState({ subscriptions: [], selectedFeed: null, filter: 'all', searchQuery: '', articles: [] });
    const old = deferred<unknown>();
    vi.mocked(api.getStreamContents).mockImplementation(async (_s, _n, _c, _x, opts) => {
      if ((opts as { cacheOnly?: boolean })?.cacheOnly) return null;
      return old.promise as never;
    });
    const p = useFeedStore.getState().loadArticles(); // vue d'accueil, serveur 1
    await flush();

    // Bascule vers le serveur 2 (App → resetAndReload) ; son chargement à lui reste en vol.
    useAuthStore.getState().setFreshrssAuth('2', 'https://b.example');
    const fresh = deferred<unknown>();
    vi.mocked(api.getSubscriptionList).mockReturnValue(new Promise(() => {}));
    vi.mocked(api.getUnreadCounts).mockReturnValue(new Promise(() => {}));
    vi.mocked(api.getStreamContents).mockImplementation(async (_s, _n, _c, _x, opts) => {
      if ((opts as { cacheOnly?: boolean })?.cacheOnly) return null;
      return fresh.promise as never;
    });
    useFeedStore.getState().resetAndReload();

    old.resolve({ items: [{ id: 'old1', title: 'Article du serveur 1', origin: { streamId: 'feed/1' } }], continuation: null });
    await p; await flush();
    const s = useFeedStore.getState();
    expect(s.articles.map((a) => a.title), 'liste du serveur 2').not.toContain('Article du serveur 1');
  });
});

// Se désabonner du flux ouvert le retirait de la barre latérale, mais ses
// articles restaient affichés sous « Tous les flux », avec son compteur.
describe('se désabonner du flux ouvert', () => {
  it('retire ses articles et son compte, et recharge la vue', async () => {
    const f1 = { id: 'feed/1', title: 'Un', categories: [] } as unknown as Subscription;
    const f2 = { id: 'feed/2', title: 'Deux', categories: [] } as unknown as Subscription;
    vi.mocked(api.unsubscribeFeed).mockResolvedValue(undefined as never);
    vi.mocked(api.getStreamContents).mockResolvedValue({ items: [], continuation: null } as never);
    useFeedStore.setState({
      subscriptions: [f1, f2], selectedFeed: f1, filter: 'all', searchQuery: '',
      articles: [art('a', { sourceId: 'feed/1' }), art('b', { sourceId: 'feed/2' })],
      unreadCounts: { 'feed/1': 3, 'feed/2': 1 },
    });
    expect(await useFeedStore.getState().removeFeed('feed/1')).toBe(true);
    await flush();
    const s = useFeedStore.getState();
    expect(s.selectedFeed).toBeNull();
    expect(s.articles.some((a) => a.sourceId === 'feed/1')).toBe(false);
    expect(s.unreadCounts['feed/1']).toBeUndefined();
    expect(api.getStreamContents).toHaveBeenCalled();
  });
});
