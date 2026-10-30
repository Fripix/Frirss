// @vitest-environment jsdom
//
// Une réponse partie AVANT une écriture locale rapporte l'état d'avant ce
// geste : elle ne doit l'écraser ni dans la liste, ni dans le volet, ni dans
// les caches, ni dans les compteurs (registre `src/lib/localWrites.ts`).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const idb = vi.hoisted(() => ({
  lists: new Map<string, { articles: { id: string; read: boolean; starred: boolean; labels: string[] }[]; continuation: string | null }>(),
}));

vi.mock('../lib/offlineStore', () => ({
  listGet: vi.fn(async (k: string) => idb.lists.get(k)),
  listPut: vi.fn(async (k: string, articles: never[], continuation: string | null) => { idb.lists.set(k, { articles, continuation }); }),
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
  markAsRead: vi.fn(async () => {}), markAsUnread: vi.fn(async () => {}),
  markAsStarred: vi.fn(async () => {}), removeStarred: vi.fn(async () => {}),
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
vi.mock('../utils/extractContent', () => ({ extractFullContent: vi.fn(async () => { throw new Error('no'); }) }));

async function load() {
  vi.resetModules();
  const api = await import('../api/feeds');
  const { useFeedStore, READ_LATER_LABEL } = await import('./feedStore');
  const { useAuthStore } = await import('./authStore');
  useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 }, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true } as never);
  return { api, useFeedStore, READ_LATER_LABEL };
}
function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const settled = async () => { for (let i = 0; i < 6; i++) await flush(); };
const hex = (n: number) => `tag:google.com,2005:reader/item/${n.toString(16).padStart(16, '0')}`;
const item = (n: number, extra: string[] = []) => ({
  id: hex(n), title: `T${n}`, published: Math.floor(Date.now() / 1000) - n,
  origin: { streamId: 'feed/1', title: 'F' }, categories: extra, alternate: [{ href: `https://example.com/${n}` }],
});
const READ = 'user/-/state/com.google/read';
const STARRED = 'user/-/state/com.google/starred';
const feed1 = { id: 'feed/1', title: 'F1', categories: [] } as never;
const page = (...items: unknown[]) => ({ items, continuation: null });

type Env = Awaited<ReturnType<typeof load>>;

/** La vue est chargée ; la requête suivante reste en vol jusqu'à `live.resolve`. */
async function loadedThenHanging({ api, useFeedStore }: Env, items: unknown[] = [item(2), item(1)]) {
  vi.mocked(api.getStreamContents).mockResolvedValue(page(...items) as never);
  useFeedStore.getState().selectView(feed1, 'all');
  await settled();
  const live = deferred();
  vi.mocked(api.getStreamContents).mockImplementation(() => live.promise as never);
  return live;
}

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  localStorage.clear();
  vi.clearAllMocks();
  idb.lists.clear();
});

