// @vitest-environment jsdom
//
// R3T3-2 (troisième round 1.9.0) : une page de suite appartient à la vue qui
// l'a demandée, dans l'échec comme dans la réussite. Son `catch` n'avait pas
// la garde de vue du chemin de réussite : « Erreur de chargement » s'affichait
// sur une vue saine après une bascule de flux ou de serveur, et `loadingMore`
// retombait sous la page en vol de la nouvelle vue.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/offlineStore', () => ({
  listsPatch: vi.fn(async () => {}),
  listGet: vi.fn(async () => undefined),
  listPut: vi.fn(async () => {}),
  listEvictOlderThan: vi.fn(async () => {}),
  listsWithoutSource: vi.fn(async () => {}),
  subsGet: vi.fn(async () => undefined),
  subsPut: vi.fn(async () => {}),
  clearOfflineViews: vi.fn(async () => {}),
  queueGet: vi.fn(async () => []),
  queuePut: vi.fn(async () => {}),
}));
vi.mock('../api/feeds', () => ({
  getSubscriptionList: vi.fn(async () => ({ subscriptions: [] })), getUnreadCounts: vi.fn(async () => []), getStreamContents: vi.fn(),
  getStarredItems: vi.fn(async () => ({ items: [], continuation: null })),
  markAsRead: vi.fn(async () => {}), markAsUnread: vi.fn(async () => {}),
  markAsStarred: vi.fn(async () => {}), removeStarred: vi.fn(async () => {}),
  markAllAsRead: vi.fn(async () => {}), getUnreadItemIds: vi.fn(async () => ({ ids: [], complete: true })),
  fetchStreamPage: vi.fn(), subscribeFeed: vi.fn(), editFeed: vi.fn(), unsubscribeFeed: vi.fn(),
  getTagList: vi.fn(async () => []), getStreamItemCount: vi.fn(), setArticleLabel: vi.fn(async () => {}),
  renameTag: vi.fn(), deleteTag: vi.fn(), clearWriteToken: vi.fn(), itemIdsNewerThanEntry: vi.fn(async () => []),
}));
vi.mock('../api/backend', () => ({ startActualize: vi.fn(), getActualizeStatus: vi.fn() }));
vi.mock('../i18n', () => ({ default: { t: (k: string) => k } }));
vi.mock('../lib/extractCache', () => ({
  peekExtract: vi.fn(() => undefined), getExtract: vi.fn(async () => undefined), putExtract: vi.fn(async () => {}),
  pinExtract: vi.fn(async () => {}), unpinExtractsExcept: vi.fn(async () => {}),
  getOutdatedExtract: vi.fn(async () => undefined),
}));
vi.mock('../utils/extractContent', () => ({ extractFullContent: vi.fn(async () => { throw new Error('no'); }) }));

function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const settled = async () => { for (let i = 0; i < 6; i++) await flush(); };
const hex = (n: number) => `tag:google.com,2005:reader/item/${n.toString(16).padStart(16, '0')}`;
const item = (n: number) => ({
  id: hex(n), title: `T${n}`, published: Math.floor(Date.now() / 1000) - n,
  origin: { streamId: 'feed/1', title: 'F' }, categories: [], alternate: [{ href: `https://example.com/${n}` }],
});
const feed1 = { id: 'feed/1', title: 'F1', categories: [] } as never;
const feed2 = { id: 'feed/2', title: 'F2', categories: [] } as never;

async function load() {
  vi.resetModules();
  const api = await import('../api/feeds');
  const { useFeedStore } = await import('./feedStore');
  const { useAuthStore } = await import('./authStore');
  const { useUiStore } = await import('./uiStore');
  useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 }, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true } as never);
  vi.mocked(api.getStreamContents).mockResolvedValue({ items: [item(2), item(1)], continuation: 'c1' } as never);
  useFeedStore.getState().selectView(feed1, 'all');
  await settled();
  return { api, useFeedStore, useAuthStore, useUiStore };
}

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  localStorage.clear();
  vi.clearAllMocks();
});

