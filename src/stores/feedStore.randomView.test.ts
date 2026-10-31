// @vitest-environment jsdom
//
// L'affichage aléatoire : un tirage qui ne doit jamais se ranger sous la clé d'une
// vue, ni changer la liste sans un geste. Spec :
// docs/superpowers/specs/2026-10-31-random-order-design.md
import { describe, it, expect, vi, beforeEach } from 'vitest';

const idb = vi.hoisted(() => ({
  lists: new Map<string, { articles: never[]; continuation: string | null; cachedAt: number }>(),
  queue: [] as unknown[],
  writes: [] as string[],
}));

vi.mock('../lib/offlineStore', () => ({
  listGet: vi.fn(async (k: string) => idb.lists.get(k)),
  listPut: vi.fn(async (k: string, articles: never[], continuation: string | null) => {
    idb.writes.push(k);
    idb.lists.set(k, { articles, continuation, cachedAt: 1 });
  }),
  listsPatch: vi.fn(async () => {}),
  listEvictOlderThan: vi.fn(async () => {}),
  listsWithoutSource: vi.fn(async () => {}),
  subsGet: vi.fn(async () => undefined),
  subsPut: vi.fn(async () => {}),
  clearOfflineViews: vi.fn(async () => {}),
  queueGet: vi.fn(async () => [...idb.queue]),
  queuePut: vi.fn(async (q: unknown[]) => { idb.queue = [...q]; }),
}));
vi.mock('../api/feeds', () => ({
  getSubscriptionList: vi.fn(), getUnreadCounts: vi.fn(async () => []), getStreamContents: vi.fn(),
  getStarredItems: vi.fn(async () => ({ items: [], continuation: null })),
  markAsRead: vi.fn(async () => {}), markAsUnread: vi.fn(async () => {}), markAsStarred: vi.fn(async () => {}), removeStarred: vi.fn(async () => {}),
  markAllAsRead: vi.fn(async () => {}), getUnreadItemIds: vi.fn(async () => ({ ids: ['1'], complete: true })),
  fetchStreamPage: vi.fn(), subscribeFeed: vi.fn(), editFeed: vi.fn(), unsubscribeFeed: vi.fn(),
  getTagList: vi.fn(async () => []), getStreamItemCount: vi.fn(), setArticleLabel: vi.fn(async () => {}),
  renameTag: vi.fn(), deleteTag: vi.fn(), clearWriteToken: vi.fn(), itemIdsNewerThanEntry: vi.fn(async () => []),
  getStreamIdsSince: vi.fn(), getItemsByIds: vi.fn(),
}));
vi.mock('../api/backend', () => ({ startActualize: vi.fn(), getActualizeStatus: vi.fn() }));
vi.mock('../i18n', () => ({ default: { t: (k: string) => k } }));
vi.mock('../lib/extractCache', () => ({
  peekExtract: vi.fn(() => undefined), getExtract: vi.fn(async () => undefined), putExtract: vi.fn(async () => {}),
  pinExtract: vi.fn(async () => {}), unpinExtractsExcept: vi.fn(async () => {}),
}));
vi.mock('../lib/imageCache', () => ({
  cacheImages: vi.fn(async () => ({ stored: 0, failed: 0, kept: [], sizes: {} })), pruneImages: vi.fn(async () => {}),
}));
vi.mock('../lib/storageEstimate', () => ({ getStorageEstimate: vi.fn(async () => ({ quota: 0, usage: 0 })) }));
vi.mock('../utils/extractContent', () => ({ extractFullContent: vi.fn(async () => { throw new Error('no'); }) }));

