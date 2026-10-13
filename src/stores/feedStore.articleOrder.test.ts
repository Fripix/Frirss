// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Subscription } from '../types';

vi.mock('../api/feeds', () => ({
  getSubscriptionList: vi.fn(),
  getUnreadCounts: vi.fn(),
  getStreamContents: vi.fn(),
  getStarredItems: vi.fn(),
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

const feed1 = { id: 'feed/1', title: 'Un' } as Subscription;
const feed2 = { id: 'feed/2', title: 'Deux' } as Subscription;
// Flux propre au test du cache : le cache mémoire du store est au niveau module
// et survit d'un test à l'autre.
const feed4 = { id: 'feed/4', title: 'Quatre' } as Subscription;

/** L'option `order` du n-ième appel à getStreamContents. */
const sentOrder = (call: number): unknown =>
  (vi.mocked(api.getStreamContents).mock.calls[call][4] as { order?: unknown } | undefined)?.order;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useUiStore.setState({ articleOrder: 'newest', feedSettings: {} });
  useFeedStore.setState({ selectedFeed: null, filter: 'all', articles: [], continuation: null, searchQuery: '' });
  vi.mocked(api.getStreamContents).mockResolvedValue({ items: [], continuation: null });
});

describe('feedStore — ordre des articles', () => {
  it("demande les plus anciens d'abord quand c'est l'ordre global", async () => {
    useUiStore.getState().setArticleOrder('oldest');
    useFeedStore.setState({ selectedFeed: feed1 });
    await useFeedStore.getState().loadArticles();
    expect(vi.mocked(api.getStreamContents)).toHaveBeenCalled();
    for (let i = 0; i < vi.mocked(api.getStreamContents).mock.calls.length; i++) {
      expect(sentOrder(i)).toBe('oldest');
    }
  });

  it('la surcharge du flux gagne sur le global, et ne déborde pas sur les autres flux', async () => {
    useUiStore.getState().setFeedArticleOrder('feed/1', 'oldest');
    useFeedStore.setState({ selectedFeed: feed1 });
    await useFeedStore.getState().loadArticles();
    expect(sentOrder(0)).toBe('oldest');

    vi.clearAllMocks();
    vi.mocked(api.getStreamContents).mockResolvedValue({ items: [], continuation: null });
    useFeedStore.setState({ selectedFeed: feed2 });
    await useFeedStore.getState().loadArticles();
    expect(sentOrder(0)).toBe('newest');
  });

  it('loadMore conserve l’ordre de la vue', async () => {
    useUiStore.getState().setArticleOrder('oldest');
    useFeedStore.setState({ selectedFeed: feed1, continuation: 'c1' });
    await useFeedStore.getState().loadMore();
    const calls = vi.mocked(api.getStreamContents).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1][2]).toBe('c1');
    expect(sentOrder(calls.length - 1)).toBe('oldest');
  });

  it("changer d'ordre ne repeint pas la liste depuis le cache mémoire de l'autre ordre", async () => {
    useFeedStore.setState({ selectedFeed: feed4 });
    vi.mocked(api.getStreamContents).mockResolvedValue({
      items: [{ id: 'a1', title: 'x', published: 1, origin: { streamId: 'feed/4', title: 'Quatre' }, categories: [] } as never],
      continuation: null,
    });
    await useFeedStore.getState().loadArticles();
    expect(useFeedStore.getState().articles.map((a) => a.id)).toEqual(['a1']);

    useUiStore.getState().setArticleOrder('oldest');
    const p = useFeedStore.getState().loadArticles();
    // Clé de cache distincte → rien à peindre d'avance → le spinner s'affiche.
    expect(useFeedStore.getState().loading).toBe(true);
    await p;
  });
});
