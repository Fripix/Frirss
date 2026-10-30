// @vitest-environment jsdom
//
// Les listes d'une vue, en mémoire et hors ligne : ce que la préparation range,
// ce qu'une vue sert quand la sienne manque, et ce qu'un retrait ou un « Tout
// lu » y change. Chaque bloc reproduit un scénario de la relecture de la 1.8.0.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const idb = vi.hoisted(() => ({
  lists: new Map<string, { articles: unknown[]; continuation: string | null }>(),
  blocked: false,
}));

vi.mock('../lib/offlineStore', () => ({
  listsPatch: vi.fn(async () => {}),
  listGet: vi.fn(async (k: string) => (idb.blocked ? undefined : idb.lists.get(k))),
  listPut: vi.fn(async (k: string, articles: unknown[], continuation: string | null) => {
    if (!idb.blocked) idb.lists.set(k, { articles, continuation });
  }),
  listEvictOlderThan: vi.fn(async () => {}),
  listsWithoutSource: vi.fn(async () => {}),
  subsGet: vi.fn(async () => undefined),
  subsPut: vi.fn(async () => {}),
  clearOfflineViews: vi.fn(async () => {}),
  queueGet: vi.fn(async () => []),
  queuePut: vi.fn(async () => {}),
}));
vi.mock('../api/feeds', () => ({
  getSubscriptionList: vi.fn(), getUnreadCounts: vi.fn(async () => []), getStreamContents: vi.fn(),
  getStarredItems: vi.fn(async () => ({ items: [], continuation: null })),
  markAsRead: vi.fn(async () => {}), markAsUnread: vi.fn(async () => {}), markAsStarred: vi.fn(), removeStarred: vi.fn(),
  markAllAsRead: vi.fn(async () => {}), getUnreadItemIds: vi.fn(async () => ({ ids: ['1'], complete: true })),
  fetchStreamPage: vi.fn(), subscribeFeed: vi.fn(), editFeed: vi.fn(), unsubscribeFeed: vi.fn(),
  getTagList: vi.fn(async () => []), getStreamItemCount: vi.fn(), setArticleLabel: vi.fn(),
  renameTag: vi.fn(), deleteTag: vi.fn(), clearWriteToken: vi.fn(), itemIdsNewerThanEntry: vi.fn(),
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

async function load() {
  vi.resetModules();
  const api = await import('../api/feeds');
  const { useFeedStore } = await import('./feedStore');
  const { useAuthStore } = await import('./authStore');
  const { useUiStore } = await import('./uiStore');
  useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 }, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true } as never);
  return { api, useFeedStore, useAuthStore, useUiStore };
}

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const settled = async () => { for (let i = 0; i < 6; i++) await flush(); };
const netErr = () => Object.assign(new Error('Network Error'), { response: undefined });
const setOnline = (on: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });
// Identifiants greader hexadécimaux croissants (plus grand = plus récent).
const hex = (n: number) => `tag:google.com,2005:reader/item/${n.toString(16).padStart(16, '0')}`;
const item = (n: number, read = false, feed = 'feed/1', published = Math.floor(Date.now() / 1000) - n) => ({
  id: hex(n), title: `T${n}`, published, origin: { streamId: feed, title: 'F' },
  categories: read ? ['user/-/state/com.google/read'] : [], alternate: [{ href: `https://example.com/${n}` }],
});
const feed1 = { id: 'feed/1', title: 'F1', categories: [] } as never;
const feed2 = { id: 'feed/2', title: 'F2', categories: [] } as never;
const ids = (list: { id: string }[]) => list.map((a) => a.id);

beforeEach(() => {
  setOnline(true);
  localStorage.clear();
  vi.clearAllMocks();
  idb.lists.clear();
  idb.blocked = false;
});