describe('page de suite d’une vue quittée (R3T3-2)', () => {
  it('bascule de flux pendant une page qui échoue : aucun message, et la nouvelle vue peut paginer', async () => {
    const { api, useFeedStore, useUiStore } = await load();
    const pending = deferred();
    vi.mocked(api.getStreamContents).mockImplementationOnce(() => pending.promise as never);
    const lm = useFeedStore.getState().loadMore();
    await flush();
    expect(useFeedStore.getState().loadingMore).toBe(true);
    vi.mocked(api.getStreamContents).mockResolvedValue({ items: [item(20), item(19)], continuation: 'c2' } as never);
    useFeedStore.getState().selectView(feed2, 'all');
    await settled();
    pending.reject(new Error('502'));
    await lm; await settled();
    expect(useUiStore.getState().toasts, 'la vue affichée est saine').toEqual([]);
    expect(useFeedStore.getState().loadingMore, 'rien d’autre ne rend la main à la nouvelle vue').toBe(false);
  });

  it('bascule de serveur : l’échec de l’ancienne page ne dit rien, et laisse en vol la page de la nouvelle vue', async () => {
    const { api, useFeedStore, useAuthStore, useUiStore } = await load();
    const old = deferred();
    vi.mocked(api.getStreamContents).mockImplementationOnce(() => old.promise as never);
    const lm1 = useFeedStore.getState().loadMore();
    await flush();
    vi.mocked(api.getStreamContents).mockResolvedValue({ items: [item(20), item(19)], continuation: 'c2' } as never);
    useAuthStore.setState({ activeServerId: '2', serverUrl: 'https://b.example' } as never);
    useFeedStore.getState().resetAndReload();
    await settled();
    // La nouvelle vue demande sa propre suite, encore en vol.
    const next = deferred();
    vi.mocked(api.getStreamContents).mockImplementationOnce(() => next.promise as never);
    const lm2 = useFeedStore.getState().loadMore();
    await flush();
    expect(useFeedStore.getState().loadingMore).toBe(true);
    old.reject(new Error('502'));
    await lm1; await settled();
    expect(useUiStore.getState().toasts).toEqual([]);
    expect(useFeedStore.getState().loadingMore, 'la page de la nouvelle vue est toujours en vol').toBe(true);
    next.resolve({ items: [item(18)], continuation: null });
    await lm2; await settled();
    expect(useFeedStore.getState().loadingMore).toBe(false);
  });

  it('bascule de serveur : la réussite tardive de l’ancienne page laisse elle aussi en vol la page de la nouvelle vue', async () => {
    const { api, useFeedStore, useAuthStore } = await load();
    const old = deferred();
    vi.mocked(api.getStreamContents).mockImplementationOnce(() => old.promise as never);
    const lm1 = useFeedStore.getState().loadMore();
    await flush();
    vi.mocked(api.getStreamContents).mockResolvedValue({ items: [item(20), item(19)], continuation: 'c2' } as never);
    useAuthStore.setState({ activeServerId: '2', serverUrl: 'https://b.example' } as never);
    useFeedStore.getState().resetAndReload();
    await settled();
    const next = deferred();
    vi.mocked(api.getStreamContents).mockImplementationOnce(() => next.promise as never);
    const lm2 = useFeedStore.getState().loadMore();
    await flush();
    old.resolve({ items: [item(3)], continuation: null });
    await lm1; await settled();
    expect(useFeedStore.getState().loadingMore).toBe(true);
    next.resolve({ items: [item(18)], continuation: null });
    await lm2; await settled();
    expect(useFeedStore.getState().loadingMore).toBe(false);
  });

  it('la vue n’a pas changé : l’échec se dit toujours', async () => {
    const { api, useFeedStore, useUiStore } = await load();
    vi.mocked(api.getStreamContents).mockRejectedValueOnce(new Error('502'));
    await useFeedStore.getState().loadMore();
    await settled();
    expect(useUiStore.getState().toasts).toEqual([expect.objectContaining({ tone: 'error' })]);
    expect(useFeedStore.getState().loadingMore).toBe(false);
  });
});