describe('loadArticles en vol pendant un geste', () => {
  it('la lecture confirmée reste, dans la liste, en mémoire et hors ligne', async () => {
    const env = await load();
    const { useFeedStore } = env;
    const live = await loadedThenHanging(env);
    const p = useFeedStore.getState().loadArticles();
    const a = useFeedStore.getState().articles[0];
    useFeedStore.getState().selectArticle(a);
    await settled();
    live.resolve(page(item(2), item(1)));
    await p; await settled();
    expect(useFeedStore.getState().articles.find((x) => x.id === a.id)?.read).toBe(true);
    expect(idb.lists.get('7@1|feed/1:all')?.articles.find((x) => x.id === a.id)?.read).toBe(true);
    // Le cache mémoire : c'est lui qui repeint au retour sur la vue.
    useFeedStore.getState().setFilter('all');
    expect(useFeedStore.getState().articles.find((x) => x.id === a.id)?.read).toBe(true);
  });

  it('rouvrir la ligne ne décompte pas une seconde fois', async () => {
    const env = await load();
    const { useFeedStore } = env;
    const live = await loadedThenHanging(env);
    useFeedStore.setState({ unreadCounts: { 'feed/1': 2 } });
    const p = useFeedStore.getState().loadArticles();
    const a = useFeedStore.getState().articles[0];
    useFeedStore.getState().selectArticle(a);
    await settled();
    live.resolve(page(item(2), item(1)));
    await p; await settled();
    useFeedStore.getState().selectArticle(null);
    useFeedStore.getState().selectArticle(useFeedStore.getState().articles.find((x) => x.id === a.id)!);
    await settled();
    expect(useFeedStore.getState().unreadCounts['feed/1']).toBe(1);
  });

  it('un article rouvert non lu pendant le vol reste non lu', async () => {
    const env = await load();
    const { useFeedStore } = env;
    const live = await loadedThenHanging(env, [item(2, [READ]), item(1)]);
    const p = useFeedStore.getState().loadArticles();
    await useFeedStore.getState().toggleRead(useFeedStore.getState().articles[0]);
    live.resolve(page(item(2, [READ]), item(1)));
    await p; await settled();
    expect(useFeedStore.getState().articles[0].read).toBe(false);
  });

  it('une lecture partie pendant le vol de l’écriture ne la défait pas non plus', async () => {
    const env = await load();
    const { api, useFeedStore } = env;
    const live = await loadedThenHanging(env);
    const write = deferred<void>();
    vi.mocked(api.markAsRead).mockReturnValueOnce(write.promise);
    const a = useFeedStore.getState().articles[0];
    useFeedStore.getState().selectArticle(a);       // écriture en vol
    const p = useFeedStore.getState().loadArticles(); // la lecture part après elle
    write.resolve();                                 // … mais passe au serveur avant
    await settled();
    live.resolve(page(item(2), item(1)));
    await p; await settled();
    expect(useFeedStore.getState().articles.find((x) => x.id === a.id)?.read).toBe(true);
  });

  it('un refus du serveur pendant le vol : la réponse n’y change rien, le rollback tient', async () => {
    const env = await load();
    const { api, useFeedStore } = env;
    const live = await loadedThenHanging(env);
    vi.mocked(api.markAsRead).mockRejectedValueOnce(Object.assign(new Error('refused'), { response: { status: 400 } }));
    const p = useFeedStore.getState().loadArticles();
    const a = useFeedStore.getState().articles[0];
    useFeedStore.getState().selectArticle(a);
    await settled();
    live.resolve(page(item(2), item(1)));
    await p; await settled();
    expect(useFeedStore.getState().articles.find((x) => x.id === a.id)?.read).toBe(false);
  });

  it('le favori tient', async () => {
    const env = await load();
    const { useFeedStore } = env;
    const live = await loadedThenHanging(env);
    const p = useFeedStore.getState().loadArticles();
    await useFeedStore.getState().toggleStar(useFeedStore.getState().articles[0]);
    live.resolve(page(item(2), item(1)));
    await p; await settled();
    expect(useFeedStore.getState().articles[0].starred).toBe(true);
  });

  it('« à lire plus tard » tient', async () => {
    const env = await load();
    const { useFeedStore, READ_LATER_LABEL } = env;
    const live = await loadedThenHanging(env);
    const p = useFeedStore.getState().loadArticles();
    await useFeedStore.getState().toggleReadLater(useFeedStore.getState().articles[0]);
    live.resolve(page(item(2), item(1)));
    await p; await settled();
    expect(useFeedStore.getState().articles[0].labels).toContain(READ_LATER_LABEL);
  });

  it('l’étiquette tient, et les autres champs restent ceux du serveur', async () => {
    const env = await load();
    const { useFeedStore } = env;
    const live = await loadedThenHanging(env);
    const p = useFeedStore.getState().loadArticles();
    await useFeedStore.getState().toggleArticleLabel(useFeedStore.getState().articles[0], 'user/-/label/x');
    live.resolve(page(item(2, [STARRED]), item(1)));
    await p; await settled();
    expect(useFeedStore.getState().articles[0].labels).toContain('user/-/label/x');
    expect(useFeedStore.getState().articles[0].starred).toBe(true);
  });

  it('une ligne cochée sous Non lus ne revient pas', async () => {
    const env = await load();
    const { api, useFeedStore } = env;
    vi.mocked(api.getStreamContents).mockResolvedValue(page(item(2), item(1)) as never);
    useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    const live = deferred();
    vi.mocked(api.getStreamContents).mockImplementation(() => live.promise as never);
    const p = useFeedStore.getState().loadArticles();
    await useFeedStore.getState().toggleRead(useFeedStore.getState().articles[0]);
    live.resolve(page(item(2), item(1)));
    await p; await settled();
    expect(useFeedStore.getState().articles.map((a) => a.id)).toEqual([hex(1)]);
  });

  it('une ligne retirée d’« À lire plus tard » ne revient pas', async () => {
    const env = await load();
    const { api, useFeedStore, READ_LATER_LABEL } = env;
    const later = `user/-/label/${READ_LATER_LABEL.split('/').pop()}`;
    vi.mocked(api.getStreamContents).mockResolvedValue(page(item(2, [later]), item(1, [later])) as never);
    useFeedStore.getState().selectView(null, 'readlater');
    await settled();
    const live = deferred();
    vi.mocked(api.getStreamContents).mockImplementation(() => live.promise as never);
    const p = useFeedStore.getState().loadArticles();
    await useFeedStore.getState().toggleReadLater(useFeedStore.getState().articles[0]);
    live.resolve(page(item(2, [later]), item(1, [later])));
    await p; await settled();
    expect(useFeedStore.getState().articles.map((a) => a.id)).toEqual([hex(1)]);
  });

  it('sous Non lus, la ligne de l’article ouvert reste à sa place', async () => {
    const env = await load();
    const { api, useFeedStore } = env;
    vi.mocked(api.getStreamContents).mockResolvedValue(page(item(2), item(1)) as never);
    useFeedStore.getState().selectView(feed1, 'unread');
    await settled();
    const live = deferred();
    vi.mocked(api.getStreamContents).mockImplementation(() => live.promise as never);
    const p = useFeedStore.getState().loadArticles();
    useFeedStore.getState().selectArticle(useFeedStore.getState().articles[0]);
    await settled();
    live.resolve(page(item(2), item(1)));
    await p; await settled();
    expect(useFeedStore.getState().articles.map((a) => a.id)).toEqual([hex(2), hex(1)]);
  });

  it('une réponse partie APRÈS le geste a le dernier mot : un autre appareil a pu le défaire', async () => {
    const env = await load();
    const { api, useFeedStore } = env;
    await loadedThenHanging(env);
    vi.mocked(api.getStreamContents).mockResolvedValue(page(item(2), item(1)) as never);
    const a = useFeedStore.getState().articles[0];
    useFeedStore.getState().selectArticle(a);
    await settled();
    await useFeedStore.getState().loadArticles();
    expect(useFeedStore.getState().articles[0].read).toBe(false);
  });

  it('le marquage d’une plage tient', async () => {
    const env = await load();
    const { useFeedStore } = env;
    const live = await loadedThenHanging(env);
    const p = useFeedStore.getState().loadArticles();
    await useFeedStore.getState().markReadRelative(useFeedStore.getState().articles[0], 'below');
    live.resolve(page(item(2), item(1)));
    await p; await settled();
    expect(useFeedStore.getState().articles[1].read).toBe(true);
  });

  it('« Tout lu » tient sur les lignes affichées', async () => {
    const env = await load();
    const { useFeedStore } = env;
    const live = await loadedThenHanging(env);
    const p = useFeedStore.getState().loadArticles();
    await useFeedStore.getState().markAllAsRead();
    live.resolve(page(item(2), item(1)));
    await p; await settled();
    expect(useFeedStore.getState().articles.every((a) => a.read)).toBe(true);
  });
});