/** Un flux de `count` articles récents, servi par pages, dans l'ordre demandé. */
function streamOf(api: Awaited<ReturnType<typeof load>>['api'], count: number) {
  const all = Array.from({ length: count }, (_, i) => item(1000 - i));
  vi.mocked(api.getStreamContents).mockImplementation((async (_id: string, n: number, cont: string | null) => {
    const start = cont ? Number(cont) : 0;
    return { items: all.slice(start, start + n), continuation: start + n < all.length ? String(start + n) : null };
  }) as never);
  return all;
}
async function prepare(env: Awaited<ReturnType<typeof load>>) {
  env.useFeedStore.setState({ subscriptions: [feed1] });
  await env.useFeedStore.getState().prepareOffline({ userInitiated: true });
  expect(env.useFeedStore.getState().offlinePrep?.phase).toBe('done');
}
function goOffline(env: Awaited<ReturnType<typeof load>>) {
  setOnline(false);
  vi.mocked(env.api.getStreamContents).mockRejectedValue(netErr());
}

describe('hors ligne, quand la liste exacte d’une vue manque', () => {
  it('un flux préparé s’ouvre sous le filtre Non lus', async () => {
    const env = await load();
    const { useFeedStore, useUiStore } = env;
    streamOf(env.api, 120);
    await prepare(env);
    goOffline(env);
    useUiStore.getState().setUnreadOnlyScope('all', '');
    useUiStore.getState().setUnreadOnlyAll(true);
    useFeedStore.getState().selectView(feed1);
    await settled();
    expect(useFeedStore.getState().filter).toBe('unread');
    expect(useFeedStore.getState().listFailed).toBe(false);
    expect(useFeedStore.getState().articles).toHaveLength(120);
    expect(useFeedStore.getState().loading).toBe(false);
    expect(useFeedStore.getState().revalidating).toBe(false);
  });

  it('Non lus ne montre que les lignes non lues, sans page suivante', async () => {
    const env = await load();
    const { useFeedStore } = env;
    idb.lists.set('7@1|feed/1:all', {
      articles: [{ id: 'b', read: false }, { id: 'a', read: true }], continuation: 'c',
    });
    goOffline(env);
    useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    expect(ids(useFeedStore.getState().articles)).toEqual(['b']);
    expect(useFeedStore.getState().continuation).toBeNull();
  });

  it('une liste « Tous » entièrement lue donne une vue vide, pas un échec', async () => {
    const env = await load();
    const { useFeedStore } = env;
    idb.lists.set('7@1|feed/1:all', { articles: [{ id: 'a', read: true }], continuation: null });
    goOffline(env);
    useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    expect(useFeedStore.getState().articles).toEqual([]);
    expect(useFeedStore.getState().listFailed).toBe(false);
  });

  it('la liste exacte, quand elle existe, passe avant tout repli', async () => {
    const env = await load();
    const { useFeedStore } = env;
    idb.lists.set('7@1|feed/1:unread', { articles: [{ id: 'exacte', read: false }], continuation: 'c' });
    idb.lists.set('7@1|feed/1:all', { articles: [{ id: 'x', read: false }, { id: 'y', read: false }], continuation: null });
    goOffline(env);
    useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    expect(ids(useFeedStore.getState().articles)).toEqual(['exacte']);
    expect(useFeedStore.getState().continuation).toBe('c');
  });

  // La longueur ne dit rien : sous Non lus, la liste la plus à jour est la plus
  // courte.
  it('entre deux listes possibles, la première de `fallbackSources` sert, pas la plus fournie', async () => {
    const env = await load();
    const { useFeedStore } = env;
    idb.lists.set('7@1|feed/1:all', { articles: [{ id: 'a', read: false }], continuation: null });
    idb.lists.set('7@1|feed/1:unread:oldest', { articles: [{ id: 'c', read: false }, { id: 'd', read: false }], continuation: null });
    goOffline(env);
    useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    expect(ids(useFeedStore.getState().articles)).toEqual(['a']);
  });

  it('jamais la liste d’un autre serveur', async () => {
    const env = await load();
    const { useFeedStore } = env;
    idb.lists.set('7@2|feed/1:all', { articles: [{ id: 'ailleurs', read: false }], continuation: null });
    goOffline(env);
    useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    expect(useFeedStore.getState().articles).toEqual([]);
    expect(useFeedStore.getState().listFailed).toBe(true);
  });

  it('stockage hors ligne bloqué : le cache mémoire a le même repli', async () => {
    const env = await load();
    const { useFeedStore } = env;
    idb.blocked = true;
    vi.mocked(env.api.getStreamContents).mockResolvedValue({ items: [item(2), item(1, true)], continuation: 'c' } as never);
    useFeedStore.getState().selectView(feed1, 'all');
    await settled();
    goOffline(env);
    useFeedStore.getState().setFilter('unread');
    await settled();
    expect(ids(useFeedStore.getState().articles)).toEqual([hex(2)]);
    expect(useFeedStore.getState().listFailed).toBe(false);
  });

  it('la vue déduite se rouvre aussitôt depuis le cache mémoire', async () => {
    const env = await load();
    const { useFeedStore } = env;
    idb.lists.set('7@1|feed/1:all', { articles: [{ id: 'b', read: false }], continuation: null });
    goOffline(env);
    useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    useFeedStore.getState().selectView(feed2, 'all');
    await settled();
    useFeedStore.getState().selectView(feed1, 'unread');
    expect(ids(useFeedStore.getState().articles)).toEqual(['b']);
  });
});