const USEC = 1_780_000_000_000_000n;
const dec = (n: number) => String(USEC + BigInt(n));
const tag = (n: number) => `tag:google.com,2005:reader/item/${(USEC + BigInt(n)).toString(16).padStart(16, '0')}`;
const item = (n: number, read = false, feed = 'feed/1') => ({
  id: tag(n), title: `T${n}`, published: 1_780_000_000 + n, origin: { streamId: feed, title: 'F' },
  categories: read ? ['user/-/state/com.google/read'] : [], alternate: [{ href: `https://example.com/${n}` }],
});
const feed1 = { id: 'feed/1', title: 'F1', categories: [] } as never;
const feed2 = { id: 'feed/2', title: 'F2', categories: [] } as never;
const NORMAL = [item(3), item(2), item(1)];

function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const settled = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };

async function load() {
  vi.resetModules();
  const api = await import('../api/feeds');
  for (const f of ['markAsRead', 'markAsUnread', 'markAsStarred', 'removeStarred', 'markAllAsRead'] as const) {
    vi.mocked(api[f]).mockReset().mockResolvedValue(undefined as never);
  }
  vi.mocked(api.getStreamContents).mockReset().mockResolvedValue({ items: NORMAL, continuation: 'page2' } as never);
  vi.mocked(api.getStreamIdsSince).mockReset().mockResolvedValue([3, 2, 1, 40, 50].map(dec) as never);
  vi.mocked(api.getItemsByIds).mockReset().mockImplementation((async (ids: string[]) =>
    // Comme FreshRSS : triés par identifiant, pas dans l'ordre demandé.
    ids.map((id) => item(Number(BigInt(id) - USEC))).sort((a, b) => b.published - a.published)) as never);
  const { useFeedStore } = await import('./feedStore');
  const { useAuthStore } = await import('./authStore');
  const { useUiStore } = await import('./uiStore');
  useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 }, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true } as never);
  useUiStore.setState({ randomCount: 2, randomWindowAmount: 0, randomWindowUnit: 'hours' });
  useFeedStore.setState({ subscriptions: [feed1, feed2] as never, randomView: false } as never);
  return { api, useFeedStore, useAuthStore, useUiStore };
}
type Env = Awaited<ReturnType<typeof load>>;
const state = (env: Env) => env.useFeedStore.getState();
/** La vue ouverte, prête à recevoir sa page suivante. */
const useLoaded = (env: Env) => { env.useFeedStore.setState({ loadingMore: false, revalidating: false } as never); };
const ids = (env: Env) => state(env).articles.map((a) => a.id);
async function opened(filter: 'all' | 'unread' = 'all') {
  const env = await load();
  state(env).selectView(feed1, filter);
  await settled();
  idb.writes = [];
  return env;
}
async function drawn(filter: 'all' | 'unread' = 'all') {
  const env = await opened(filter);
  state(env).setRandomView(true);
  await settled();
  return env;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  idb.lists.clear();
  idb.queue = [];
  idb.writes = [];
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
});

