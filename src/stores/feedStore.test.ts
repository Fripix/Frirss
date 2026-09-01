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

// Stub i18n so toast text is deterministic: t(key) → key. Mirrors dates.test.ts.
vi.mock('../i18n', () => ({
  default: { t: (k: string) => k },
}));

import { useFeedStore, pickPrefetchFeeds, isCategoryStreamId, resolveSearchStreamId, READ_LATER_LABEL } from './feedStore';
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
    revalidating: false,
  });
  useUiStore.setState({ toasts: [] });
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
  // Retirer le favori ne SORT PLUS l'article de la liste ; la vue se
  // réconcilie au rechargement. Le retrait venait du commit initial, sans
  // qu'aucune décision ne l'ait jamais établi.
  //
  // `toggleRead` retire désormais la ligne sous le filtre non-lus (issue #10),
  // sur un geste explicite et après confirmation du serveur. Les deux vues
  // divergent donc à nouveau — cette fois par décision, pas par accident.
  //
  // Ce n'est pas le seul site d'écriture qui retire : `toggleReadLater` sort
  // aussi la ligne de la vue « À lire plus tard ». Il le faisait de façon
  // OPTIMISTE, avant la réponse du serveur, avec le même rollback en `.map()`
  // incapable de la remettre — le défaut exact corrigé ici en 1.4.4. Corrigé
  // à son tour le 2026-09-01 (retrait après confirmation) ; son bloc de tests
  // est en fin de fichier.
  it('garde la ligne en place quand le retrait réussit', async () => {
    vi.mocked(api.removeStarred).mockResolvedValue(undefined);
    await useFeedStore.getState().toggleStar({ ...starred });
    const { articles } = useFeedStore.getState();
    expect(articles.map((a) => a.id)).toEqual(['a0', 'a1']);
    expect(articles[1].starred).toBe(false);
    expect(useFeedStore.getState().selectedArticle?.id).toBe('a1');
  });

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
    const { articles } = useFeedStore.getState();
    expect(articles.map((a) => a.id)).toEqual(['a0', 'a1']);
    expect(articles[1].starred).toBe(false); // l'état optimiste est conservé
    const queued = vi.mocked(offline.queuePut).mock.calls.at(-1)?.[0] ?? [];
    expect(queued).toContainEqual(
      expect.objectContaining({ articleId: 'a1', type: 'star', value: false }),
    );
  });
});

describe('feedStore — le cache hors-ligne suit toutes les écritures', () => {
  // `persistCurrentView` n'était appelé que par les deux chemins de LECTURE.
  // La liste rejouée hors ligne gardait donc l'ancien état du favori et de
  // « à lire plus tard » : mettre un favori puis recharger sans réseau le
  // montrait non favori.
  beforeEach(() => {
    useFeedStore.setState({
      filter: 'all',
      articles: [{ id: 'a1', read: false, starred: false, sourceId: 'feed/1', labels: [] as string[] } as Article],
      selectedArticle: null,
    });
  });

  it('persiste la vue après un favori', async () => {
    await useFeedStore.getState().toggleStar(useFeedStore.getState().articles[0]);
    expect(offline.listPut).toHaveBeenCalled();
    const stored = vi.mocked(offline.listPut).mock.calls.at(-1)?.[1] as Article[];
    expect(stored.find((a) => a.id === 'a1')?.starred).toBe(true);
  });

  it('persiste la vue après un « à lire plus tard »', async () => {
    await useFeedStore.getState().toggleReadLater(useFeedStore.getState().articles[0]);
    expect(offline.listPut).toHaveBeenCalled();
    const stored = vi.mocked(offline.listPut).mock.calls.at(-1)?.[1] as Article[];
    // Comparé à ce que le store porte, pas à un littéral : le libellé « à lire
    // plus tard » est une étiquette FreshRSS localisée, pas un état standard.
    const inStore = useFeedStore.getState().articles.find((a) => a.id === 'a1');
    expect(inStore?.labels?.length).toBe(1);
    expect(stored.find((a) => a.id === 'a1')?.labels).toEqual(inStore?.labels);
  });
});