describe('ce que la préparation hors ligne range', () => {
  it('tout ce qu’elle a collecté pour le flux, pas seulement 50 articles', async () => {
    const env = await load();
    const { useFeedStore } = env;
    streamOf(env.api, 120);
    await prepare(env);
    goOffline(env);
    useFeedStore.getState().selectView(feed1, 'all');
    await settled();
    expect(useFeedStore.getState().articles).toHaveLength(120);
  });

  it('s’arrête à ses 8 pages', async () => {
    const env = await load();
    streamOf(env.api, 500);
    await prepare(env);
    expect(idb.lists.get('7@1|feed/1:prepared')?.articles).toHaveLength(400);
  });

  it('ne touche pas à la liste rangée de la vue', async () => {
    const env = await load();
    const rangee = { articles: [{ id: 'a', read: true }], continuation: 'suite' };
    idb.lists.set('7@1|feed/1:all', rangee);
    streamOf(env.api, 120);
    await prepare(env);
    expect(idb.lists.get('7@1|feed/1:all')).toBe(rangee);
  });

  it('range sous l’ordre par défaut, jamais sous la clé de l’ordre inverse', async () => {
    const env = await load();
    env.useUiStore.getState().setArticleOrder('oldest');
    streamOf(env.api, 3);
    await prepare(env);
    expect([...idb.lists.keys()]).toEqual(['7@1|feed/1:prepared']);
  });

  it('en ordre inverse, la vue se sert de cette liste, retournée', async () => {
    const env = await load();
    const { useFeedStore, useUiStore } = env;
    useUiStore.getState().setArticleOrder('oldest');
    streamOf(env.api, 3);
    await prepare(env);
    goOffline(env);
    useFeedStore.getState().selectView(feed1, 'all');
    await settled();
    expect(ids(useFeedStore.getState().articles)).toEqual([hex(998), hex(999), hex(1000)]);
  });

  it('Non lus en ordre inverse : filtrée et retournée', async () => {
    const env = await load();
    const { useFeedStore, useUiStore } = env;
    useUiStore.getState().setArticleOrder('oldest');
    idb.lists.set('7@1|feed/1:all', {
      articles: [{ id: 'c', read: false }, { id: 'b', read: true }, { id: 'a', read: false }], continuation: null,
    });
    goOffline(env);
    useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    expect(ids(useFeedStore.getState().articles)).toEqual(['a', 'c']);
  });
});