describe('le tirage', () => {
  it('tire le nombre réglé, sans page suivante, dans l’ordre du tirage', async () => {
    const env = await opened();
    const order: string[] = [];
    vi.mocked(env.api.getItemsByIds).mockImplementation((async (asked: string[]) => {
      order.push(...asked);
      return asked.map((id) => item(Number(BigInt(id) - USEC))).sort((a, b) => b.published - a.published);
    }) as never);
    state(env).setRandomView(true);
    await settled();
    expect(state(env)).toMatchObject({ randomView: true, continuation: null, loading: false, revalidating: false });
    expect(ids(env)).toHaveLength(2);
    expect(ids(env).map((id) => BigInt(`0x${id.split('/').pop()}`).toString())).toEqual(order);
  });

  it('demande les paramètres de la vue et de l’ancienneté', async () => {
    const env = await opened('unread');
    env.useUiStore.setState({ randomWindowAmount: 6, randomWindowUnit: 'hours' });
    state(env).setRandomView(true);
    await settled();
    const [stream, opts] = vi.mocked(env.api.getStreamIdsSince).mock.calls[0];
    expect(stream).toBe('feed/1');
    expect(opts.excludeRead).toBe(true);
    expect(opts.cutoffUsec).toBeTypeOf('bigint');
    expect(opts.max).toBe(10_000);
  });

  it('une vue vide donne une liste vide, pas un échec', async () => {
    const env = await opened();
    vi.mocked(env.api.getStreamIdsSince).mockResolvedValue([] as never);
    state(env).setRandomView(true);
    await settled();
    expect(state(env)).toMatchObject({ articles: [], listFailed: false, loading: false });
    expect(env.api.getItemsByIds).toHaveBeenCalledTimes(1);
  });

  it('un refus se dit, et le mode reste', async () => {
    const env = await opened();
    vi.mocked(env.api.getStreamIdsSince).mockRejectedValue(Object.assign(new Error('refused'), { response: { status: 400 } }));
    state(env).setRandomView(true);
    await settled();
    expect(state(env)).toMatchObject({ randomView: true, listFailed: true, loading: false, revalidating: false });
  });

  // `navigator.onLine` ne dit que « une interface est active » : NAS arrêté, VPN
  // coupé, réseau faible. Le choix retirait alors à la vue toute sa lecture gardée.
  it('sans réponse du serveur, la vue normale prend le relais et le réglage reste', async () => {
    const env = await opened();
    vi.mocked(env.api.getStreamIdsSince).mockRejectedValue(new Error('Network Error'));
    vi.mocked(env.api.getStreamContents).mockRejectedValue(new Error('Network Error'));
    idb.lists.set('7@1|feed/1:all', { articles: NORMAL.map((i) => ({ ...i, id: i.id })) as never[], continuation: null, cachedAt: 1 });
    state(env).setRandomView(true);
    await settled();
    expect(state(env).randomView).toBe(false);
    expect(env.useUiStore.getState().feedSettings['feed/1']?.random).toBe(true);
    expect(state(env).articles.length).toBeGreaterThan(0);
    expect(state(env).listFailed).toBe(false);
  });

  it('recharger fait un nouveau tirage', async () => {
    const env = await drawn();
    await state(env).loadArticles();
    await settled();
    expect(env.api.getStreamIdsSince).toHaveBeenCalledTimes(2);
  });
});

describe('rien ne se range sous la clé de la vue', () => {
  it('ni le tirage', async () => {
    await expect(drawn().then(() => idb.writes)).resolves.toEqual([]);
  });

  it('ni un geste, confirmé ou refusé, ni la mémoire de la vue', async () => {
    const env = await drawn();
    const [a, b] = state(env).articles;
    state(env).selectArticle(a);
    await settled();
    await state(env).toggleStar(b);
    await settled();
    vi.mocked(env.api.markAsRead).mockRejectedValue(Object.assign(new Error('refused'), { response: { status: 400 } }));
    await state(env).toggleRead({ ...b, read: false });
    await settled();
    expect(idb.writes).toEqual([]);
    state(env).setRandomView(false);
    await settled();
    expect(ids(env)).toEqual(NORMAL.map((i) => i.id));
  });
});

describe('quitter le mode', () => {
  it('rend la liste normale et sa pagination', async () => {
    const env = await drawn();
    state(env).setRandomView(false);
    expect(state(env).randomView).toBe(false);
    await settled();
    expect(ids(env)).toEqual(NORMAL.map((i) => i.id));
    expect(state(env).continuation).toBe('page2');
  });

  it.each([
    ['un autre flux', (env: Env) => state(env).selectView(feed2)],
    ['l’accueil', (env: Env) => state(env).selectView(null)],
    ['Favoris', (env: Env) => state(env).setFilter('starred')],
    ['À lire plus tard', (env: Env) => state(env).setFilter('readlater')],
    ['une recherche', (env: Env) => { void state(env).search('mot'); }],
  ])('%s y met fin', async (_name, leave) => {
    const env = await drawn();
    leave(env);
    await settled();
    expect(state(env).randomView).toBe(false);
  });

  it('un changement de serveur y met fin', async () => {
    const env = await drawn();
    env.useAuthStore.setState({ activeServerId: '2' } as never);
    await settled();
    expect(state(env).randomView).toBe(false);
  });

  it('l’ouvrir sous Favoris est sans effet', async () => {
    const env = await opened();
    state(env).setFilter('starred');
    await settled();
    state(env).setRandomView(true);
    expect(state(env).randomView).toBe(false);
  });
});