describe('feedStore.replayQueue — réentrance', () => {
  // Le rejeu est déclenché au montage ET à chaque événement `online`
  // (`App.tsx`). Deux exécutions pouvaient donc se chevaucher, lire la même
  // file et se réécrire l'une l'autre : chaque action partait deux fois, et la
  // passe la plus lente pouvait ressusciter une action déjà traitée.
  beforeEach(() => {
    useFeedStore.setState({ articles: [], selectedArticle: null });
  });

  it('ne rejoue pas deux fois la même action quand deux passes se chevauchent', async () => {
    // Une action mise en file parce que le réseau manquait.
    vi.mocked(api.markAsRead).mockRejectedValue(new Error('network down'));
    await useFeedStore.getState().toggleRead({ id: 'r1', read: false, sourceId: 'feed/1' } as Article);

    // Un rejeu lent, pour que la seconde passe démarre pendant la première —
    // exactement deux événements `online` rapprochés.
    vi.mocked(api.markAsRead).mockReset();
    vi.mocked(api.markAsRead).mockImplementation(
      () => new Promise<void>((r) => setTimeout(r, 5)),
    );

    await Promise.all([
      useFeedStore.getState().replayQueue(),
      useFeedStore.getState().replayQueue(),
    ]);

    const forR1 = vi.mocked(api.markAsRead).mock.calls.filter((c) => c[0] === 'r1');
    expect(forR1).toHaveLength(1);
  });
});

describe('feedStore.toggleRead — retrait de la ligne sous le filtre non-lus', () => {
  const row = (id: string): Article =>
    ({ id, read: false, starred: false, sourceId: 'feed/1', title: id } as Article);

  beforeEach(() => {
    vi.mocked(api.markAsRead).mockReset();
    vi.mocked(api.markAsRead).mockResolvedValue(undefined);
    vi.mocked(api.markAsUnread).mockReset();
    vi.mocked(api.markAsUnread).mockResolvedValue(undefined);
    useFeedStore.setState({
      articles: [row('a0'), row('a1'), row('a2')],
      selectedArticle: null,
      filter: 'unread',
    });
  });

  it('retire la ligne une fois le serveur confirmé', async () => {
    await useFeedStore.getState().toggleRead(row('a1'));
    expect(useFeedStore.getState().articles.map((a) => a.id)).toEqual(['a0', 'a2']);
  });

  it('garde la ligne quand le serveur refuse', async () => {
    // Le rollback ne fait qu'un `.map()` : une ligne déjà retirée serait
    // irrécupérable, et l'article disparaîtrait de l'écran en restant non lu
    // côté FreshRSS. C'est le bug déjà payé sur `toggleStar`.
    vi.mocked(api.markAsRead).mockRejectedValueOnce({ response: { status: 403 } });
    await useFeedStore.getState().toggleRead(row('a1'));
    const s = useFeedStore.getState();
    expect(s.articles.map((a) => a.id)).toEqual(['a0', 'a1', 'a2']);
    expect(s.articles[1].read).toBe(false);
  });

  it('garde la ligne hors ligne, l’action étant seulement mise en file', async () => {
    vi.mocked(api.markAsRead).mockRejectedValueOnce(new Error('Network Error'));
    await useFeedStore.getState().toggleRead(row('a1'));
    const s = useFeedStore.getState();
    expect(s.articles.map((a) => a.id)).toEqual(['a0', 'a1', 'a2']);
    expect(s.articles[1].read).toBe(true);
  });

  it('ne retire rien hors du filtre non-lus', async () => {
    useFeedStore.setState({ filter: 'all' });
    await useFeedStore.getState().toggleRead(row('a1'));
    expect(useFeedStore.getState().articles.map((a) => a.id)).toEqual(['a0', 'a1', 'a2']);
  });

  it('ne retire rien pour une écriture implicite (marquage au défilement)', async () => {
    await useFeedStore.getState().toggleRead(row('a1'), { implicit: true });
    const s = useFeedStore.getState();
    expect(s.articles.map((a) => a.id)).toEqual(['a0', 'a1', 'a2']);
    expect(s.articles[1].read).toBe(true);
  });

  it('ne retire PAS la ligne d’un article simplement ouvert', async () => {
    // Le garde-fou central de cette fonctionnalité. `selectArticle` marque lu
    // sans passer par `toggleRead` : si l'implémentation se branchait sur
    // l'état « devenu lu » plutôt que sur le geste, la ligne de l'article
    // qu'on vient d'ouvrir disparaîtrait pendant qu'on le lit. Ce test doit
    // échouer dans ce cas.
    useFeedStore.getState().selectArticle(row('a1'));
    await new Promise((r) => setTimeout(r, 0));
    const s = useFeedStore.getState();
    expect(s.articles.map((a) => a.id)).toEqual(['a0', 'a1', 'a2']);
    expect(s.articles[1].read).toBe(true);
  });

  it('ne retire rien quand on remet un article en non-lu', async () => {
    useFeedStore.setState({ articles: [row('a0'), { ...row('a1'), read: true }, row('a2')] });
    await useFeedStore.getState().toggleRead({ ...row('a1'), read: true });
    expect(useFeedStore.getState().articles.map((a) => a.id)).toEqual(['a0', 'a1', 'a2']);
  });
});