describe('silentRefresh en vol pendant un geste', () => {
  it('le volet garde l’article lu, et la liste aussi', async () => {
    const env = await load();
    const { useFeedStore } = env;
    const live = await loadedThenHanging(env);
    const p = useFeedStore.getState().silentRefresh();
    await flush(); // relevé des compteurs passé, page en vol
    const a = useFeedStore.getState().articles[0];
    useFeedStore.getState().selectArticle(a);
    await settled();
    live.resolve(page(item(2), item(1)));
    await p; await settled();
    expect(useFeedStore.getState().selectedArticle?.read).toBe(true);
    expect(useFeedStore.getState().articles.find((x) => x.id === a.id)?.read).toBe(true);
  });
});

describe('les autres écrivains de cache', () => {
  it('une page préchargée en vol ne repeint pas la ligne non lue', async () => {
    const env = await load();
    const { api, useFeedStore } = env;
    const live = deferred();
    vi.mocked(api.getStreamContents).mockImplementation(() => live.promise as never);
    const p = useFeedStore.getState().prefetchView(feed1);
    useFeedStore.getState().selectArticle({ id: hex(1), sourceId: 'feed/1', read: false, labels: [] } as never);
    await settled();
    live.resolve(page(item(1)));
    await p;
    const hanging = deferred();
    vi.mocked(api.getStreamContents).mockImplementation(() => hanging.promise as never);
    useFeedStore.getState().selectView(feed1, 'all');
    expect(useFeedStore.getState().articles[0].read).toBe(true);
  });

  it('la préparation hors ligne range la lecture faite pendant son vol', async () => {
    const env = await load();
    const { api, useFeedStore } = env;
    const live = deferred();
    vi.mocked(api.getStreamContents).mockImplementation(() => live.promise as never);
    useFeedStore.setState({ subscriptions: [feed1] });
    const p = useFeedStore.getState().prepareOffline();
    useFeedStore.getState().selectArticle({ id: hex(1), sourceId: 'feed/1', read: false, labels: [] } as never);
    await settled();
    live.resolve(page(item(1)));
    await p;
    expect(idb.lists.get('7@1|feed/1:prepared')?.articles[0].read).toBe(true);
  });

  it('les favoris rangés hors ligne gardent le geste fait pendant leur lecture', async () => {
    const env = await load();
    const { api, useFeedStore } = env;
    const live = deferred();
    vi.mocked(api.getStarredItems).mockImplementation(() => live.promise as never);
    vi.mocked(api.getStreamContents).mockResolvedValue(page() as never);
    const p = useFeedStore.getState().warmOfflineCache();
    useFeedStore.getState().selectArticle({ id: hex(1), sourceId: 'feed/1', read: false, labels: [] } as never);
    await settled();
    live.resolve(page(item(1, [STARRED])));
    await p;
    expect(idb.lists.get('7@1|:starred')?.articles[0].read).toBe(true);
  });
});

describe('loadMore en vol pendant un geste', () => {
  it('une ligne de la page suivante, marquée ailleurs entre-temps, arrive lue', async () => {
    const env = await load();
    const { api, useFeedStore } = env;
    vi.mocked(api.getStreamContents).mockResolvedValue({ items: [item(3)], continuation: 'c' } as never);
    useFeedStore.getState().selectView(feed1, 'all');
    await settled();
    const live = deferred();
    vi.mocked(api.getStreamContents).mockImplementation(() => live.promise as never);
    const p = useFeedStore.getState().loadMore();
    // L'article de la page à venir, lu depuis un résultat de recherche ou un lien.
    const other = { id: hex(2), sourceId: 'feed/1', read: false, labels: [] } as never;
    useFeedStore.getState().selectArticle(other);
    await settled();
    live.resolve(page(item(2)));
    await p; await settled();
    const rows = useFeedStore.getState().articles;
    expect(rows.find((x) => x.id === hex(2))?.read).toBe(true);
    expect(idb.lists.get('7@1|feed/1:all')?.articles.find((x) => x.id === hex(2))?.read).toBe(true);
  });
});