describe('le mode suit la vue', () => {
  it('passer à Non lus refait un tirage, sans lus', async () => {
    const env = await drawn();
    state(env).setFilter('unread');
    await settled();
    expect(state(env).randomView).toBe(true);
    const calls = vi.mocked(env.api.getStreamIdsSince).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][1].excludeRead).toBe(true);
  });

  it('rouvrir le flux affiché refait un tirage', async () => {
    const env = await drawn();
    state(env).selectView(feed1);
    await settled();
    expect(state(env).randomView).toBe(true);
    expect(env.api.getStreamIdsSince).toHaveBeenCalledTimes(2);
  });
});

describe('un tirage périmé est jeté', () => {
  it('quand un autre tirage part', async () => {
    const env = await opened();
    const slow = deferred<string[]>();
    vi.mocked(env.api.getStreamIdsSince).mockReturnValueOnce(slow.promise as never);
    state(env).setRandomView(true);
    await settled();
    vi.mocked(env.api.getStreamIdsSince).mockResolvedValue([dec(90)] as never);
    await state(env).loadArticles();
    slow.resolve([dec(1)]);
    await settled();
    expect(ids(env)).toEqual([tag(90)]);
    expect(state(env).loading).toBe(false);
  });

  it('quand le mode est quitté', async () => {
    const env = await opened();
    const slow = deferred<string[]>();
    vi.mocked(env.api.getStreamIdsSince).mockReturnValueOnce(slow.promise as never);
    state(env).setRandomView(true);
    await settled();
    state(env).setRandomView(false);
    await settled();
    slow.resolve([dec(1)]);
    await settled();
    expect(ids(env)).toEqual(NORMAL.map((i) => i.id));
  });

  it('quand la vue change, sans laisser de chargement', async () => {
    const env = await opened();
    const slow = deferred<string[]>();
    vi.mocked(env.api.getStreamIdsSince).mockReturnValueOnce(slow.promise as never);
    state(env).setRandomView(true);
    await settled();
    state(env).selectView(feed2);
    await settled();
    slow.reject(new Error('Network Error'));
    await settled();
    expect(state(env)).toMatchObject({ selectedFeed: feed2, listFailed: false, loading: false, revalidating: false });
  });
});

describe('la liste ne change pas sans geste', () => {
  it('un retour au premier plan laisse le tirage', async () => {
    const env = await drawn();
    const before = ids(env);
    vi.mocked(env.api.getStreamContents).mockClear();
    await state(env).silentRefresh();
    await settled();
    expect(ids(env)).toEqual(before);
    expect(vi.mocked(env.api.getStreamContents).mock.calls.filter(([stream]) => stream === 'feed/1')).toEqual([]);
  });

  it('les arrivées ne s’annoncent pas', async () => {
    const env = await drawn();
    vi.mocked(env.api.getUnreadCounts).mockResolvedValueOnce([{ id: 'feed/1', count: 1 }] as never)
      .mockResolvedValueOnce([{ id: 'feed/1', count: 9 }] as never);
    await state(env).syncCounts();
    await state(env).syncCounts();
    expect(state(env).newInView).toBe(0);
  });
});

