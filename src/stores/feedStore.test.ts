// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Article, Subscription } from '../types';

// Mock the FreshRSS API layer so the store never hits the network.
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
  searchItems: vi.fn(),
  subscribeFeed: vi.fn(),
  editFeed: vi.fn(),
  unsubscribeFeed: vi.fn(),
  getTagList: vi.fn(),
  setArticleLabel: vi.fn(),
  renameTag: vi.fn(),
  deleteTag: vi.fn(),
  clearWriteToken: vi.fn(),
}));

import { useFeedStore } from './feedStore';
import { useUiStore } from './uiStore';
import * as api from '../api/feeds';

const READING_LIST = 'user/-/state/com.google/reading-list';
const baseArticle = { id: 'a1', read: false, sourceId: 'feed/1' } as Article;

beforeEach(() => {
  vi.clearAllMocks();
  useFeedStore.setState({
    articles: [{ ...baseArticle }],
    selectedArticle: null,
    unreadCounts: { 'feed/1': 3, [READING_LIST]: 5 },
  });
});

describe('feedStore.selectArticle', () => {
  it('marks read optimistically and syncs in the background', () => {
    useFeedStore.getState().selectArticle({ ...baseArticle });
    const s = useFeedStore.getState();
    expect(s.selectedArticle!.read).toBe(true);
    expect(s.articles[0].read).toBe(true);
    expect(s.unreadCounts['feed/1']).toBe(2);
    expect(s.unreadCounts[READING_LIST]).toBe(4);
    expect(api.markAsRead).toHaveBeenCalledWith('a1');
  });

  it('reverts the optimistic update when the server call fails', async () => {
    vi.mocked(api.markAsRead).mockRejectedValueOnce(new Error('network'));
    useFeedStore.getState().selectArticle({ ...baseArticle });
    // optimistic state first
    expect(useFeedStore.getState().articles[0].read).toBe(true);
    // let the rejected promise settle
    await new Promise((r) => setTimeout(r, 0));
    const s = useFeedStore.getState();
    expect(s.articles[0].read).toBe(false);
    expect(s.unreadCounts['feed/1']).toBe(3);
    expect(s.unreadCounts[READING_LIST]).toBe(5);
  });

  it('does not call the API for an already-read article', () => {
    useFeedStore.getState().selectArticle({ id: 'a1', read: true, sourceId: 'feed/1' } as Article);
    expect(api.markAsRead).not.toHaveBeenCalled();
    expect(useFeedStore.getState().selectedArticle!.read).toBe(true);
    expect(useFeedStore.getState().unreadCounts['feed/1']).toBe(3);
  });
});

describe('feedStore — per-feed unread default filter', () => {
  type FeedArg = Parameters<ReturnType<typeof useFeedStore.getState>['selectView']>[0];
  const feedA = { id: 'feed/A', title: 'A' } as unknown as FeedArg;
  const feedB = { id: 'feed/B', title: 'B' } as unknown as FeedArg;

  beforeEach(() => {
    localStorage.clear();
    // Prevent network: stub the loader triggered by selectView / setFilter.
    useFeedStore.setState({ loadArticles: vi.fn() as never, selectedFeed: null });
    useUiStore.setState({ unreadOnlyByFeed: {} });
  });

  it('opening a feed with no stored preference defaults to "all"', () => {
    useFeedStore.getState().selectView(feedA);
    expect(useFeedStore.getState().filter).toBe('all');
  });

  it('remembers "unread only" per feed, independently of other feeds', () => {
    useUiStore.getState().setFeedUnreadOnly('feed/A', true);
    useFeedStore.getState().selectView(feedA);
    expect(useFeedStore.getState().filter).toBe('unread');
    // Feed B was never toggled → stays "all".
    useFeedStore.getState().selectView(feedB);
    expect(useFeedStore.getState().filter).toBe('all');
  });

  it('an explicit filter still wins over the stored default', () => {
    useUiStore.getState().setFeedUnreadOnly('feed/A', true);
    useFeedStore.getState().selectView(feedA, 'starred');
    expect(useFeedStore.getState().filter).toBe('starred');
  });

  it('setUnreadFilter stores the preference for the current feed only', () => {
    useFeedStore.setState({ selectedFeed: feedA as never });
    useFeedStore.getState().setUnreadFilter(true);
    expect(useUiStore.getState().unreadOnlyByFeed['feed/A']).toBe(true);
    expect(useFeedStore.getState().filter).toBe('unread');

    // Switch to feed B and turn it off there — feed A keeps its preference.
    useFeedStore.setState({ selectedFeed: feedB as never });
    useFeedStore.getState().setUnreadFilter(false);
    expect(useUiStore.getState().unreadOnlyByFeed['feed/B']).toBe(false);
    expect(useUiStore.getState().unreadOnlyByFeed['feed/A']).toBe(true);
  });
});

describe('feedStore.silentRefresh — keep the article being read (unread filter)', () => {
  const feed = { id: 'feed/1', title: 'F' } as unknown as Subscription;
  const A = { id: 'a', read: true, sourceId: 'feed/1', title: 'A', published: 1000 } as Article;
  const B = { id: 'b', read: false, sourceId: 'feed/1', title: 'B', published: 2000 } as Article;

  beforeEach(() => {
    vi.mocked(api.getUnreadCounts).mockResolvedValue([]);
    vi.mocked(api.getStarredItems).mockResolvedValue({ items: [], continuation: null } as never);
    // The fresh unread stream for the feed excludes the now-read A → only B.
    vi.mocked(api.getStreamContents).mockImplementation((streamId: string) =>
      Promise.resolve(
        (streamId === 'feed/1'
          ? { items: [{ id: 'b', categories: [] }], continuation: null }
          : { items: [], continuation: null }) as never
      )
    );
  });

  it('re-inserts the selected (now-read) article so it does not vanish', async () => {
    useFeedStore.setState({ selectedFeed: feed, filter: 'unread', articles: [A, B], selectedArticle: A });
    await useFeedStore.getState().silentRefresh();
    const s = useFeedStore.getState();
    expect(s.articles.map((a) => a.id)).toEqual(['a', 'b']);
    expect(s.articles.find((a) => a.id === 'a')!.read).toBe(true);
    expect(s.selectedArticle!.id).toBe('a');
  });

  it('drops the read article once it is no longer the one being read', async () => {
    useFeedStore.setState({ selectedFeed: feed, filter: 'unread', articles: [A, B], selectedArticle: B });
    await useFeedStore.getState().silentRefresh();
    expect(useFeedStore.getState().articles.map((a) => a.id)).toEqual(['b']);
  });
});