describe('feedStore.toggleRead — la ligne de l’article ouvert ne part jamais', () => {
  const row = (id: string): Article =>
    ({ id, read: false, starred: false, sourceId: 'feed/1', title: id } as Article);

  beforeEach(() => {
    vi.mocked(api.markAsRead).mockReset();
    vi.mocked(api.markAsRead).mockResolvedValue(undefined);
    useFeedStore.setState({
      articles: [row('a0'), row('a1'), row('a2')],
      selectedArticle: { ...row('a1') },
      filter: 'unread',
    });
  });

  // Deux bascules depuis le volet de lecture (lu → non lu, puis non lu → lu)
  // atteignent une vraie transition non-lu → lu sur l'article OUVERT. Retirer
  // sa ligne le laisse à l'écran sans ligne : `selectNextArticle` ne le trouve
  // plus (`findIndex` → -1, puis `articles[0]`) et saute en tête de liste, et
  // le balayage suivant/précédent du mobile devient inerte. `silentRefresh`
  // entretient déjà l'invariant inverse : il RÉINSÈRE l'article en lecture.
  it('garde la ligne quand l’article marqué lu est celui qui est ouvert', async () => {
    await useFeedStore.getState().toggleRead(row('a1'));
    const s = useFeedStore.getState();
    expect(s.articles.map((a) => a.id)).toEqual(['a0', 'a1', 'a2']);
    expect(s.articles[1].read).toBe(true);
  });

  it('laisse suivant/précédent utilisables depuis l’article marqué lu', async () => {
    await useFeedStore.getState().toggleRead(row('a1'));
    useFeedStore.getState().selectNextArticle();
    expect(useFeedStore.getState().selectedArticle?.id).toBe('a2');
  });

  it('retire toujours la ligne d’un AUTRE article', async () => {
    await useFeedStore.getState().toggleRead(row('a2'));
    expect(useFeedStore.getState().articles.map((a) => a.id)).toEqual(['a0', 'a1']);
  });
});