describe('une réponse normale en vol', () => {
  const page2 = { items: [item(100), item(99)], continuation: 'page3' };

  it('une page en vol ne se mêle pas au tirage et ne se range pas, réponse après le tirage', async () => {
    const env = await opened();
    const slow = deferred<typeof page2>();
    vi.mocked(env.api.getStreamContents).mockReturnValueOnce(slow.promise as never);
    useLoaded(env);
    void state(env).loadMore();
    await settled();
    state(env).setRandomView(true);
    await settled();
    const shown = ids(env);
    slow.resolve(page2);
    await settled();
    expect(ids(env)).toEqual(shown);
    expect(state(env)).toMatchObject({ continuation: null, loadingMore: false });
    expect(idb.writes).toEqual([]);
  });

  it('une page en vol ne réduit pas la vue, réponse avant le tirage', async () => {
    const env = await opened();
    const slow = deferred<typeof page2>();
    const ids0 = deferred<string[]>();
    vi.mocked(env.api.getStreamContents).mockReturnValueOnce(slow.promise as never);
    vi.mocked(env.api.getStreamIdsSince).mockReturnValueOnce(ids0.promise as never);
    useLoaded(env);
    void state(env).loadMore();
    await settled();
    state(env).setRandomView(true);
    await settled();
    slow.resolve(page2);
    await settled();
    expect(idb.writes).toEqual([]);
    ids0.resolve([dec(1)]);
    await settled();
    expect(ids(env)).toEqual([tag(1)]);
  });

  it('un chargement normal en vol n’écrase pas le tirage', async () => {
    const env = await load();
    const slow = deferred<unknown>();
    vi.mocked(env.api.getStreamContents).mockReturnValue(slow.promise as never);
    state(env).selectView(feed1, 'all');
    await settled();
    state(env).setRandomView(true);
    await settled();
    const shown = ids(env);
    slow.resolve({ items: NORMAL, continuation: 'page2' });
    await settled();
    expect(ids(env)).toEqual(shown);
    expect(state(env)).toMatchObject({ continuation: null, loading: false, revalidating: false });
    expect(idb.writes).toEqual([]);
  });

  it('un chargement normal terminé après le début d’un tirage ne relâche pas son attente', async () => {
    const env = await load();
    const slow = deferred<unknown>();
    const draw = deferred<string[]>();
    vi.mocked(env.api.getStreamContents).mockReturnValue(slow.promise as never);
    vi.mocked(env.api.getStreamIdsSince).mockReturnValueOnce(draw.promise as never);
    state(env).selectView(feed1, 'all');
    await settled();
    state(env).setRandomView(true);
    await settled();
    slow.resolve({ items: NORMAL, continuation: 'page2' });
    await settled();
    expect(state(env)).toMatchObject({ loading: true, revalidating: true });
    draw.resolve([dec(1)]);
    await settled();
    expect(state(env)).toMatchObject({ loading: false, revalidating: false });
  });

  it('une relecture silencieuse en vol n’écrase pas le tirage', async () => {
    const env = await opened();
    const slow = deferred<unknown>();
    vi.mocked(env.api.getStreamContents).mockReturnValueOnce(slow.promise as never);
    const relecture = state(env).silentRefresh();
    await settled();
    state(env).setRandomView(true);
    await settled();
    const shown = ids(env);
    slow.resolve({ items: NORMAL, continuation: 'page2' });
    await relecture;
    await settled();
    expect(ids(env)).toEqual(shown);
    expect(state(env).continuation).toBeNull();
  });
});

