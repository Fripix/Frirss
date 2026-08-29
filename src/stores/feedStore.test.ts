// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

// Mock the offline (IndexedDB) layer — unavailable in jsdom anyway. Defaults
// mirror its graceful-degrade behaviour (reads → undefined, writes → no-op).
vi.mock('../lib/offlineStore', () => ({
  listGet: vi.fn(() => Promise.resolve(undefined)),
  listPut: vi.fn(() => Promise.resolve()),
  listEvictOlderThan: vi.fn(() => Promise.resolve()),
  subsGet: vi.fn(() => Promise.resolve(undefined)),
  subsPut: vi.fn(() => Promise.resolve()),
  queueGet: vi.fn(() => Promise.resolve([])),
  queuePut: vi.fn(() => Promise.resolve()),
}));

// The real-refresh backend calls (POST/GET .../actualize) — refresh()'s
// routing logic is exercised without a network.
vi.mock('../api/backend', () => ({
  startActualize: vi.fn(),
  getActualizeStatus: vi.fn(),
}));

import { useFeedStore, pickPrefetchFeeds, isCategoryStreamId, resolveSearchStreamId } from './feedStore';
import { useUiStore } from './uiStore';
import { useAuthStore } from './authStore';
import * as api from '../api/feeds';
import * as offline from '../lib/offlineStore';
import * as backendApi from '../api/backend';
import { POLL_INTERVAL_MS } from '../lib/refreshPolling';

const READING_LIST = 'user/-/state/com.google/reading-list';
const baseArticle = { id: 'a1', read: false, sourceId: 'feed/1' } as Article;