describe('feedStore.toggleRead — le retrait survit au cache mémoire', () => {
  const feed1 = { id: 'feed/1', title: 'F1' } as unknown as Subscription;
  const feed2 = { id: 'feed/2', title: 'F2' } as unknown as Subscription;
  const item = (id: string) => ({ id, categories: [] });

  beforeEach(() => {
    vi.mocked(api.markAsRead).mockReset();
    vi.mocked(api.markAsRead).mockResolvedValue(undefined);
    vi.mocked(api.getStreamContents).mockReset();
    vi.mocked(api.getStreamContents).mockImplementation((streamId: string) =>
      Promise.resolve(
        (streamId === 'feed/1'
          ? { items: [item('a0'), item('a1'), item('a2')], continuation: null }
          : { items: [], continuation: null }) as never
      )
    );
    useFeedStore.setState({
      selectedFeed: feed1,
      filter: 'unread',
      articles: [],
      continuation: null,
      selectedArticle: null,
    });
  });

  // Le retrait mettait à jour `articles` et le cache hors-ligne, mais PAS le
  // cache mémoire des vues. Quitter la vue puis y revenir la repeignait depuis
  // ce cache — sans spinner, `loading` valant `!cached` — et la ligne marquée
  // lue réapparaissait dans la liste « Non lus ».
  it('ne repeint pas la ligne retirée en revenant sur la vue', async () => {
    await useFeedStore.getState().loadArticles();
    expect(useFeedStore.getState().articles.map((a) => a.id)).toEqual(['a0', 'a1', 'a2']);

    await useFeedStore.getState().toggleRead(useFeedStore.getState().articles[1]);
    expect(useFeedStore.getState().articles.map((a) => a.id)).toEqual(['a0', 'a2']);

    useFeedStore.getState().selectFeed(feed2);
    useFeedStore.getState().selectFeed(feed1);
    // Peinture immédiate depuis le cache mémoire, avant toute réponse serveur.
    expect(useFeedStore.getState().articles.map((a) => a.id)).toEqual(['a0', 'a2']);
  });
});

describe('feedStore.toggleReadLater — retrait de la ligne depuis la vue « À lire plus tard »', () => {
  const row = (id: string): Article =>
    ({ id, read: false, starred: false, sourceId: 'feed/1', labels: [READ_LATER_LABEL] } as Article);

  beforeEach(() => {
    vi.mocked(api.setArticleLabel).mockReset();
    vi.mocked(api.setArticleLabel).mockResolvedValue(undefined);
    useFeedStore.setState({
      filter: 'readlater',
      articles: [row('a1')],
      selectedArticle: null,
      readLaterCount: 1,
    });
  });

  afterEach(() => {
    useFeedStore.setState({ filter: 'all', readLaterCount: 0 });
  });

  it('retire la ligne une fois le serveur confirmé', async () => {
    await useFeedStore.getState().toggleReadLater(row('a1'));
    const s = useFeedStore.getState();
    expect(s.articles.map((a) => a.id)).toEqual([]);
    expect(s.readLaterCount).toBe(0);
  });

  // Le défaut corrigé : le retrait était OPTIMISTE, et le rollback n'est qu'un
  // `.map()` — incapable de remettre une ligne déjà partie. Sur un refus, on
  // finissait avec `articles: []` et `readLaterCount: 1` : un élément compté
  // au-dessus d'une liste vide. C'est le bug déjà payé sur `toggleStar` en 1.4.4.
  it('garde la ligne quand le serveur refuse', async () => {
    vi.mocked(api.setArticleLabel).mockRejectedValueOnce({ response: { status: 403 } });
    await useFeedStore.getState().toggleReadLater(row('a1'));
    const s = useFeedStore.getState();
    expect(s.articles.map((a) => a.id)).toEqual(['a1']);
    expect(s.articles[0].labels).toContain(READ_LATER_LABEL);
    expect(s.readLaterCount).toBe(1);
  });

  it('garde la ligne hors ligne, l’action étant seulement mise en file', async () => {
    vi.mocked(api.setArticleLabel).mockRejectedValueOnce(new Error('Network Error'));
    await useFeedStore.getState().toggleReadLater(row('a1'));
    const s = useFeedStore.getState();
    expect(s.articles.map((a) => a.id)).toEqual(['a1']);
    const queued = vi.mocked(offline.queuePut).mock.calls.at(-1)?.[0] ?? [];
    expect(queued).toContainEqual(
      expect.objectContaining({ articleId: 'a1', type: 'readLater', value: false }),
    );
  });

  it('ne retire rien hors de la vue « À lire plus tard »', async () => {
    useFeedStore.setState({ filter: 'all' });
    await useFeedStore.getState().toggleReadLater(row('a1'));
    expect(useFeedStore.getState().articles.map((a) => a.id)).toEqual(['a1']);
  });
});