describe('aléatoire par défaut sur un flux', () => {
  const byDefault = (env: Env) => env.useUiStore.getState().setFeedArticleOrder('feed/1', 'random');

  it('ouvrir le flux lance un tirage, sans rien ranger', async () => {
    const env = await load();
    byDefault(env);
    state(env).selectView(feed1);
    await settled();
    expect(state(env).randomView).toBe(true);
    expect(env.api.getStreamIdsSince).toHaveBeenCalledTimes(1);
    expect(env.api.getStreamContents).not.toHaveBeenCalled();
    expect(idb.writes).toEqual([]);
  });

  it('les autres flux et l’accueil gardent leur ordre', async () => {
    const env = await load();
    byDefault(env);
    state(env).selectView(feed2);
    await settled();
    expect(state(env).randomView).toBe(false);
    state(env).selectView(null);
    await settled();
    expect(state(env).randomView).toBe(false);
  });

  it('quitter le flux y met fin, y revenir le relance', async () => {
    const env = await load();
    byDefault(env);
    state(env).selectView(feed1);
    await settled();
    state(env).selectView(feed2);
    await settled();
    expect(state(env).randomView).toBe(false);
    state(env).selectView(feed1);
    await settled();
    expect(state(env).randomView).toBe(true);
  });

  it('le bouton est le réglage : éteint, il le retire et le flux reste normal', async () => {
    const env = await load();
    byDefault(env);
    state(env).selectView(feed1);
    await settled();
    state(env).setRandomView(false);
    await settled();
    expect(env.useUiStore.getState().feedSettings['feed/1']?.random).toBeUndefined();
    state(env).selectView(feed2);
    await settled();
    state(env).selectView(feed1);
    await settled();
    expect(state(env).randomView).toBe(false);
  });

  // « Si l'option est choisie, elle reste fixe » : le bouton ne valait que la visite.
  it('le bouton reste choisi après être parti du flux', async () => {
    const env = await opened();
    state(env).setRandomView(true);
    await settled();
    expect(env.useUiStore.getState().feedSettings['feed/1']?.random).toBe(true);
    state(env).selectView(feed2);
    await settled();
    expect(state(env).randomView).toBe(false);
    state(env).selectView(feed1);
    await settled();
    expect(state(env).randomView).toBe(true);
  });

  it('il garde l’ordre propre du flux pour le jour où on l’éteint', async () => {
    const env = await load();
    env.useUiStore.getState().setFeedArticleOrder('feed/1', 'oldest');
    state(env).selectView(feed1);
    await settled();
    state(env).setRandomView(true);
    await settled();
    state(env).setRandomView(false);
    await settled();
    expect(env.useUiStore.getState().feedSettings['feed/1']).toEqual({ order: 'oldest' });
  });

  it('l’accueil retient aussi son choix', async () => {
    const env = await load();
    state(env).selectView(null);
    await settled();
    state(env).setRandomView(true);
    await settled();
    state(env).selectView(feed1);
    await settled();
    expect(state(env).randomView).toBe(false);
    state(env).selectView(null);
    await settled();
    expect(state(env).randomView).toBe(true);
  });

  it('une catégorie aussi', async () => {
    const env = await load();
    const cat = { id: 'user/-/label/Tech', title: 'Tech' } as never;
    state(env).selectView(cat);
    await settled();
    state(env).setRandomView(true);
    await settled();
    state(env).selectView(feed1);
    await settled();
    state(env).selectView(cat);
    await settled();
    expect(state(env).randomView).toBe(true);
  });

  it('une recherche ne retire pas le choix', async () => {
    const env = await load();
    state(env).selectView(feed1);
    await settled();
    state(env).setRandomView(true);
    await settled();
    void state(env).search('mot');
    await settled();
    expect(state(env).randomView).toBe(false);
    expect(env.useUiStore.getState().feedSettings['feed/1']?.random).toBe(true);
  });

  it('revient après Favoris', async () => {
    const env = await load();
    byDefault(env);
    state(env).selectView(feed1);
    await settled();
    state(env).setFilter('starred');
    await settled();
    expect(state(env).randomView).toBe(false);
    state(env).setFilter('all');
    await settled();
    expect(state(env).randomView).toBe(true);
  });

  it('hors ligne, le flux s’ouvre normalement', async () => {
    const env = await load();
    byDefault(env);
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    state(env).selectView(feed1);
    await settled();
    expect(state(env).randomView).toBe(false);
    expect(env.api.getStreamIdsSince).not.toHaveBeenCalled();
  });
});

