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

import { useFeedStore, resolveSearchStreamId } from './feedStore';
import { useUiStore } from './uiStore';
import * as api from '../api/feeds';

const MAIN = 'user/-/state/org.freshrss/main';
const READING_LIST = 'user/-/state/com.google/reading-list';
const modern: Subscription[] = [
  { id: 'feed/1', title: 'Un', priority: 'main' },
  { id: 'feed/2', title: 'Deux', priority: 'category' },
];
const legacy: Subscription[] = [{ id: 'feed/1', title: 'Un' }, { id: 'feed/2', title: 'Deux' }];

const streamOf = (call: number): string => vi.mocked(api.getStreamContents).mock.calls[call][0] as string;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useUiStore.setState({ articleOrder: 'newest', feedSettings: {} });
  useFeedStore.setState({ selectedFeed: null, filter: 'all', articles: [], continuation: null, searchQuery: '' });
  vi.mocked(api.getStreamContents).mockResolvedValue({ items: [], continuation: null });
});

describe('feedStore — accueil et visibilité FreshRSS', () => {
  it("charge le flux principal quand FreshRSS annonce des priorités", async () => {
    useFeedStore.setState({ subscriptions: modern });
    await useFeedStore.getState().loadArticles();
    for (let i = 0; i < vi.mocked(api.getStreamContents).mock.calls.length; i++) expect(streamOf(i)).toBe(MAIN);
  });

  it("garde reading-list pour un FreshRSS sans priorités", async () => {
    useFeedStore.setState({ subscriptions: legacy });
    await useFeedStore.getState().loadArticles();
    expect(streamOf(0)).toBe(READING_LIST);
  });

  it('« Tout lu » sur l’accueil ne vise que le flux principal', async () => {
    useFeedStore.setState({ subscriptions: modern, unreadCounts: { 'feed/1': 2, 'feed/2': 5 } });
    await useFeedStore.getState().markAllAsRead();
    expect(vi.mocked(api.markAllAsRead)).toHaveBeenCalled();
    expect(vi.mocked(api.markAllAsRead).mock.calls[0][0]).toBe(MAIN);
  });

  it('la recherche sur l’accueil suit le même flux', () => {
    expect(resolveSearchStreamId(null, 'all', modern)).toBe(MAIN);
    expect(resolveSearchStreamId(null, 'all', legacy)).toBe(READING_LIST);
    expect(resolveSearchStreamId(null, 'all')).toBe(READING_LIST);
  });
});