describe('feedStore.toggleRead — la remise à niveau de la liste est bornée', () => {
  const row = (id: string): Article =>
    ({ id, read: false, starred: false, sourceId: 'feed/1', title: id } as Article);
  const item = (id: string) => ({ id, categories: [] });

  beforeEach(() => {
    vi.mocked(api.markAsRead).mockReset();
    vi.mocked(api.markAsRead).mockResolvedValue(undefined);
    vi.mocked(api.getStreamContents).mockReset();
    useFeedStore.setState({
      selectedFeed: null,
      filter: 'unread',
      articles: [row('a0'), row('a1')],
      continuation: 'page-2',
      selectedArticle: null,
      loadingMore: false,
    });
  });

  afterEach(() => {
    useFeedStore.setState({ filter: 'all', continuation: null, loadingMore: false });
  });

  // Sans cela, dépiler par le haut laisse une liste plus courte que la fenêtre :
  // plus rien ne défile, aucun `scroll` n'est émis, la pagination s'arrête et
  // l'utilisateur croit être au bout alors que `continuation` promet la suite.
  it('demande une page quand le retrait laisse la liste trop courte', async () => {
    vi.mocked(api.getStreamContents).mockResolvedValue(
      { items: [item('b0'), item('b1')], continuation: 'page-3' } as never
    );
    await useFeedStore.getState().toggleRead(row('a1'));
    expect(api.getStreamContents).toHaveBeenCalledTimes(1);
    expect(useFeedStore.getState().articles.map((a) => a.id)).toEqual(['a0', 'b0', 'b1']);
  });

  // La tempête d'échecs mesurée sur l'effet retiré : le `catch` de `loadMore`
  // remet `loadingMore` à `false` en gardant `continuation`, ce qui relançait
  // l'effet, qui rappelait `loadMore` — 51 appels et plus. Un échec doit
  // simplement s'arrêter.
  it('n’en redemande pas quand la page échoue', async () => {
    vi.mocked(api.getStreamContents).mockRejectedValue(new Error('boom'));
    await useFeedStore.getState().toggleRead(row('a1'));
    expect(api.getStreamContents).toHaveBeenCalledTimes(1);
    expect(useFeedStore.getState().loadingMore).toBe(false);
    expect(useFeedStore.getState().continuation).toBe('page-2');
  });

  // Le vidage complet du flux : une page peut ne rendre AUCUNE ligne (les
  // favoris d'un flux sont filtrés côté client) tout en gardant une
  // continuation. L'effet repaginait alors jusqu'à épuiser le flux.
  it('n’enchaîne pas quand la page reçue ne rend aucune ligne', async () => {
    vi.mocked(api.getStreamContents).mockResolvedValue(
      { items: [], continuation: 'page-3' } as never
    );
    await useFeedStore.getState().toggleRead(row('a1'));
    expect(api.getStreamContents).toHaveBeenCalledTimes(1);
  });

  it('ne demande rien quand le flux est épuisé', async () => {
    useFeedStore.setState({ continuation: null });
    await useFeedStore.getState().toggleRead(row('a1'));
    expect(api.getStreamContents).not.toHaveBeenCalled();
  });

  it('ne demande rien quand la liste reste fournie', async () => {
    const many = Array.from({ length: 30 }, (_, i) => row(`a${i}`));
    useFeedStore.setState({ articles: many });
    await useFeedStore.getState().toggleRead(row('a5'));
    expect(api.getStreamContents).not.toHaveBeenCalled();
  });

  it('ne demande rien quand une page est déjà en vol', async () => {
    useFeedStore.setState({ loadingMore: true });
    await useFeedStore.getState().toggleRead(row('a1'));
    expect(api.getStreamContents).not.toHaveBeenCalled();
  });

  it('ne demande rien quand le serveur refuse le marquage', async () => {
    vi.mocked(api.markAsRead).mockRejectedValueOnce({ response: { status: 403 } });
    await useFeedStore.getState().toggleRead(row('a1'));
    expect(api.getStreamContents).not.toHaveBeenCalled();
    expect(useFeedStore.getState().articles.map((a) => a.id)).toEqual(['a0', 'a1']);
  });
});