describe('hors ligne', () => {
  const offline = () => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });

  it('une vue en tirage s’ouvre normalement, et son réglage reste', async () => {
    const env = await drawn();
    offline();
    vi.mocked(env.api.getStreamIdsSince).mockClear();
    state(env).selectView(feed1);
    await settled();
    expect(state(env).randomView).toBe(false);
    expect(env.api.getStreamIdsSince).not.toHaveBeenCalled();
    expect(env.useUiStore.getState().feedSettings['feed/1']?.random).toBe(true);
  });

  it('Tous ↔ Non lus aussi', async () => {
    const env = await drawn();
    offline();
    vi.mocked(env.api.getStreamIdsSince).mockClear();
    state(env).setFilter('unread');
    await settled();
    expect(state(env).randomView).toBe(false);
    expect(env.api.getStreamIdsSince).not.toHaveBeenCalled();
  });

  it('choisir Aléatoire retient le choix sans lancer de tirage', async () => {
    const env = await opened();
    offline();
    state(env).setRandomView(true);
    await settled();
    expect(state(env).randomView).toBe(false);
    expect(env.useUiStore.getState().feedSettings['feed/1']?.random).toBe(true);
    expect(env.api.getStreamIdsSince).not.toHaveBeenCalled();
    expect(state(env).articles.length).toBe(NORMAL.length);
  });
});

describe('une vue qui entre dans le mode sans le bouton', () => {
  it('une page en vol ne s’y ajoute pas et ne range pas le tirage', async () => {
    const env = await opened();
    env.useUiStore.getState().setFeedArticleOrder('feed/1', 'random');
    const slow = deferred<unknown>();
    vi.mocked(env.api.getStreamContents).mockReturnValueOnce(slow.promise as never);
    useLoaded(env);
    void state(env).loadMore();
    await settled();
    state(env).selectView(feed1);
    await settled();
    const shown = ids(env);
    slow.resolve({ items: [item(100), item(99)], continuation: 'page3' });
    await settled();
    expect(ids(env)).toEqual(shown);
    expect(idb.writes).toEqual([]);
    expect(state(env).loadingMore).toBe(false);
  });
});

describe('le réglage de la vue fait foi', () => {
  it('éteint depuis un autre appareil, rouvrir le flux rend la liste normale', async () => {
    const env = await drawn();
    env.useUiStore.setState({ feedSettings: {} });
    state(env).selectView(feed1);
    await settled();
    expect(state(env).randomView).toBe(false);
  });

  it('syncRandomView recale la vue quand les préférences arrivent après elle', async () => {
    const env = await drawn();
    env.useUiStore.setState({ feedSettings: {} });
    state(env).syncRandomView();
    await settled();
    expect(state(env).randomView).toBe(false);
    expect(ids(env)).toEqual(NORMAL.map((i) => i.id));
  });

  it('syncRandomView ne fait rien si la vue est déjà juste', async () => {
    const env = await drawn();
    vi.mocked(env.api.getStreamIdsSince).mockClear();
    state(env).syncRandomView();
    await settled();
    expect(env.api.getStreamIdsSince).not.toHaveBeenCalled();
  });

  it('se désabonner du flux ouvert rend à l’accueil son propre choix, et efface celui du flux', async () => {
    const env = await load();
    state(env).selectView(null);
    await settled();
    state(env).setRandomView(true);
    await settled();
    state(env).selectView(feed1);
    await settled();
    state(env).setRandomView(true);
    await settled();
    vi.mocked(env.api.unsubscribeFeed).mockResolvedValue(undefined as never);
    await state(env).removeFeed('feed/1');
    await settled();
    expect(state(env)).toMatchObject({ selectedFeed: null, randomView: true });
    expect(env.useUiStore.getState().feedSettings['feed/1']).toBeUndefined();
  });

  it('renommer une catégorie garde son choix', async () => {
    const env = await load();
    const cat = { id: 'user/-/label/Old', title: 'Old' } as never;
    env.useUiStore.getState().setFeedRandom('user/-/label/Old', true);
    env.useFeedStore.setState({ subscriptions: [{ id: 'feed/1', title: 'F', categories: [{ id: 'user/-/label/Old', label: 'Old' }] }] as never });
    expect(cat).toBeTruthy();
    vi.mocked(env.api.renameTag).mockResolvedValue(undefined as never);
    await state(env).renameCategory('user/-/label/Old', 'New');
    const settings = env.useUiStore.getState().feedSettings;
    expect(settings['user/-/label/New']?.random).toBe(true);
    expect(settings['user/-/label/Old']).toBeUndefined();
  });

  it('renommer une étiquette aussi', async () => {
    const env = await load();
    env.useUiStore.getState().setFeedRandom('user/-/label/Old', true);
    vi.mocked(env.api.renameTag).mockResolvedValue(undefined as never);
    await state(env).renameLabel('user/-/label/Old', 'New');
    expect(env.useUiStore.getState().feedSettings['user/-/label/New']?.random).toBe(true);
  });
});