beforeEach(() => {
  vi.clearAllMocks();
  useFeedStore.setState({
    pendingActions: 0,
    failedActions: 0,
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

  // Reading an article goes through selectArticle, NOT toggleRead — this is
  // the path that has to survive being offline.
  it('keeps the article read and queues it when there is no network', async () => {
    vi.mocked(api.markAsRead).mockRejectedValueOnce(new Error('Network Error'));
    useFeedStore.getState().selectArticle({ ...baseArticle });
    expect(useFeedStore.getState().articles[0].read).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    const s = useFeedStore.getState();
    // Still read: the action is remembered, not undone.
    expect(s.articles[0].read).toBe(true);
    expect(s.unreadCounts['feed/1']).toBe(2);
    expect(s.pendingActions).toBe(1);
    expect(offline.queuePut).toHaveBeenCalled();
  });

  it('reverts the optimistic update when the server refuses', async () => {
    // A 4xx is a real refusal — replaying it later would never succeed.
    vi.mocked(api.markAsRead).mockRejectedValueOnce({ response: { status: 403 } });
    useFeedStore.getState().selectArticle({ ...baseArticle });
    expect(useFeedStore.getState().articles[0].read).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    const s = useFeedStore.getState();
    expect(s.articles[0].read).toBe(false);
    expect(s.unreadCounts['feed/1']).toBe(3);
    expect(s.unreadCounts[READING_LIST]).toBe(5);
    expect(s.pendingActions).toBe(0);
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

describe('pickPrefetchFeeds', () => {
  const feed = (id: string) => ({ id } as unknown as Subscription);
  it('keeps only unread feeds, most-unread first', () => {
    const subs = [feed('a'), feed('b'), feed('c'), feed('d')];
    const counts = { a: 0, b: 5, c: 2, d: 0 };
    expect(pickPrefetchFeeds(subs, counts, 10).map((f) => f.id)).toEqual(['b', 'c']);
  });
  it('honours the cap', () => {
    const subs = Array.from({ length: 5 }, (_, i) => feed(`f${i}`));
    const counts = Object.fromEntries(subs.map((f, i) => [f.id, i + 1]));
    expect(pickPrefetchFeeds(subs, counts, 2)).toHaveLength(2);
  });
});

describe('feedStore.loadSubscriptions — offline-first paint + syncing flag', () => {
  beforeEach(() => {
    useFeedStore.setState({ subscriptions: [], categoryIds: [], syncing: false });
    vi.mocked(api.getUnreadCounts).mockResolvedValue([]);
    vi.mocked(api.getTagList).mockResolvedValue([] as never);
    vi.mocked(api.getStarredItems).mockResolvedValue({ items: [], continuation: null } as never);
    vi.mocked(api.getStreamContents).mockResolvedValue({ items: [], continuation: null } as never);
  });

  it('paints the persisted subscriptions snapshot before the live request resolves', async () => {
    const snapshot = [{ id: 'feed/1', title: 'Cached Feed' }] as unknown as Subscription[];
    vi.mocked(offline.subsGet).mockResolvedValueOnce(snapshot);
    // Live subscription request stays pending → only the snapshot can paint.
    let release!: (v: unknown) => void;
    vi.mocked(api.getSubscriptionList).mockReturnValueOnce(
      new Promise((r) => { release = r; }) as never
    );

    const p = useFeedStore.getState().loadSubscriptions();
    await Promise.resolve();
    await Promise.resolve();
    expect(useFeedStore.getState().subscriptions).toEqual(snapshot);

    release([]); // let loadSubscriptions finish
    await p;
  });

  it('marks syncing true while the live load runs and false once it settles', async () => {
    vi.mocked(api.getSubscriptionList).mockResolvedValue([] as never);
    const p = useFeedStore.getState().loadSubscriptions();
    expect(useFeedStore.getState().syncing).toBe(true);
    await p;
    expect(useFeedStore.getState().syncing).toBe(false);
  });

  it('clears syncing even when the live load fails', async () => {
    vi.mocked(api.getSubscriptionList).mockRejectedValueOnce(new Error('offline'));
    await useFeedStore.getState().loadSubscriptions();
    expect(useFeedStore.getState().syncing).toBe(false);
  });
});

describe('isCategoryStreamId', () => {
  it('detects category label streams, not feeds or empty ids', () => {
    expect(isCategoryStreamId('user/-/label/News')).toBe(true);
    expect(isCategoryStreamId('feed/https://example.com/rss')).toBe(false);
    expect(isCategoryStreamId(undefined)).toBe(false);
    expect(isCategoryStreamId(null)).toBe(false);
  });
});

describe('resolveSearchStreamId', () => {
  const feed = { id: 'feed/https://ex.com/rss', title: 'Ex' } as unknown as Subscription;
  it('scopes to the selected feed/category', () => {
    expect(resolveSearchStreamId(feed, 'all')).toBe('feed/https://ex.com/rss');
    expect(resolveSearchStreamId(feed, 'unread')).toBe('feed/https://ex.com/rss');
  });
  it('scopes to read-later when that filter is active', () => {
    expect(resolveSearchStreamId(null, 'readlater')).toBe('user/-/label/À lire plus tard');
  });
  it('scopes to starred (global) when that filter is active', () => {
    expect(resolveSearchStreamId(null, 'starred')).toBe('user/-/state/com.google/starred');
  });
  it('defaults to the whole reading-list on the all-feeds view', () => {
    expect(resolveSearchStreamId(null, 'all')).toBe('user/-/state/com.google/reading-list');
    expect(resolveSearchStreamId(null, 'unread')).toBe('user/-/state/com.google/reading-list');
  });
});

describe('feedStore.refresh — routing between the read-only sync and the real (server-side) refresh', () => {
  const origLoadSubscriptions = useFeedStore.getState().loadSubscriptions;
  const origLoadArticles = useFeedStore.getState().loadArticles;
  const origSilentRefresh = useFeedStore.getState().silentRefresh;
  const origSyncCounts = useFeedStore.getState().syncCounts;
  const origActiveServerId = useAuthStore.getState().activeServerId;

  let loadSubscriptions: ReturnType<typeof vi.fn>;
  let loadArticles: ReturnType<typeof vi.fn>;
  let silentRefresh: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // refresh() delegates the actual list/subscription reload to these — stub
    // them so this describe block pins refresh()'s *routing* (which branch it
    // takes, and what it does to hasRefreshToken/refreshPhase), not the
    // network plumbing behind loadSubscriptions/loadArticles, which already
    // has its own coverage above.
    loadSubscriptions = vi.fn(() => Promise.resolve());
    loadArticles = vi.fn(() => Promise.resolve());
    silentRefresh = vi.fn(() => Promise.resolve());
    useFeedStore.setState({
      loadSubscriptions: loadSubscriptions as never,
      loadArticles: loadArticles as never,
      silentRefresh: silentRefresh as never,
      refreshPhase: 'idle',
      hasRefreshToken: false,
      refreshResult: null,
      unreadCounts: {},
    });
    useAuthStore.setState({ activeServerId: '1' });
  });

  afterEach(() => {
    useFeedStore.setState({
      loadSubscriptions: origLoadSubscriptions,
      loadArticles: origLoadArticles,
      silentRefresh: origSilentRefresh,
      syncCounts: origSyncCounts,
    });
    useAuthStore.setState({ activeServerId: origActiveServerId });
    vi.useRealTimers();
  });

  it('no refresh token: unchanged read-only sync, never starts a real job, phase stays idle', async () => {
    useFeedStore.setState({ hasRefreshToken: false });

    await useFeedStore.getState().refresh();

    expect(backendApi.startActualize).not.toHaveBeenCalled();
    expect(loadSubscriptions).toHaveBeenCalledTimes(1);
    expect(loadArticles).toHaveBeenCalledTimes(1);
    expect(useFeedStore.getState().refreshPhase).toBe('idle');
  });

  it('a 409 (no master token) falls back to a read-only sync AND clears hasRefreshToken', async () => {
    useFeedStore.setState({ hasRefreshToken: true });
    vi.mocked(backendApi.startActualize).mockResolvedValueOnce(null);

    await useFeedStore.getState().refresh();

    expect(backendApi.startActualize).toHaveBeenCalledTimes(1);
    expect(useFeedStore.getState().hasRefreshToken).toBe(false);
    expect(loadSubscriptions).toHaveBeenCalledTimes(1);
    expect(loadArticles).toHaveBeenCalledTimes(1);
    expect(useFeedStore.getState().refreshPhase).toBe('idle');
  });

  it('a non-409 failure falls back for this attempt but does NOT clear hasRefreshToken', async () => {
    useFeedStore.setState({ hasRefreshToken: true });
    vi.mocked(backendApi.startActualize).mockRejectedValueOnce(new Error('Network Error'));

    await useFeedStore.getState().refresh();

    expect(useFeedStore.getState().hasRefreshToken).toBe(true);
    expect(loadSubscriptions).toHaveBeenCalledTimes(1);
    expect(loadArticles).toHaveBeenCalledTimes(1);
  });

  it('re-entrancy guard: a second call while a refresh is running returns without starting a new loop', async () => {
    useFeedStore.setState({ refreshPhase: 'running', hasRefreshToken: true });

    await useFeedStore.getState().refresh();

    expect(backendApi.startActualize).not.toHaveBeenCalled();
    expect(loadSubscriptions).not.toHaveBeenCalled();
    expect(loadArticles).not.toHaveBeenCalled();
    expect(useFeedStore.getState().refreshPhase).toBe('running');
  });

  it('polls until the job reaches a terminal phase, then does the final load', async () => {
    useFeedStore.setState({ hasRefreshToken: true });
    vi.mocked(backendApi.startActualize).mockResolvedValueOnce({ status: 'running', startedAt: Date.now() });
    vi.mocked(backendApi.getActualizeStatus).mockResolvedValueOnce({ status: 'done', startedAt: Date.now() });

    vi.useFakeTimers();
    const p = useFeedStore.getState().refresh();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await p;

    expect(silentRefresh).toHaveBeenCalledTimes(1);
    expect(backendApi.getActualizeStatus).toHaveBeenCalledTimes(1);
    // The final load, after the loop exits — not the read-only-sync path
    // (which would have run before ever calling startActualize).
    expect(loadSubscriptions).toHaveBeenCalledTimes(1);
    expect(loadArticles).toHaveBeenCalledTimes(1);
    expect(useFeedStore.getState().refreshPhase).toBe('done');
  });

  it('a poll tick falls back to syncCounts (not silentRefresh) once the user has paged past page 1, leaving their list alone', async () => {
    const pagedArticles = Array.from({ length: 51 }, (_, i) => ({ ...baseArticle, id: `a${i}` }));
    const syncCounts = vi.fn(() => Promise.resolve());
    useFeedStore.setState({
      hasRefreshToken: true,
      articles: pagedArticles as never,
      syncCounts: syncCounts as never,
    });
    vi.mocked(backendApi.startActualize).mockResolvedValueOnce({ status: 'running', startedAt: Date.now() });
    vi.mocked(backendApi.getActualizeStatus).mockResolvedValueOnce({ status: 'done', startedAt: Date.now() });

    vi.useFakeTimers();
    const p = useFeedStore.getState().refresh();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await p;

    // The mid-loop tick must not call the page-1-replacing silentRefresh...
    expect(silentRefresh).not.toHaveBeenCalled();
    // ...but counters (and thus the pulse/banner) must still stay live.
    expect(syncCounts).toHaveBeenCalledTimes(1);
    // And the user's paged-deeper list must be left untouched.
    expect(useFeedStore.getState().articles).toHaveLength(51);
  });
});

describe('feedStore.selectCategory', () => {
  it('opens a category as a label-stream feed (id = stream, title = name)', () => {
    const original = useFeedStore.getState().selectView;
    const selectViewSpy = vi.fn();
    useFeedStore.setState({ selectView: selectViewSpy as never });

    useFeedStore.getState().selectCategory({ id: 'user/-/label/News', label: 'News' });

    expect(selectViewSpy).toHaveBeenCalledWith({ id: 'user/-/label/News', title: 'News' });
    useFeedStore.setState({ selectView: original });
  });
});

describe('feedStore.toggleStar — refus du serveur depuis la vue Favoris', () => {
  const starred = { id: 'a1', read: false, starred: true, sourceId: 'feed/1' } as Article;

  beforeEach(() => {
    useFeedStore.setState({
      filter: 'starred',
      articles: [{ id: 'a0', sourceId: 'feed/1' } as Article, { ...starred }],
      selectedArticle: { ...starred },
      starredCount: 1,
    });
    vi.mocked(api.removeStarred).mockRejectedValue(
      Object.assign(new Error('refused'), { response: { status: 403 } }),
    );
  });

  afterEach(() => {
    vi.mocked(api.removeStarred).mockResolvedValue(undefined);
    useFeedStore.setState({ filter: 'all', starredCount: 0 });
  });

  // Retirer le favori depuis la vue Favoris SORT l'article de la liste — c'est
  // voulu. Mais le rollback ne faisait qu'un `.map()`, incapable de remettre un
  // élément déjà retiré : sur un refus du serveur, l'article disparaissait de
  // l'écran tout en restant en favori côté FreshRSS, et le compteur restauré
  // annonçait « 1 favori » au-dessus d'une liste qui n'en montrait aucun.
  it('remet l’article dans la liste, à sa place d’origine', async () => {
    await useFeedStore.getState().toggleStar({ ...starred });
    const { articles } = useFeedStore.getState();
    expect(articles.map((a) => a.id)).toEqual(['a0', 'a1']);
    expect(articles[1].starred).toBe(true);
  });

  it('remet l’article sélectionné', async () => {
    await useFeedStore.getState().toggleStar({ ...starred });
    expect(useFeedStore.getState().selectedArticle?.id).toBe('a1');
    expect(useFeedStore.getState().selectedArticle?.starred).toBe(true);
  });

  it('restaure le compteur de favoris', async () => {
    await useFeedStore.getState().toggleStar({ ...starred });
    expect(useFeedStore.getState().starredCount).toBe(1);
  });

  // La file d'actions est un état de MODULE : elle survit d'un test à l'autre
  // dans ce fichier. On vérifie donc ce qui vient d'être déposé, pas la taille
  // totale de la file — sans quoi le test dépendrait de ce qui l'a précédé.
  it('hors ligne, garde l’état optimiste et met l’action en file', async () => {
    vi.mocked(api.removeStarred).mockRejectedValue(new Error('network down'));
    await useFeedStore.getState().toggleStar({ ...starred });
    expect(useFeedStore.getState().articles.map((a) => a.id)).toEqual(['a0']);
    const queued = vi.mocked(offline.queuePut).mock.calls.at(-1)?.[0] ?? [];
    expect(queued).toContainEqual(
      expect.objectContaining({ articleId: 'a1', type: 'star', value: false }),
    );
  });
});