describe('feedStore.toggleRead — la remise à niveau se tait pendant une recherche', () => {
  const row = (id: string): Article =>
    ({ id, read: false, starred: false, sourceId: 'feed/1', title: id } as Article);
  const item = (id: string) => ({ id, categories: [] });

  beforeEach(() => {
    vi.mocked(api.markAsRead).mockReset();
    vi.mocked(api.markAsRead).mockResolvedValue(undefined);
    vi.mocked(api.getStreamContents).mockReset();
    vi.mocked(api.getStreamContents).mockResolvedValue(
      { items: [item('intrus1'), item('intrus2')], continuation: 'page-3' } as never
    );
    useFeedStore.setState({
      selectedFeed: null,
      filter: 'unread',
      searchQuery: 'zustand',
      articles: [row('r0'), row('r1')],
      continuation: 'page-2',
      selectedArticle: null,
      loadingMore: false,
    });
  });

  afterEach(() => {
    useFeedStore.setState({ filter: 'all', searchQuery: '', continuation: null, loadingMore: false });
  });

  // `shouldLeaveList` ne regarde que le filtre, qui reste « unread » pendant
  // une recherche : le ✓ retire donc bien sa ligne. Mais `loadMore` ignore
  // `searchQuery` et rapporte le flux nu — la remise à niveau injectait des
  // articles étrangers à la requête au milieu des résultats.
  it('retire la ligne sans aller chercher la page suivante', async () => {
    await useFeedStore.getState().toggleRead(row('r1'));
    expect(api.getStreamContents).not.toHaveBeenCalled();
    expect(useFeedStore.getState().articles.map((a) => a.id)).toEqual(['r0']);
  });
});

describe('feedStore.toggleReadLater — le retrait survit au cache mémoire', () => {
  const feedA = { id: 'feed/rl-a', title: 'A' } as unknown as Subscription;
  const feedB = { id: 'feed/rl-b', title: 'B' } as unknown as Subscription;
  const item = (id: string) => ({ id, categories: [READ_LATER_LABEL] });

  beforeEach(() => {
    vi.mocked(api.setArticleLabel).mockReset();
    vi.mocked(api.setArticleLabel).mockResolvedValue(undefined);
    vi.mocked(api.getStreamContents).mockReset();
    vi.mocked(api.getStreamContents).mockImplementation((streamId: string) =>
      Promise.resolve(
        (streamId === READ_LATER_LABEL
          ? { items: [item('l0'), item('l1')], continuation: null }
          : { items: [], continuation: null }) as never
      )
    );
    useFeedStore.setState({
      selectedFeed: null,
      filter: 'readlater',
      articles: [],
      continuation: null,
      selectedArticle: null,
      readLaterCount: 2,
    });
  });

  afterEach(() => {
    useFeedStore.setState({ filter: 'all', selectedFeed: null, readLaterCount: 0 });
  });

  // Exactement le défaut que `memRemoveFromUnreadViews` avait corrigé pour
  // `toggleRead`, laissé en l'état sur son jumeau : quitter « À lire plus
  // tard » puis y revenir repeignait la ligne retirée depuis `memGet`.
  it('ne repeint pas la ligne retirée en revenant sur la vue', async () => {
    await useFeedStore.getState().loadArticles();
    expect(useFeedStore.getState().articles.map((a) => a.id)).toEqual(['l0', 'l1']);

    await useFeedStore.getState().toggleReadLater(useFeedStore.getState().articles[0]);
    expect(useFeedStore.getState().articles.map((a) => a.id)).toEqual(['l1']);

    useFeedStore.getState().selectFeed(feedA);
    useFeedStore.setState({ filter: 'readlater' });
    useFeedStore.getState().selectFeed(feedB);
    useFeedStore.getState().selectView(null, 'readlater');
    // Peinture immédiate depuis le cache mémoire, avant toute réponse serveur.
    expect(useFeedStore.getState().articles.map((a) => a.id)).toEqual(['l1']);
  });
});

