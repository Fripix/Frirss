// @vitest-environment jsdom
//
// M-12 (second round 1.9.0) : deux écritures du même attribut d'un même
// article partent dans l'ordre des gestes. « Lu » puis « non lu » aussitôt sur
// un réseau lent : FreshRSS recevait parfois le second avant le premier et
// gardait « lu » quand l'écran disait « non lu ».
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
  getSubscriptionList: vi.fn(), getUnreadCounts: vi.fn(async () => []), getStreamContents: vi.fn(),
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
}));
vi.mock('../utils/extractContent', () => ({ extractFullContent: vi.fn(async () => { throw new Error('no'); }) }));

async function load() {
  vi.resetModules();
  const api = await import('../api/feeds');
  const { useFeedStore, READ_LATER_LABEL } = await import('./feedStore');
  const { useAuthStore } = await import('./authStore');
  useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 }, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true } as never);
  vi.mocked(api.getStreamContents).mockResolvedValue({ items: [item(2), item(1)], continuation: null } as never);
  useFeedStore.getState().selectView({ id: 'feed/1', title: 'F1', categories: [] } as never, 'all');
  await settled();
  return { api, useFeedStore, READ_LATER_LABEL };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => { resolve = res; });
  return { promise, resolve };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const settled = async () => { for (let i = 0; i < 6; i++) await flush(); };
const hex = (n: number) => `tag:google.com,2005:reader/item/${n.toString(16).padStart(16, '0')}`;
const item = (n: number) => ({
  id: hex(n), title: `T${n}`, published: Math.floor(Date.now() / 1000) - n,
  origin: { streamId: 'feed/1', title: 'F' }, categories: [], alternate: [{ href: `https://example.com/${n}` }],
});

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  localStorage.clear();
  vi.clearAllMocks();
});

describe('écritures d’un même article mises en série (M-12)', () => {
  it('« lu » puis « non lu » aussitôt : « non lu » part après la réponse à « lu »', async () => {
    const { api, useFeedStore } = await load();
    const order: string[] = [];
    const slow = deferred();
    vi.mocked(api.markAsRead).mockImplementation(async () => { order.push('lu'); await slow.promise; order.push('lu ✓'); });
    vi.mocked(api.markAsUnread).mockImplementation(async () => { order.push('non lu'); });
    const a = useFeedStore.getState().articles[0];
    const p1 = useFeedStore.getState().toggleRead(a);
    const p2 = useFeedStore.getState().toggleRead({ ...a, read: true });
    await settled();
    expect(order).toEqual(['lu']);
    slow.resolve();
    await p1; await p2; await settled();
    expect(order).toEqual(['lu', 'lu ✓', 'non lu']);
    expect(useFeedStore.getState().articles[0].read).toBe(false);
  });

  it('l’ouverture marque lu, « non lu » aussitôt attend sa réponse', async () => {
    const { api, useFeedStore } = await load();
    const order: string[] = [];
    const slow = deferred();
    vi.mocked(api.markAsRead).mockImplementation(async () => { order.push('lu'); await slow.promise; });
    vi.mocked(api.markAsUnread).mockImplementation(async () => { order.push('non lu'); });
    const a = useFeedStore.getState().articles[0];
    useFeedStore.getState().selectArticle(a);
    const p = useFeedStore.getState().toggleRead(useFeedStore.getState().selectedArticle!);
    await settled();
    expect(order).toEqual(['lu']);
    slow.resolve();
    await p; await settled();
    expect(order).toEqual(['lu', 'non lu']);
  });

  it('un refus de la première n’empêche pas la seconde de partir', async () => {
    const { api, useFeedStore } = await load();
    const order: string[] = [];
    vi.mocked(api.markAsRead).mockImplementation(async () => { order.push('lu'); throw Object.assign(new Error('refus'), { response: { status: 400 } }); });
    vi.mocked(api.markAsUnread).mockImplementation(async () => { order.push('non lu'); });
    const a = useFeedStore.getState().articles[0];
    const p1 = useFeedStore.getState().toggleRead(a);
    const p2 = useFeedStore.getState().toggleRead({ ...a, read: true });
    await p1; await p2; await settled();
    expect(order).toEqual(['lu', 'non lu']);
  });

  it('favori : le retrait attend la réponse à l’ajout', async () => {
    const { api, useFeedStore } = await load();
    const order: string[] = [];
    const slow = deferred();
    vi.mocked(api.markAsStarred).mockImplementation(async () => { order.push('favori'); await slow.promise; });
    vi.mocked(api.removeStarred).mockImplementation(async () => { order.push('retrait'); });
    const a = useFeedStore.getState().articles[0];
    const p1 = useFeedStore.getState().toggleStar(a);
    const p2 = useFeedStore.getState().toggleStar({ ...a, starred: true });
    await settled();
    expect(order).toEqual(['favori']);
    slow.resolve();
    await p1; await p2;
    expect(order).toEqual(['favori', 'retrait']);
  });

  it('« Plus tard » : le retrait attend la réponse à l’ajout', async () => {
    const { api, useFeedStore, READ_LATER_LABEL } = await load();
    const order: boolean[] = [];
    const slow = deferred();
    vi.mocked(api.setArticleLabel).mockImplementation(async (_id: string | string[], _label: string, on?: boolean) => {
      order.push(!!on);
      if (on) await slow.promise;
    });
    const a = useFeedStore.getState().articles[0];
    const p1 = useFeedStore.getState().toggleReadLater(a);
    const p2 = useFeedStore.getState().toggleReadLater({ ...a, labels: [READ_LATER_LABEL] });
    await settled();
    expect(order).toEqual([true]);
    slow.resolve();
    await p1; await p2;
    expect(order).toEqual([true, false]);
  });

  it('deux articles différents ne s’attendent pas', async () => {
    const { api, useFeedStore } = await load();
    const order: string[] = [];
    vi.mocked(api.markAsRead).mockImplementation(async (id: string | string[]) => { order.push(String(id)); await new Promise(() => {}); });
    const [a, b] = useFeedStore.getState().articles;
    void useFeedStore.getState().toggleRead(a);
    void useFeedStore.getState().toggleRead(b);
    await settled();
    expect(order).toEqual([a.id, b.id]);
  });
});
