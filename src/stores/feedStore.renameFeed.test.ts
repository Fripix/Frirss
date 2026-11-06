// @vitest-environment jsdom
//
// Renommer un flux (troisième round 1.9.0, idée) : les cartes déjà chargées
// gardaient l'ancien nom de source jusqu'au rechargement — seuls la barre
// latérale et le titre de la vue suivaient.
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
  fetchStreamPage: vi.fn(), subscribeFeed: vi.fn(), editFeed: vi.fn(async () => {}), unsubscribeFeed: vi.fn(),
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

const flush = () => new Promise((r) => setTimeout(r, 0));
const settled = async () => { for (let i = 0; i < 6; i++) await flush(); };
const hex = (n: number) => `tag:google.com,2005:reader/item/${n.toString(16).padStart(16, '0')}`;
const item = (n: number, feed: string, title: string) => ({
  id: hex(n), title: `T${n}`, published: Math.floor(Date.now() / 1000) - n,
  origin: { streamId: feed, title }, categories: [], alternate: [{ href: `https://example.com/${n}` }],
});
const sub = (id: string, title: string) => ({ id, title, categories: [] }) as never;

async function load() {
  vi.resetModules();
  const api = await import('../api/feeds');
  const store = await import('../lib/offlineStore');
  const { useFeedStore } = await import('./feedStore');
  const { useAuthStore } = await import('./authStore');
  useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 }, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true } as never);
  vi.mocked(api.getStreamContents).mockResolvedValue({
    items: [item(3, 'feed/1', 'Ancien'), item(2, 'feed/2', 'Autre'), item(1, 'feed/1', 'Ancien')], continuation: null,
  } as never);
  useFeedStore.getState().selectView(null, 'all');
  await settled();
  useFeedStore.setState({ subscriptions: [sub('feed/1', 'Ancien'), sub('feed/2', 'Autre')] });
  return { api, store, useFeedStore, useAuthStore };
}

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  localStorage.clear();
  vi.clearAllMocks();
});

describe('renommer un flux : le nom de source suit', () => {
  it('les cartes déjà chargées et l’article ouvert prennent le nouveau nom, les autres flux non', async () => {
    const { useFeedStore } = await load();
    useFeedStore.setState({ selectedArticle: useFeedStore.getState().articles[0] });
    expect(await useFeedStore.getState().renameFeed('feed/1', 'Nouveau')).toBe(true);
    const s = useFeedStore.getState();
    expect(s.articles.map((a) => a.source)).toEqual(['Nouveau', 'Autre', 'Nouveau']);
    expect(s.selectedArticle?.source).toBe('Nouveau');
  });

  it('une vue déjà visitée, servie par la mémoire au retour, montre le nouveau nom', async () => {
    const { api, useFeedStore } = await load();
    await useFeedStore.getState().renameFeed('feed/1', 'Nouveau');
    // Le serveur ne répond plus : seul le cache mémoire peint la vue au retour.
    vi.mocked(api.getStreamContents).mockImplementation(() => new Promise(() => {}) as never);
    useFeedStore.getState().selectView(sub('feed/2', 'Autre'), 'all');
    await settled();
    useFeedStore.getState().selectView(null, 'all');
    await settled();
    expect(useFeedStore.getState().articles.map((a) => a.source)).toEqual(['Nouveau', 'Autre', 'Nouveau']);
  });

  it('les listes gardées hors ligne du flux et de l’accueil suivent', async () => {
    const { store, useFeedStore } = await load();
    await useFeedStore.getState().renameFeed('feed/1', 'Nouveau');
    const call = vi.mocked(store.listsPatch).mock.calls.at(-1);
    expect(call?.[0]).toEqual(expect.arrayContaining(['7@1|:all', '7@1|feed/1:all']));
    const change = call?.[1] as unknown as (rows: { sourceId: string; source: string }[]) => { source: string }[];
    expect(change([{ sourceId: 'feed/1', source: 'Ancien' }, { sourceId: 'feed/2', source: 'Autre' }]).map((a) => a.source))
      .toEqual(['Nouveau', 'Autre']);
  });

  it('renommage réglé après une bascule de serveur : rien ne change sur le nouveau serveur', async () => {
    const { api, useFeedStore, useAuthStore } = await load();
    let done!: () => void;
    vi.mocked(api.editFeed).mockImplementationOnce(() => new Promise<void>((r) => { done = r; }) as never);
    const p = useFeedStore.getState().renameFeed('feed/1', 'Nouveau');
    await flush();
    useAuthStore.setState({ activeServerId: '2', serverUrl: 'https://b.example' } as never);
    const articlesB = useFeedStore.getState().articles.map((a) => ({ ...a, source: 'Du serveur 2' }));
    useFeedStore.setState({ subscriptions: [sub('feed/1', 'Du serveur 2')], articles: articlesB, selectedFeed: sub('feed/1', 'Du serveur 2') });
    done();
    expect(await p).toBe(true);
    const s = useFeedStore.getState();
    expect(s.subscriptions.map((x) => x.title)).toEqual(['Du serveur 2']);
    expect(s.selectedFeed?.title).toBe('Du serveur 2');
    expect(new Set(s.articles.map((a) => a.source))).toEqual(new Set(['Du serveur 2']));
  });
});