describe('feedStore.loadMore — échec réseau/serveur', () => {
  const row = (id: string): Article =>
    ({ id, read: false, starred: false, sourceId: 'feed/1', title: id } as Article);

  beforeEach(() => {
    vi.mocked(api.getStreamContents).mockReset();
    useFeedStore.setState({
      selectedFeed: null,
      filter: 'all',
      articles: [row('a0')],
      continuation: 'page-2',
      selectedArticle: null,
      loadingMore: false,
      revalidating: false,
    });
  });

  afterEach(() => {
    useFeedStore.setState({ continuation: null, loadingMore: false, revalidating: false });
  });

  // Le `catch` ne faisait que remettre `loadingMore` à faux : sur un 502 le
  // bouton affichait « Chargement… » le temps de l'aller-retour puis
  // reprenait son état de départ, sans un mot nulle part. Réutilise le
  // mécanisme de toast existant et un message d'erreur déjà traduit plutôt
  // que d'en inventer un nouveau.
  it('signale l’échec par un toast au lieu de se taire', async () => {
    vi.mocked(api.getStreamContents).mockRejectedValue(new Error('502'));
    await useFeedStore.getState().loadMore();
    expect(useFeedStore.getState().loadingMore).toBe(false);
    // `continuation` reste en place : l'utilisateur peut retenter le clic.
    expect(useFeedStore.getState().continuation).toBe('page-2');
    const [toast] = useUiStore.getState().toasts;
    expect(toast).toMatchObject({ message: 'sidebar.loadError', tone: 'error' });
  });
});

describe('feedStore.loadMore — page qui n’ajoute aucune ligne visible', () => {
  const feed1 = { id: 'feed/1', title: 'F1' } as unknown as Subscription;

  beforeEach(() => {
    vi.mocked(api.getStreamContents).mockReset();
    useFeedStore.setState({
      selectedFeed: feed1,
      filter: 'starred',
      articles: [],
      continuation: 'page-2',
      selectedArticle: null,
      loadingMore: false,
      revalidating: false,
    });
  });

  afterEach(() => {
    useFeedStore.setState({ selectedFeed: null, filter: 'all', continuation: null, loadingMore: false, revalidating: false });
  });

  // Les favoris d'un flux sont filtrés CÔTÉ CLIENT (voir `feedStore`) : une
  // page de 50 articles peut légitimement n'en rendre AUCUN. Sur un flux de
  // 500 articles dont l'unique favori se trouve vers la position 480, dix
  // clics d'affilée repeignaient le même écran vide sans un mot.
  it('signale un clic sans effet visible, tant qu’il reste une page', async () => {
    vi.mocked(api.getStreamContents).mockResolvedValue(
      { items: [], continuation: 'page-3' } as never
    );
    await useFeedStore.getState().loadMore();
    const [toast] = useUiStore.getState().toasts;
    expect(toast).toMatchObject({ message: 'toast.loadMoreEmpty' });
    expect(toast.tone).not.toBe('error');
  });

  it('se tait quand la page ajoute des lignes visibles', async () => {
    // `filter: 'starred'` + `selectedFeed` filtre côté client sur ce tag :
    // sans lui l'article n'aurait jamais passé le filtre, faussant le test.
    vi.mocked(api.getStreamContents).mockResolvedValue(
      { items: [{ id: 'b0', categories: ['user/-/state/com.google/starred'] }], continuation: 'page-3' } as never
    );
    await useFeedStore.getState().loadMore();
    expect(useUiStore.getState().toasts).toEqual([]);
  });

  it('se tait quand le flux est épuisé : l’état vide définitif le dit déjà', async () => {
    vi.mocked(api.getStreamContents).mockResolvedValue(
      { items: [], continuation: null } as never
    );
    await useFeedStore.getState().loadMore();
    expect(useUiStore.getState().toasts).toEqual([]);
  });
});

