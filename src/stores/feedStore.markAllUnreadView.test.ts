// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Subscription } from '../types';

vi.mock('../api/feeds', () => ({
  getSubscriptionList: vi.fn(),
  getUnreadCounts: vi.fn(),
  getStreamContents: vi.fn(),
  getStarredItems: vi.fn(),
  getUnreadItemIds: vi.fn(() => Promise.resolve({ ids: [], complete: true })),
  markAsRead: vi.fn(() => Promise.resolve()),
  markAsUnread: vi.fn(() => Promise.resolve()),
  markAsStarred: vi.fn(() => Promise.resolve()),
  removeStarred: vi.fn(() => Promise.resolve()),
  markAllAsRead: vi.fn(() => Promise.resolve()),
  fetchStreamPage: vi.fn(),
  subscribeFeed: vi.fn(),
  editFeed: vi.fn(),
  unsubscribeFeed: vi.fn(),
  getTagList: vi.fn(),
  setArticleLabel: vi.fn(),
  renameTag: vi.fn(),
  deleteTag: vi.fn(),
  clearWriteToken: vi.fn(),
}));
vi.mock('../lib/offlineStore', () => ({
  listGet: vi.fn(() => Promise.resolve(undefined)),
  listPut: vi.fn(() => Promise.resolve()),
  listEvictOlderThan: vi.fn(() => Promise.resolve()),
  subsGet: vi.fn(() => Promise.resolve(undefined)),
  subsPut: vi.fn(() => Promise.resolve()),
  queueGet: vi.fn(() => Promise.resolve([])),
  queuePut: vi.fn(() => Promise.resolve()),
}));
vi.mock('../api/backend', () => ({ startActualize: vi.fn(), getActualizeStatus: vi.fn() }));
vi.mock('../i18n', () => ({ default: { t: (k: string) => k } }));

import { useFeedStore } from './feedStore';
import { useUiStore } from './uiStore';
import * as api from '../api/feeds';
import type { Article } from '../types';

const feed = { id: 'feed/1', title: 'Un' } as Subscription;
const art = (id: string): Article => ({ id, title: id, read: false, starred: false, sourceId: 'feed/1' } as Article);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useUiStore.setState({ toasts: [] });
  vi.mocked(api.getStreamContents).mockResolvedValue({ items: [], continuation: null });
  useFeedStore.setState({
    selectedFeed: feed, searchQuery: '', subscriptions: [feed],
    articles: [art('a'), art('b'), art('c')], continuation: 'c-next', unreadCounts: { 'feed/1': 3 },
  });
});

// Discussion #19 : après « Tout lu » dans la vue Non lus, les lignes restaient
// à l'écran, passées lues, sans état « Tout est lu » — il fallait tirer pour
// rafraîchir. Le ✓ d'une seule ligne, lui, la retire déjà sous ce filtre.
describe('markAllAsRead — vue Non lus', () => {
  it('vide la liste sous le filtre Non lus, comme le ✓ retire sa ligne', async () => {
    useFeedStore.setState({ filter: 'unread' });
    await useFeedStore.getState().markAllAsRead();
    const s = useFeedStore.getState();
    expect(s.articles).toEqual([]);
    // Sans continuation, l'état vide dit « Tout est lu » et non « d'autres pages ».
    expect(s.continuation).toBeNull();
  });

  it('garde les lignes, passées lues, sous le filtre Tous', async () => {
    useFeedStore.setState({ filter: 'all' });
    await useFeedStore.getState().markAllAsRead();
    const s = useFeedStore.getState();
    expect(s.articles.map((a) => a.id)).toEqual(['a', 'b', 'c']);
    expect(s.articles.every((a) => a.read)).toBe(true);
  });

  it('ne repeint pas les lignes lues depuis le cache mémoire en revenant sur la vue', async () => {
    useFeedStore.setState({ filter: 'unread' });
    // Un chargement préalable a mis la vue en cache mémoire.
    // (lecture « cache seul » puis lecture live : les deux rendent la même page)
    vi.mocked(api.getStreamContents).mockResolvedValue({
      items: [{ id: 'a', title: 'a', published: 1, origin: { streamId: 'feed/1', title: 'Un' }, categories: [] } as never],
      continuation: null,
    });
    await useFeedStore.getState().loadArticles();
    expect(useFeedStore.getState().articles.map((a) => a.id)).toEqual(['a']);
    await useFeedStore.getState().markAllAsRead();
    // Nouveau chargement : rien à peindre d'avance, le serveur fait foi.
    vi.mocked(api.getStreamContents).mockResolvedValue({ items: [], continuation: null });
    const p = useFeedStore.getState().loadArticles();
    expect(useFeedStore.getState().loading).toBe(true);
    await p;
    expect(useFeedStore.getState().articles).toEqual([]);
  });
});
