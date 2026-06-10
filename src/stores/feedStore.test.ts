// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Article } from '../types';

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