describe('feedStore — le clic sur « charger la suite » pendant la revalidation d’une vue en cache', () => {
  const feed1 = { id: 'feed/1', title: 'F1' } as unknown as Subscription;
  const item = (id: string) => ({ id, categories: [] });

  beforeEach(() => {
    vi.mocked(api.getStreamContents).mockReset();
    useFeedStore.setState({
      selectedFeed: feed1,
      filter: 'unread',
      articles: [],
      continuation: null,
      selectedArticle: null,
      loadingMore: false,
      revalidating: false,
    });
  });

  afterEach(() => {
    useFeedStore.setState({ selectedFeed: null, filter: 'all', continuation: null, loadingMore: false, revalidating: false });
  });

  // Le cache mémoire peint une vue déjà visitée instantanément — `loading`
  // reste faux, aucun squelette — pendant que `loadArticles` revalide encore
  // en tâche de fond. Rien d'autre ne le disait avant `revalidating`.
  it('revalide en tâche de fond après un hit du cache mémoire, sans lever le squelette', async () => {
    vi.mocked(api.getStreamContents).mockResolvedValue(
      { items: [item('a0')], continuation: null } as never
    );
    await useFeedStore.getState().loadArticles(); // peuple le cache mémoire
    expect(useFeedStore.getState().revalidating).toBe(false);

    let resolveLive!: (v: unknown) => void;
    vi.mocked(api.getStreamContents).mockReturnValueOnce(
      new Promise((resolve) => { resolveLive = resolve; }) as never
    );
    const p = useFeedStore.getState().loadArticles(); // deuxième visite : hit de cache
    expect(useFeedStore.getState().loading).toBe(false);
    expect(useFeedStore.getState().revalidating).toBe(true);

    resolveLive({ items: [item('a0')], continuation: null });
    await p;
    expect(useFeedStore.getState().revalidating).toBe(false);
  });

  // Le cœur de la course : cliquer dans cette fenêtre lançait `loadMore` en
  // même temps que la revalidation, qui gagne presque toujours et écrase la
  // page ajoutée en réinitialisant `continuation` — le travail du clic est
  // jeté sans un mot.
  it('ignore un clic sur « charger la suite » pendant la revalidation', async () => {
    vi.mocked(api.getStreamContents).mockResolvedValue(
      { items: [item('a0')], continuation: 'page-2' } as never
    );
    await useFeedStore.getState().loadArticles();

    let resolveLive!: (v: unknown) => void;
    vi.mocked(api.getStreamContents).mockReturnValueOnce(
      new Promise((resolve) => { resolveLive = resolve; }) as never
    );
    const p = useFeedStore.getState().loadArticles();
    expect(useFeedStore.getState().revalidating).toBe(true);

    vi.mocked(api.getStreamContents).mockClear();
    await useFeedStore.getState().loadMore();
    expect(api.getStreamContents).not.toHaveBeenCalled();
    expect(useFeedStore.getState().continuation).toBe('page-2');
    expect(useFeedStore.getState().loadingMore).toBe(false);

    resolveLive({ items: [item('a0')], continuation: 'page-2' });
    await p;
  });
});