describe('fermer une recherche', () => {
  it('fermer la boîte sans avoir cherché ne refait pas de tirage', async () => {
    const env = await drawn();
    const before = ids(env);
    vi.mocked(env.api.getStreamIdsSince).mockClear();
    state(env).clearSearch();
    await settled();
    expect(env.api.getStreamIdsSince).not.toHaveBeenCalled();
    expect(ids(env)).toEqual(before);
  });

  it('« Tout lu » pendant une recherche rend la vue à son tirage', async () => {
    const env = await drawn();
    await state(env).search('mot');
    await settled();
    expect(state(env).randomView).toBe(false);
    await state(env).markAllAsRead();
    await settled();
    expect(state(env)).toMatchObject({ searchQuery: '', randomView: true });
  });

  it('rend sa vue à l’aléatoire choisi', async () => {
    const env = await drawn();
    await state(env).search('mot');
    await settled();
    expect(state(env).randomView).toBe(false);
    state(env).clearSearch();
    await settled();
    expect(state(env).randomView).toBe(true);
  });

  it('une requête vidée aussi', async () => {
    const env = await drawn();
    await state(env).search('mot');
    await settled();
    await state(env).search('');
    await settled();
    expect(state(env).randomView).toBe(true);
  });
});

describe('les autres sorties', () => {
  it('se désabonner du flux ouvert quitte le mode', async () => {
    const env = await drawn();
    vi.mocked(env.api.unsubscribeFeed).mockResolvedValue(undefined as never);
    await state(env).removeFeed('feed/1');
    await settled();
    expect(state(env).randomView).toBe(false);
  });

  it('se désabonner d’un autre flux le laisse', async () => {
    const env = await drawn();
    vi.mocked(env.api.unsubscribeFeed).mockResolvedValue(undefined as never);
    await state(env).removeFeed('feed/2');
    await settled();
    expect(state(env).randomView).toBe(true);
  });

  it('une recherche ouverte pendant un tirage ne laisse aucun chargement', async () => {
    const env = await opened();
    const slow = deferred<string[]>();
    vi.mocked(env.api.getStreamIdsSince).mockReturnValueOnce(slow.promise as never);
    state(env).setRandomView(true);
    await settled();
    void state(env).search('mot');
    await settled();
    slow.resolve([dec(1)]);
    await settled();
    expect(state(env)).toMatchObject({ randomView: false, revalidating: false });
  });
});

describe('les écritures de masse', () => {
  it('« Tout lu » ne part pas', async () => {
    const env = await drawn();
    await state(env).markAllAsRead();
    expect(env.api.markAllAsRead).not.toHaveBeenCalled();
  });

  it('« Marquer au-dessus » ne part pas', async () => {
    const env = await drawn();
    await state(env).markReadRelative(state(env).articles[0], 'above');
    expect(env.api.itemIdsNewerThanEntry).not.toHaveBeenCalled();
    expect(env.api.markAllAsRead).not.toHaveBeenCalled();
  });
});