describe('✓ sous Non lus, ordre « plus anciens d’abord »', () => {
  it('la ligne cochée ne revient pas du cache mémoire', async () => {
    const env = await load();
    const { api, useFeedStore, useUiStore } = env;
    useUiStore.getState().setArticleOrder('oldest');
    vi.mocked(api.getStreamContents).mockImplementation((async (id: string) => (id === 'feed/1'
      ? { items: [item(1), item(2)], continuation: null }
      : { items: [item(9, false, 'feed/2')], continuation: null })) as never);
    useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    await useFeedStore.getState().toggleRead(useFeedStore.getState().articles[0]);
    useFeedStore.getState().selectView(feed2, 'unread');
    await settled();
    // Le retour : le live reste en vol, c'est le cache mémoire qui peint.
    vi.mocked(api.getStreamContents).mockImplementation(() => deferred<never>().promise);
    useFeedStore.getState().selectView(feed1, 'unread');
    expect(ids(useFeedStore.getState().articles)).toEqual([hex(2)]);
  });
});

describe('« Tout lu » : les autres vues', () => {
  const hanging = (env: Awaited<ReturnType<typeof load>>) =>
    vi.mocked(env.api.getStreamContents).mockImplementation(() => deferred<never>().promise);

  it('sous Non lus, puis « Tous » du même flux : le cache mémoire les montre lus', async () => {
    const env = await load();
    const { api, useFeedStore } = env;
    vi.mocked(api.getStreamContents).mockResolvedValue({ items: [item(2), item(1)], continuation: null } as never);
    useFeedStore.getState().selectView(feed1, 'all');
    await settled();
    useFeedStore.getState().setFilter('unread');
    await settled();
    await useFeedStore.getState().markAllAsRead();
    await settled();
    hanging(env);
    useFeedStore.getState().setFilter('all');
    expect(useFeedStore.getState().articles).toHaveLength(2);
    expect(useFeedStore.getState().articles.every((a) => a.read)).toBe(true);
  });

  it('marqué depuis « Tous », le retour sur cette vue ne repeint pas des non-lus', async () => {
    const env = await load();
    const { api, useFeedStore } = env;
    vi.mocked(api.getStreamContents).mockImplementation((async (id: string) => (id === 'feed/1'
      ? { items: [item(2), item(1)], continuation: null }
      : { items: [item(9, false, 'feed/2')], continuation: null })) as never);
    useFeedStore.getState().selectView(feed1, 'all');
    await settled();
    await useFeedStore.getState().markAllAsRead();
    await settled();
    useFeedStore.getState().selectView(feed2, 'all');
    await settled();
    hanging(env);
    useFeedStore.getState().selectView(feed1, 'all');
    expect(useFeedStore.getState().articles.every((a) => a.read)).toBe(true);
  });

  it('un flux marqué : ses lignes de l’accueil suivent, celles des autres flux non', async () => {
    const env = await load();
    const { api, useFeedStore } = env;
    useFeedStore.setState({ subscriptions: [feed1, feed2] });
    vi.mocked(api.getStreamContents).mockImplementation((async (id: string) => (id === 'feed/1'
      ? { items: [item(2)], continuation: null }
      : { items: [item(2), item(9, false, 'feed/2')], continuation: null })) as never);
    useFeedStore.getState().selectView(null, 'all');
    await settled();
    useFeedStore.getState().selectView(feed1, 'all');
    await settled();
    await useFeedStore.getState().markAllAsRead();
    await settled();
    hanging(env);
    useFeedStore.getState().selectView(null, 'all');
    expect(useFeedStore.getState().articles.map((a) => a.read)).toEqual([true, false]);
  });

  it('l’accueil marqué : les vues de ses flux suivent, et ses vues Non lus se vident', async () => {
    const env = await load();
    const { api, useFeedStore } = env;
    useFeedStore.setState({ subscriptions: [feed1] });
    vi.mocked(api.getStreamContents).mockResolvedValue({ items: [item(1)], continuation: null } as never);
    useFeedStore.getState().selectView(feed1, 'all');
    await settled();
    useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    useFeedStore.getState().selectView(null, 'all');
    await settled();
    await useFeedStore.getState().markAllAsRead();
    await settled();
    hanging(env);
    useFeedStore.getState().selectView(feed1, 'all');
    expect(useFeedStore.getState().articles.every((a) => a.read)).toBe(true);
    useFeedStore.getState().selectView(feed1, 'unread');
    expect(useFeedStore.getState().articles).toEqual([]);
  });

  it('une catégorie marquée : les lignes de ses flux suivent dans l’accueil', async () => {
    const env = await load();
    const { api, useFeedStore } = env;
    const cat = { id: 'user/-/label/Tech', label: 'Tech' };
    const inCat = { id: 'feed/1', title: 'F1', categories: [cat] } as never;
    useFeedStore.setState({ subscriptions: [inCat, feed2] });
    vi.mocked(api.getStreamContents).mockImplementation((async (id: string) => (id === 'user/-/label/Tech'
      ? { items: [item(1)], continuation: null }
      : { items: [item(1), item(9, false, 'feed/2')], continuation: null })) as never);
    useFeedStore.getState().selectView(null, 'all');
    await settled();
    useFeedStore.getState().selectCategory(cat);
    await settled();
    await useFeedStore.getState().markAllAsRead();
    await settled();
    hanging(env);
    useFeedStore.getState().selectView(null, 'all');
    expect(useFeedStore.getState().articles.map((a) => a.read)).toEqual([true, false]);
  });

  it('les favoris gardés d’un autre flux ne passent pas lus avec l’accueil', async () => {
    const env = await load();
    const { useFeedStore } = env;
    // Un flux hors de l'accueil (« category ») : l'accueil marqué ne le touche pas.
    const hors = { id: 'feed/2', title: 'F2', priority: 'category', categories: [] } as never;
    useFeedStore.setState({ subscriptions: [feed1, hors] });
    vi.mocked(env.api.getStarredItems).mockResolvedValue({ items: [item(9, false, 'feed/2')], continuation: null } as never);
    vi.mocked(env.api.getStreamContents).mockResolvedValue({ items: [item(1)], continuation: null } as never);
    useFeedStore.getState().selectView(null, 'starred');
    await settled();
    useFeedStore.getState().selectView(null, 'all');
    await settled();
    await useFeedStore.getState().markAllAsRead();
    await settled();
    vi.mocked(env.api.getStarredItems).mockImplementation(() => deferred<never>().promise);
    useFeedStore.getState().selectView(null, 'starred');
    expect(useFeedStore.getState().articles.map((a) => a.read)).toEqual([false]);
  });

  it('les listes hors ligne de la portée suivent, dans les deux ordres', async () => {
    const env = await load();
    const { api, useFeedStore } = env;
    const row = (id: string, sourceId = 'feed/1') => ({ id, read: false, sourceId });
    idb.lists.set('7@1|feed/1:all', { articles: [row('a')], continuation: 'c' });
    idb.lists.set('7@1|feed/1:all:oldest', { articles: [row('a')], continuation: null });
    idb.lists.set('7@1|feed/1:unread:oldest', { articles: [row('a')], continuation: null });
    idb.lists.set('7@1|:all', { articles: [row('a'), row('z', 'feed/2')], continuation: null });
    idb.lists.set('7@2|feed/1:all', { articles: [row('a')], continuation: null });
    vi.mocked(api.getStreamContents).mockResolvedValue({ items: [item(1)], continuation: null } as never);
    useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    await useFeedStore.getState().markAllAsRead();
    await settled();
    const reads = (k: string) => (idb.lists.get(k)!.articles as { read: boolean }[]).map((a) => a.read);
    expect(reads('7@1|feed/1:all')).toEqual([true]);
    expect(idb.lists.get('7@1|feed/1:all')!.continuation).toBe('c');
    expect(reads('7@1|feed/1:all:oldest')).toEqual([true]);
    expect(idb.lists.get('7@1|feed/1:unread:oldest')!.articles).toEqual([]);
    expect(reads('7@1|:all')).toEqual([true, false]);
    expect(reads('7@2|feed/1:all')).toEqual([false]);
    expect(idb.lists.get('7@1|feed/1:unread')).toEqual({ articles: [], continuation: null });
  });
});
