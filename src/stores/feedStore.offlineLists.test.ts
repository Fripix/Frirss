// @vitest-environment jsdom
//
// Ce qu'une vue sert hors ligne, et ce qu'aucune liste servie ne doit perdre :
// la préparation sous sa propre clé, les écritures en vol et les écritures en
// file. Chaque bloc reproduit un scénario de la relecture de la 1.8.0.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const idb = vi.hoisted(() => ({
  lists: new Map<string, { articles: never[]; continuation: string | null; cachedAt: number }>(),
  queue: [] as unknown[],
  clock: 0,
}));

vi.mock('../lib/offlineStore', () => ({
  listGet: vi.fn(async (k: string) => idb.lists.get(k)),
  listPut: vi.fn(async (k: string, articles: never[], continuation: string | null, cachedAt?: number) => {
    idb.lists.set(k, { articles, continuation, cachedAt: cachedAt ?? ++idb.clock });
  }),
  listsPatch: vi.fn(async (keys: string[], change: (rows: never[]) => never[]) => {
    for (const k of keys) {
      const stored = idb.lists.get(k);
      if (stored) idb.lists.set(k, { ...stored, articles: change(stored.articles) });
    }
  }),
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
type Env = Awaited<ReturnType<typeof load>>;

function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const settled = async () => { for (let i = 0; i < 8; i++) await flush(); };
const netErr = () => Object.assign(new Error('Network Error'), { response: undefined });
const setOnline = (on: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });
const hex = (n: number) => `tag:google.com,2005:reader/item/${n.toString(16).padStart(16, '0')}`;
const item = (n: number, read = false, feed = 'feed/1', published = Math.floor(Date.now() / 1000) - n) => ({
  id: hex(n), title: `T${n}`, published, origin: { streamId: feed, title: 'F' },
  categories: read ? ['user/-/state/com.google/read'] : [], alternate: [{ href: `https://example.com/${n}` }],
});
const page = (...items: unknown[]) => ({ items, continuation: null });
const feed1 = { id: 'feed/1', title: 'F1', categories: [] } as never;
const feed2 = { id: 'feed/2', title: 'F2', categories: [] } as never;
const PREPARED = '7@1|feed/1:prepared';

/** Un flux de `count` articles récents, servi par pages. */
function streamOf(api: Env['api'], count: number, top = 1000) {
  const all = Array.from({ length: count }, (_, i) => item(top - i));
  vi.mocked(api.getStreamContents).mockImplementation((async (_id: string, n: number, cont: string | null) => {
    const start = cont ? Number(cont) : 0;
    return { items: all.slice(start, start + n), continuation: start + n < all.length ? String(start + n) : null };
  }) as never);
  return all;
}
async function prepare(env: Env, subs: unknown[] = [feed1]) {
  env.useFeedStore.setState({ subscriptions: subs as never });
  await env.useFeedStore.getState().prepareOffline({ userInitiated: true });
  expect(env.useFeedStore.getState().offlinePrep?.phase).toBe('done');
}
function goOffline(env: Env) {
  setOnline(false);
  vi.mocked(env.api.getStreamContents).mockRejectedValue(netErr());
  vi.mocked(env.api.markAsRead).mockRejectedValue(netErr());
}
/** La même session rouverte hors ligne : le cache mémoire est vide. */
async function reopenOffline() {
  const env = await load();
  goOffline(env);
  return env;
}
async function loaded(env: Env, items: unknown[] = [item(3), item(2), item(1)], filter: 'all' | 'unread' = 'all') {
  vi.mocked(env.api.getStreamContents).mockResolvedValue(page(...items) as never);
  env.useFeedStore.setState({ subscriptions: [feed1] as never });
  env.useFeedStore.getState().selectView(feed1, filter);
  await settled();
}
const row = (env: Env, id: string) => env.useFeedStore.getState().articles.find((a) => a.id === id);
const rows = (env: Env) => env.useFeedStore.getState().articles;

beforeEach(() => {
  setOnline(true);
  localStorage.clear();
  vi.clearAllMocks();
  idb.lists.clear();
  idb.queue = [];
  idb.clock = 0;
});

describe('la préparation a sa propre clé', () => {
  it('elle range sous cette clé, et sous elle seule', async () => {
    const env = await load();
    streamOf(env.api, 120);
    await prepare(env);
    expect(idb.lists.get(PREPARED)?.articles).toHaveLength(120);
    expect(idb.lists.get(PREPARED)?.continuation).toBeNull();
    expect(idb.lists.has('7@1|feed/1:all')).toBe(false);
  });

  it('une visite en ligne ne la réécrit pas', async () => {
    const env = await load();
    streamOf(env.api, 120);
    await prepare(env);
    const before = idb.lists.get(PREPARED);
    env.useFeedStore.getState().selectView(feed1, 'all');
    await settled();
    expect(idb.lists.get(PREPARED)).toBe(before);
  });

  it('chaque passage la remplace entièrement : une ligne purgée par le serveur en sort', async () => {
    const env = await load();
    streamOf(env.api, 30);
    await prepare(env);
    streamOf(env.api, 5, 900);
    await prepare(env);
    expect(idb.lists.get(PREPARED)?.articles).toHaveLength(5);
  });

  it('jamais plus de 400 articles, même si un serveur rend des pages plus longues', async () => {
    const env = await load();
    const all = Array.from({ length: 600 }, (_, i) => item(2000 - i));
    vi.mocked(env.api.getStreamContents).mockImplementation((async (_id: string, _n: number, cont: string | null) => {
      const start = cont ? Number(cont) : 0;
      return { items: all.slice(start, start + 60), continuation: String(start + 60) };
    }) as never);
    await prepare(env);
    expect(idb.lists.get(PREPARED)?.articles).toHaveLength(400);
  });

  it('un flux sans rien dans les 30 jours ne masque pas ce qui a été lu avant', async () => {
    const env = await load();
    idb.lists.set('7@1|feed/1:all', { articles: [{ id: hex(5), read: false }] as never[], continuation: null, cachedAt: 1 });
    const vieux = Math.floor(Date.now() / 1000) - 90 * 86400;
    vi.mocked(env.api.getStreamContents).mockResolvedValue(page(item(5, false, 'feed/1', vieux)) as never);
    await prepare(env);
    goOffline(env);
    env.useFeedStore.getState().selectView(feed1, 'all');
    await settled();
    expect(rows(env).map((a) => a.id)).toEqual([hex(5)]);
  });
});

describe('une liste exacte périmée ne masque plus la préparation', () => {
  it('« Tout lu » la semaine passée, nouveaux articles, préparation : Non lus les montre', async () => {
    const env = await load();
    streamOf(env.api, 3, 500);
    env.useFeedStore.setState({ subscriptions: [feed1] as never });
    env.useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    await env.useFeedStore.getState().markAllAsRead();
    await settled();
    expect(idb.lists.get('7@1|feed/1:unread')?.articles).toEqual([]);
    streamOf(env.api, 20);
    await prepare(env);
    const env2 = await reopenOffline();
    env2.useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    expect(rows(env2)).toHaveLength(20);
  });

  it('une liste Non lus de deux lignes ne cache pas les 120 préparés', async () => {
    const env = await load();
    idb.lists.set('7@1|feed/1:unread', { articles: [{ id: 'vieille1', read: false }, { id: 'vieille2', read: false }] as never[], continuation: null, cachedAt: 0 });
    streamOf(env.api, 120);
    await prepare(env);
    goOffline(env);
    env.useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    expect(rows(env)).toHaveLength(120);
  });

  // Une vue construite ne s'écrit pas : le geste n'avait que la file, et une
  // fois rejouée il ne restait rien. La liste préparée le disait encore non lu,
  // et l'article revenait sous Non lus au trajet suivant.
  it('un geste mis en file se reporte sur la liste préparée, sans la redater', async () => {
    const env = await load();
    streamOf(env.api, 3);
    await prepare(env);
    const before = idb.lists.get(PREPARED)!;
    const row = (before.articles as unknown as { id: string; read: boolean }[])[1];
    vi.mocked(env.api.markAsRead).mockRejectedValue(netErr());
    setOnline(false);
    await env.useFeedStore.getState().toggleRead({ ...row, read: false, sourceId: 'feed/1' } as never);
    await settled();
    const after = idb.lists.get(PREPARED)!;
    expect((after.articles as unknown as { id: string; read: boolean }[]).find((a) => a.id === row.id)?.read).toBe(true);
    expect(after.cachedAt).toBe(before.cachedAt);
    setOnline(true);
  });

  // Le geste ne vivait que dans la liste de la vue où il était fait : lu en ligne
  // depuis l'accueil, l'article revenait sous Non lus dans le train.
  describe('un geste atteint les listes gardées de son flux', () => {
    const read = (key: string, id: string) =>
      (idb.lists.get(key)?.articles as unknown as { id: string; read: boolean }[] | undefined)?.find((a) => a.id === id)?.read;
    const offlineUnread = async () => {
      const env = await reopenOffline();
      env.useFeedStore.getState().selectView(feed1, 'unread');
      await settled();
      return rows(env).map((a) => a.id);
    };
    /** Préparé, en ligne : les écritures d'un test hors ligne survivent à `load`. */
    const prepared = async () => {
      const env = await load();
      vi.mocked(env.api.markAsRead).mockReset().mockResolvedValue(undefined as never);
      vi.mocked(env.api.markAsUnread).mockReset().mockResolvedValue(undefined as never);
      streamOf(env.api, 3);
      await prepare(env);
      return env;
    };
    const onHome = async (env: Env) => {
      env.useFeedStore.getState().selectView(null, 'all');
      await settled();
      return env.useFeedStore.getState().articles[0];
    };

    it('confirmé en ligne depuis l’accueil', async () => {
      const env = await prepared();
      const a = await onHome(env);
      const before = idb.lists.get(PREPARED)!.cachedAt;
      await env.useFeedStore.getState().toggleRead(a);
      await settled();
      expect(read(PREPARED, a.id)).toBe(true);
      expect(idb.lists.get(PREPARED)!.cachedAt).toBe(before);
      expect(await offlineUnread()).not.toContain(a.id);
    });

    it('la liste exacte du flux, plus récente que la préparée, suit aussi', async () => {
      const env = await prepared();
      env.useFeedStore.getState().selectView(feed1, 'unread');
      await settled();
      const a = await onHome(env);
      await env.useFeedStore.getState().toggleRead(a);
      await settled();
      expect(read('7@1|feed/1:unread', a.id)).toBe(true);
      expect(await offlineUnread()).not.toContain(a.id);
    });

    it('la liste de l’accueil suit un geste fait dans le flux', async () => {
      const env = await prepared();
      const a = await onHome(env);
      env.useFeedStore.getState().selectView(feed1, 'all');
      await settled();
      await env.useFeedStore.getState().toggleRead(a);
      await settled();
      expect(read('7@1|:all', a.id)).toBe(true);
    });

    it('un geste abandonné au rejeu est retiré', async () => {
      const env = await prepared();
      goOffline(env);
      env.useFeedStore.getState().selectView(feed1, 'unread');
      await settled();
      const a = env.useFeedStore.getState().articles[0];
      env.useFeedStore.getState().selectArticle(a);
      await settled();
      expect(read(PREPARED, a.id)).toBe(true);
      setOnline(true);
      vi.mocked(env.api.markAsRead).mockRejectedValue(Object.assign(new Error('refused'), { response: { status: 400 } }));
      await env.useFeedStore.getState().replayQueue();
      await settled();
      expect(read(PREPARED, a.id)).toBe(false);
    });

    it('un geste ancien qui échoue tard ne couvre pas le plus récent', async () => {
      const env = await prepared();
      const a = await onHome(env);
      const slow = deferred<void>();
      vi.mocked(env.api.markAsRead).mockReturnValueOnce(slow.promise as never);
      vi.mocked(env.api.markAsUnread).mockRejectedValueOnce(netErr());
      const first = env.useFeedStore.getState().toggleRead(a);
      await settled();
      const now = env.useFeedStore.getState().articles.find((x) => x.id === a.id)!;
      await env.useFeedStore.getState().toggleRead(now);
      slow.reject(netErr());
      await first;
      await settled();
      expect((idb.queue[0] as { value: boolean }).value).toBe(false);
      expect(read(PREPARED, a.id)).toBe(false);
    });

    it('lu puis non lu abandonnés : la liste reste non lue', async () => {
      const env = await prepared();
      goOffline(env);
      vi.mocked(env.api.markAsUnread).mockRejectedValue(netErr());
      env.useFeedStore.getState().selectView(feed1, 'all');
      await settled();
      const a = env.useFeedStore.getState().articles[0];
      await env.useFeedStore.getState().toggleRead(a);
      await env.useFeedStore.getState().toggleRead(env.useFeedStore.getState().articles[0]);
      await settled();
      setOnline(true);
      vi.mocked(env.api.markAsUnread).mockRejectedValue(Object.assign(new Error('refused'), { response: { status: 400 } }));
      await env.useFeedStore.getState().replayQueue();
      await settled();
      expect(read(PREPARED, a.id)).toBe(false);
    });

    it('« Marquer au-dessus » atteint les listes de ses flux et la vue mémoire', async () => {
      const env = await prepared();
      const row = await onHome(env);
      const below = env.useFeedStore.getState().articles[2];
      vi.mocked(env.api.itemIdsNewerThanEntry).mockResolvedValue([row.id] as never);
      await env.useFeedStore.getState().markReadRelative(below, 'above');
      await settled();
      expect(read(PREPARED, row.id)).toBe(true);
      expect(read(PREPARED, below.id)).toBe(false);
      expect(read('7@1|:all', row.id)).toBe(true);
    });

    it('« Marquer en dessous » atteint aussi les lignes préparées non chargées', async () => {
      const env = await load();
      streamOf(env.api, 120);
      await prepare(env);
      const rowsPage = streamOf(env.api, 120);
      env.useFeedStore.getState().selectView(feed1, 'all');
      await settled();
      const top = env.useFeedStore.getState().articles[0];
      await env.useFeedStore.getState().markReadRelative(top, 'below');
      await settled();
      const stored = idb.lists.get(PREPARED)!.articles as unknown as { id: string; read: boolean }[];
      expect(stored).toHaveLength(rowsPage.length);
      expect(stored[0].read).toBe(false);
      expect(stored.slice(1).every((a) => a.read)).toBe(true);
    });

    it('un refus de la plage ne touche pas aux listes', async () => {
      const env = await prepared();
      const row = await onHome(env);
      const below = env.useFeedStore.getState().articles[2];
      vi.mocked(env.api.itemIdsNewerThanEntry).mockResolvedValue([row.id] as never);
      vi.mocked(env.api.markAsRead).mockRejectedValue(Object.assign(new Error('refused'), { response: { status: 400 } }));
      await env.useFeedStore.getState().markReadRelative(below, 'above');
      await settled();
      expect(read(PREPARED, row.id)).toBe(false);
    });

    it('un favori atteint aussi les vues en mémoire de la portée', async () => {
      const env = await prepared();
      const a = await onHome(env);
      env.useFeedStore.getState().selectView(feed1, 'all');
      await settled();
      await env.useFeedStore.getState().toggleStar(a);
      await settled();
      setOnline(false);
      vi.mocked(env.api.getStreamContents).mockRejectedValue(netErr());
      env.useFeedStore.getState().selectView(null, 'all');
      await settled();
      expect(env.useFeedStore.getState().articles.find((x) => x.id === a.id)?.starred).toBe(true);
    });

    it('un ancien geste confirmé tard ne couvre pas le plus récent', async () => {
      const env = await prepared();
      const a = await onHome(env);
      const slow = deferred<void>();
      vi.mocked(env.api.markAsRead).mockReturnValueOnce(slow.promise as never);
      const first = env.useFeedStore.getState().toggleRead(a);
      await settled();
      const now = env.useFeedStore.getState().articles.find((x) => x.id === a.id)!;
      await env.useFeedStore.getState().toggleRead(now);
      await settled();
      slow.resolve();
      await first;
      await settled();
      expect(read(PREPARED, a.id)).toBe(false);
    });
  });

  it('une liste vidée APRÈS la préparation reste vide', async () => {
    const env = await load();
    streamOf(env.api, 20);
    await prepare(env);
    env.useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    await env.useFeedStore.getState().markAllAsRead();
    await settled();
    const env2 = await reopenOffline();
    env2.useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    expect(rows(env2)).toEqual([]);
  });

  it('« Tout lu » de « Tous » passe aussi la clé préparée en lu', async () => {
    const env = await load();
    streamOf(env.api, 20);
    await prepare(env);
    env.useFeedStore.getState().selectView(feed1, 'all');
    await settled();
    await env.useFeedStore.getState().markAllAsRead();
    await settled();
    expect((idb.lists.get(PREPARED)?.articles as { read: boolean }[]).every((a) => a.read)).toBe(true);
    const env2 = await reopenOffline();
    env2.useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    expect(rows(env2)).toEqual([]);
  });

  it('une vue construite n’est jamais rangée sous la clé exacte : la préparation suivante l’atteint', async () => {
    const env = await load();
    streamOf(env.api, 10, 500);
    await prepare(env);
    goOffline(env);
    env.useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    expect(rows(env)).toHaveLength(10);
    env.useFeedStore.getState().selectArticle(rows(env)[0]);
    await settled();
    expect(idb.lists.has('7@1|feed/1:unread')).toBe(false);
    setOnline(true);
    streamOf(env.api, 30);
    await prepare(env);
    const env2 = await reopenOffline();
    env2.useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    expect(rows(env2)).toHaveLength(30);
  });

  it('même chose en ordre inverse', async () => {
    const env = await load();
    env.useUiStore.setState({ articleOrder: 'oldest' } as never);
    streamOf(env.api, 10, 500);
    await prepare(env);
    goOffline(env);
    env.useFeedStore.getState().selectView(feed1, 'all');
    await settled();
    env.useFeedStore.getState().selectArticle(rows(env)[0]);
    await settled();
    expect(idb.lists.has('7@1|feed/1:all:oldest')).toBe(false);
    setOnline(true);
    streamOf(env.api, 30);
    await prepare(env);
    const env2 = await load();
    env2.useUiStore.setState({ articleOrder: 'oldest' } as never);
    goOffline(env2);
    env2.useFeedStore.getState().selectView(feed1, 'all');
    await settled();
    expect(rows(env2)).toHaveLength(30);
    expect(rows(env2)[0].id).toBe(hex(971));
  });

  it('un geste hors ligne sur une vue construite : retiré, mis en file, rien sous la clé exacte', async () => {
    const env = await load();
    streamOf(env.api, 10);
    await prepare(env);
    goOffline(env);
    env.useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    await env.useFeedStore.getState().toggleRead(rows(env)[0]);
    await settled();
    expect(rows(env)).toHaveLength(9);
    expect(env.useFeedStore.getState().pendingActions).toBe(1);
    expect(idb.lists.has('7@1|feed/1:unread')).toBe(false);
  });

  it('de retour en ligne, une réponse rend la vue à sa clé exacte', async () => {
    const env = await load();
    streamOf(env.api, 10);
    await prepare(env);
    goOffline(env);
    env.useFeedStore.getState().selectView(feed1, 'all');
    await settled();
    setOnline(true);
    streamOf(env.api, 10);
    await env.useFeedStore.getState().silentRefresh();
    await settled();
    vi.mocked(env.api.markAsRead).mockResolvedValue(undefined as never);
    env.useFeedStore.getState().selectArticle(rows(env)[0]);
    await settled();
    expect(idb.lists.get('7@1|feed/1:all')?.articles).toHaveLength(10);
  });
});

describe('une visite en ligne ne ramène plus le flux à 50 lignes', () => {
  it('préparé 120, visité, hors ligne : 120, dans l’ordre, sans page suivante', async () => {
    const env = await load();
    streamOf(env.api, 120);
    await prepare(env);
    env.useFeedStore.getState().selectView(feed1, 'all');
    await settled();
    expect(idb.lists.get('7@1|feed/1:all')?.articles).toHaveLength(50);
    const env2 = await reopenOffline();
    env2.useFeedStore.getState().selectView(feed1, 'all');
    await settled();
    expect(rows(env2).map((a) => a.id)).toEqual(Array.from({ length: 120 }, (_, i) => hex(1000 - i)));
    expect(env2.useFeedStore.getState().continuation).toBeNull();
  });

  it('une visite sous Non lus aussi', async () => {
    const env = await load();
    streamOf(env.api, 120);
    await prepare(env);
    env.useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    const env2 = await reopenOffline();
    env2.useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    expect(rows(env2)).toHaveLength(120);
  });

  it('une visite sous « Tous » nourrit Non lus, et la fin vient de la préparation', async () => {
    const env = await load();
    streamOf(env.api, 120);
    await prepare(env);
    env.useFeedStore.getState().selectView(feed1, 'all');
    await settled();
    await env.useFeedStore.getState().toggleRead(rows(env)[0]);
    await settled();
    const env2 = await reopenOffline();
    env2.useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    expect(rows(env2)).toHaveLength(119);
    expect(row(env2, hex(1000))).toBeUndefined();
  });

  it('une ligne lue et sortie de la liste exacte n’est pas rendue par la préparation', async () => {
    const env = await load();
    streamOf(env.api, 120);
    await prepare(env);
    env.useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    await env.useFeedStore.getState().toggleRead(rows(env)[0]);
    await settled();
    const env2 = await reopenOffline();
    env2.useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    expect(row(env2, hex(1000))).toBeUndefined();
    expect(rows(env2)).toHaveLength(119);
  });
});

describe('les listes rangées par l’ancienne version', () => {
  it('une liste « Tous » sert encore, filtrée sous Non lus', async () => {
    const env = await load();
    const legacy = [{ id: hex(3), read: false }, { id: hex(2), read: true }, { id: hex(1), read: false }];
    idb.lists.set('7@1|feed/1:all', { articles: legacy as never[], continuation: null, cachedAt: 1 });
    goOffline(env);
    env.useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    expect(rows(env).map((a) => a.id)).toEqual([hex(3), hex(1)]);
  });

  it('une clé :oldest déduite d’alors reste lisible, et une préparation plus récente passe devant', async () => {
    const env = await load();
    env.useUiStore.setState({ articleOrder: 'oldest' } as never);
    idb.lists.set('7@1|feed/1:all:oldest', { articles: [{ id: hex(1), read: false }] as never[], continuation: null, cachedAt: 0 });
    goOffline(env);
    env.useFeedStore.getState().selectView(feed1, 'all');
    await settled();
    expect(rows(env).map((a) => a.id)).toEqual([hex(1)]);
    setOnline(true);
    streamOf(env.api, 3);
    await prepare(env);
    const env2 = await load();
    env2.useUiStore.setState({ articleOrder: 'oldest' } as never);
    goOffline(env2);
    env2.useFeedStore.getState().selectView(feed1, 'all');
    await settled();
    expect(rows(env2).map((a) => a.id)).toEqual([hex(998), hex(999), hex(1000)]);
  });
});

describe('recherche hors ligne', () => {
  const rustAndGo = () => Array.from({ length: 10 }, (_, i) => ({ ...item(100 - i), title: i < 5 ? `rust ${i}` : `go ${i}` }));

  it('dans une vue construite, la seconde recherche fouille toute la liste', async () => {
    const env = await load();
    vi.mocked(env.api.getStreamContents).mockResolvedValue(page(...rustAndGo()) as never);
    await prepare(env);
    goOffline(env);
    env.useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    expect(rows(env)).toHaveLength(10);
    await env.useFeedStore.getState().search('rust');
    expect(rows(env)).toHaveLength(5);
    await env.useFeedStore.getState().search('go');
    expect(rows(env)).toHaveLength(5);
  });

  it('elle lit la préparation, pas seulement la liste exacte', async () => {
    const env = await load();
    streamOf(env.api, 120);
    await prepare(env);
    env.useFeedStore.getState().selectView(feed1, 'all');
    await settled();
    const env2 = await reopenOffline();
    env2.useFeedStore.setState({ selectedFeed: feed1, filter: 'all', articles: [] } as never);
    await env2.useFeedStore.getState().search('T890');
    expect(rows(env2).map((a) => a.id)).toEqual([hex(890)]);
  });
});

describe('une écriture en file est rejouée sur toute liste servie', () => {
  it('lu sous Non lus construit, bascule sur Tous : la ligne reste lue', async () => {
    const env = await load();
    streamOf(env.api, 10);
    await prepare(env);
    goOffline(env);
    env.useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    const a = rows(env)[0];
    env.useFeedStore.getState().selectArticle(a);
    await settled();
    env.useFeedStore.getState().setFilter('all');
    await settled();
    expect(row(env, a.id)?.read).toBe(true);
  });

  it('rouvrir une ligne lue hors ligne ne décompte pas une seconde fois', async () => {
    const env = await load();
    streamOf(env.api, 3);
    await prepare(env);
    goOffline(env);
    env.useFeedStore.setState({ unreadCounts: { 'feed/1': 3 } } as never);
    env.useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    const a = rows(env)[0];
    env.useFeedStore.getState().selectArticle(a);
    await settled();
    env.useFeedStore.getState().setFilter('all');
    await settled();
    env.useFeedStore.getState().selectArticle(row(env, a.id)!);
    await settled();
    expect(env.useFeedStore.getState().unreadCounts['feed/1']).toBe(2);
  });

  it('lu dans l’accueil hors ligne : la ligne sort de Non lus du flux', async () => {
    const env = await load();
    streamOf(env.api, 10);
    await prepare(env);
    env.useFeedStore.getState().selectView(feed1, 'all');
    await settled();
    env.useFeedStore.getState().selectView(null, 'all');
    await settled();
    goOffline(env);
    const a = rows(env)[0];
    env.useFeedStore.getState().selectArticle(a);
    await settled();
    env.useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    expect(row(env, a.id)).toBeUndefined();
  });

  it('l’application relancée hors ligne relit sa file avant de servir', async () => {
    const env = await load();
    streamOf(env.api, 3);
    await prepare(env);
    idb.queue = [{ key: `7@1|${hex(1000)}|read`, articleId: hex(1000), type: 'read', value: true, at: 1, attempts: 0, scope: '7@1' }];
    const env2 = await reopenOffline();
    env2.useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    expect(row(env2, hex(1000))).toBeUndefined();
    expect(rows(env2)).toHaveLength(2);
  });

  it('une action d’un autre serveur n’y touche pas', async () => {
    const env = await load();
    streamOf(env.api, 3);
    await prepare(env);
    idb.queue = [{ key: `7@2|${hex(1000)}|read`, articleId: hex(1000), type: 'read', value: true, at: 1, attempts: 0, scope: '7@2' }];
    const env2 = await reopenOffline();
    env2.useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    expect(rows(env2)).toHaveLength(3);
  });

  it('favori et étiquette en file aussi', async () => {
    const env = await load();
    streamOf(env.api, 2);
    await prepare(env);
    idb.queue = [
      { key: `7@1|${hex(1000)}|star`, articleId: hex(1000), type: 'star', value: true, at: 1, attempts: 0, scope: '7@1' },
      { key: `7@1|${hex(999)}|label|user/-/label/X`, articleId: hex(999), type: 'label', labelId: 'user/-/label/X', value: true, at: 1, attempts: 0, scope: '7@1' },
    ];
    const env2 = await reopenOffline();
    env2.useFeedStore.getState().selectView(feed1, 'all');
    await settled();
    expect(row(env2, hex(1000))?.starred).toBe(true);
    expect(row(env2, hex(999))?.labels).toContain('user/-/label/X');
  });

  it('en ligne après un 502 : la relecture suivante ne repeint pas la ligne', async () => {
    const env = await load();
    await loaded(env);
    env.useFeedStore.setState({ unreadCounts: { 'feed/1': 3 } } as never);
    vi.mocked(env.api.markAsRead).mockRejectedValueOnce(netErr());
    const a = rows(env)[0];
    env.useFeedStore.getState().selectArticle(a);
    await settled();
    expect(env.useFeedStore.getState().pendingActions).toBe(1);
    await env.useFeedStore.getState().loadArticles();
    await settled();
    expect(row(env, a.id)?.read).toBe(true);
  });

  it('sous Non lus, en ligne : la ligne en file ne revient pas de la réponse', async () => {
    const env = await load();
    await loaded(env, [item(3), item(2), item(1)], 'unread');
    vi.mocked(env.api.markAsRead).mockRejectedValueOnce(netErr());
    await env.useFeedStore.getState().toggleRead(rows(env)[0]);
    await settled();
    env.useFeedStore.getState().selectView(feed2, 'all');
    await settled();
    vi.mocked(env.api.getStreamContents).mockResolvedValue(page(item(3), item(2), item(1)) as never);
    env.useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    expect(row(env, hex(3))).toBeUndefined();
  });

  it('une lecture pendant le rejeu ne repeint pas la ligne', async () => {
    const env = await load();
    await loaded(env);
    vi.mocked(env.api.markAsRead).mockRejectedValueOnce(netErr());
    const a = rows(env)[0];
    env.useFeedStore.getState().selectArticle(a);
    await settled();
    const write = deferred();
    vi.mocked(env.api.markAsRead).mockImplementation(() => write.promise as never);
    const replay = env.useFeedStore.getState().replayQueue();
    await settled();
    await env.useFeedStore.getState().loadArticles();
    await settled();
    write.resolve(undefined);
    await replay;
    await settled();
    expect(env.useFeedStore.getState().pendingActions).toBe(0);
    expect(row(env, a.id)?.read).toBe(true);
  });

  it('une lecture partie pendant le rejeu, répondue après, non plus', async () => {
    const env = await load();
    await loaded(env);
    vi.mocked(env.api.markAsRead).mockRejectedValueOnce(netErr());
    const a = rows(env)[0];
    env.useFeedStore.getState().selectArticle(a);
    await settled();
    const write = deferred();
    vi.mocked(env.api.markAsRead).mockImplementation(() => write.promise as never);
    const replay = env.useFeedStore.getState().replayQueue();
    await settled();
    const live = deferred();
    vi.mocked(env.api.getStreamContents).mockImplementation(() => live.promise as never);
    const reading = env.useFeedStore.getState().loadArticles();
    await settled();
    write.resolve(undefined);
    await replay;
    await settled();
    live.resolve(page(item(3), item(2), item(1)));
    await reading;
    await settled();
    expect(row(env, a.id)?.read).toBe(true);
  });
});

describe('une écriture reste « en vol » jusqu’à sa confirmation ou son rollback', () => {
  it('lecture partie pendant le vol, répondue AVANT la confirmation', async () => {
    const env = await load();
    await loaded(env);
    const write = deferred();
    vi.mocked(env.api.markAsRead).mockImplementation(() => write.promise as never);
    const a = rows(env)[0];
    env.useFeedStore.getState().selectArticle(a);
    const live = deferred();
    vi.mocked(env.api.getStreamContents).mockImplementation(() => live.promise as never);
    const refresh = env.useFeedStore.getState().silentRefresh();
    await settled();
    live.resolve(page(item(3), item(2), item(1)));
    await refresh;
    await settled();
    write.resolve(undefined);
    await settled();
    expect(row(env, a.id)?.read).toBe(true);
    expect(env.useFeedStore.getState().selectedArticle?.read).toBe(true);
  });

  it('plage « en dessous » : lecture partie pendant le vol, répondue après la confirmation', async () => {
    const env = await load();
    await loaded(env);
    const write = deferred();
    vi.mocked(env.api.markAllAsRead).mockImplementation(() => write.promise as never);
    const [top, below] = rows(env);
    const done = env.useFeedStore.getState().markReadRelative(top, 'below');
    await settled();
    expect(row(env, below.id)?.read).toBe(true);
    const live = deferred();
    vi.mocked(env.api.getStreamContents).mockImplementation(() => live.promise as never);
    const reading = env.useFeedStore.getState().loadArticles();
    await settled();
    write.resolve(undefined);
    await done;
    await settled();
    live.resolve(page(item(3), item(2), item(1)));
    await reading;
    await settled();
    expect(row(env, below.id)?.read).toBe(true);
  });

  it('une lecture faite APRÈS la confirmation a le dernier mot', async () => {
    const env = await load();
    await loaded(env);
    const a = rows(env)[0];
    env.useFeedStore.getState().selectArticle(a);
    await settled();
    vi.mocked(env.api.getStreamContents).mockResolvedValue(page(item(3), item(2), item(1)) as never);
    await env.useFeedStore.getState().loadArticles();
    await settled();
    expect(row(env, a.id)?.read).toBe(false);
  });

  it('une écriture refusée cesse d’être en vol : la relecture suivante a le dernier mot', async () => {
    const env = await load();
    await loaded(env);
    vi.mocked(env.api.markAsRead).mockRejectedValueOnce(Object.assign(new Error('non'), { response: { status: 400 } }));
    const a = rows(env)[0];
    env.useFeedStore.getState().selectArticle(a);
    await settled();
    vi.mocked(env.api.getStreamContents).mockResolvedValue(page(item(3, true), item(2), item(1)) as never);
    await env.useFeedStore.getState().loadArticles();
    await settled();
    expect(row(env, a.id)?.read).toBe(true);
  });
});

describe('« Tout lu » et une page suivante en vol', () => {
  it('la page est périmée : rien ne revient, rien n’est réécrit', async () => {
    const env = await load();
    vi.mocked(env.api.getStreamContents).mockResolvedValue({ items: [item(3), item(2)], continuation: 'c' } as never);
    env.useFeedStore.setState({ subscriptions: [feed1] as never });
    env.useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    const more = deferred();
    vi.mocked(env.api.getStreamContents).mockImplementation(() => more.promise as never);
    const paging = env.useFeedStore.getState().loadMore();
    await settled();
    await env.useFeedStore.getState().markAllAsRead();
    await settled();
    expect(rows(env)).toEqual([]);
    more.resolve({ items: [item(1)], continuation: null });
    await paging;
    await settled();
    expect(rows(env)).toEqual([]);
    expect(env.useFeedStore.getState().loadingMore).toBe(false);
    expect(idb.lists.get('7@1|feed/1:unread')?.articles).toEqual([]);
  });
});

describe('le repli préfère la mémoire au disque', () => {
  it('flux visité, « Tout lu » de l’accueil : la mémoire est juste, le disque périmé', async () => {
    const env = await load();
    streamOf(env.api, 10);
    await prepare(env);
    env.useFeedStore.getState().selectView(feed1, 'all');
    await settled();
    env.useFeedStore.getState().selectView(null, 'all');
    await settled();
    await env.useFeedStore.getState().markAllAsRead();
    await settled();
    goOffline(env);
    env.useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    expect(rows(env)).toEqual([]);
  });

  it('la liste exacte aussi : un disque périmé ne contredit pas la mémoire', async () => {
    const env = await load();
    streamOf(env.api, 3);
    env.useFeedStore.setState({ subscriptions: [feed1] as never });
    env.useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    env.useFeedStore.getState().selectView(null, 'all');
    await settled();
    await env.useFeedStore.getState().markAllAsRead();
    await settled();
    goOffline(env);
    env.useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    expect(rows(env)).toEqual([]);
  });

  it('un favori posé sur la vue affichée survit au passage hors ligne', async () => {
    const env = await load();
    await loaded(env);
    await env.useFeedStore.getState().toggleStar(rows(env)[0]);
    await settled();
    goOffline(env);
    await env.useFeedStore.getState().loadArticles();
    await settled();
    expect(rows(env)[0].starred).toBe(true);
  });
});

describe('l’annulation de « Tout lu »', () => {
  async function markedThenUndone(env: Env, first: () => void) {
    vi.mocked(env.api.getUnreadItemIds).mockResolvedValue({ ids: ['3', '2', '1'], complete: true } as never);
    vi.mocked(env.api.getStreamContents).mockResolvedValue(page(item(3), item(2), item(1)) as never);
    env.useFeedStore.setState({ subscriptions: [feed1] as never });
    first();
    await settled();
    env.useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    await env.useFeedStore.getState().markAllAsRead();
    await settled();
    const toast = env.useUiStore.getState().toasts.at(-1) as unknown as { action: { run: () => Promise<void> } };
    await toast.action.run();
    await settled();
    expect(env.api.markAsUnread).toHaveBeenCalled();
  }

  it('la vue sœur ne repeint pas des lignes lues : elle se relit', async () => {
    const env = await load();
    await markedThenUndone(env, () => env.useFeedStore.getState().selectView(feed1, 'all'));
    const live = deferred();
    vi.mocked(env.api.getStreamContents).mockImplementation(() => live.promise as never);
    env.useFeedStore.getState().selectView(feed1, 'all');
    expect(rows(env)).toEqual([]);
    live.resolve(page(item(3), item(2), item(1)));
    await settled();
    expect(rows(env).every((a) => !a.read)).toBe(true);
  });

  it('la liste Non lus de l’accueil retrouve ses lignes à la relecture', async () => {
    const env = await load();
    await markedThenUndone(env, () => env.useFeedStore.getState().selectView(null, 'unread'));
    const live = deferred();
    vi.mocked(env.api.getStreamContents).mockImplementation(() => live.promise as never);
    env.useFeedStore.getState().selectView(null, 'unread');
    expect(rows(env)).toEqual([]);
    expect(env.useFeedStore.getState().loading).toBe(true);
    live.resolve(page(item(3), item(2), item(1)));
    await settled();
    expect(rows(env)).toHaveLength(3);
  });

  it('la vue affichée reste peinte pendant sa relecture', async () => {
    const env = await load();
    await markedThenUndone(env, () => env.useFeedStore.getState().selectView(feed1, 'all'));
    expect(rows(env)).toHaveLength(3);
    expect(env.useFeedStore.getState().loading).toBe(false);
  });
});
