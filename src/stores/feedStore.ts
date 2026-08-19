import { create } from 'zustand';
import {
  getSubscriptionList,
  getUnreadCounts,
  getStreamContents,
  getStarredItems,
  markAsRead,
  markAsUnread,
  markAsStarred,
  removeStarred,
  markAllAsRead,
  searchItems,
  subscribeFeed,
  editFeed,
  unsubscribeFeed,
  getTagList,
  getStreamItemCount,
  setArticleLabel,
  renameTag,
  deleteTag,
  clearWriteToken,
} from '../api/feeds';
import { useAuthStore } from './authStore';
import { useUiStore } from './uiStore';
import { peekExtract, getExtract, putExtract, pinExtract } from '../lib/extractCache';
import { listGet, listPut, listEvictOlderThan, subsGet, subsPut } from '../lib/offlineStore';
import { computeRefreshDelta } from '../lib/refreshDelta';
import { collectImageUrls, imageBudget, prioritizeForOffline } from '../lib/offlineImages';
import { getStorageEstimate } from '../lib/storageEstimate';
import { cacheImages } from '../lib/imageCache';
import type {
  Article,
  Subscription,
  FeedCategory,
  Tag,
  Filter,
  GReaderItem,
  GReaderStream,
} from '../types';

export const READ_LATER_LABEL = 'user/-/label/À lire plus tard';

// Default page size for article streams.
// Smaller pages load far faster (FreshRSS returns full content per item);
// infinite scroll fetches more on demand.
const PAGE_SIZE = 50;

// ── Shared stream resolver ──────────────────────────────────────────
// All three loaders (initial, load-more, silent refresh) resolve the
// right FreshRSS stream the same way; this keeps that logic in one place.
async function fetchArticleStream(
  filter: Filter,
  selectedFeed: Subscription | null,
  count: number,
  continuation: string | null,
  cacheOnly = false
): Promise<GReaderStream | null> {
  // Global starred — dedicated API
  if (filter === 'starred' && !selectedFeed) {
    return getStarredItems(count, continuation, cacheOnly);
  }
  // Read Later — label stream
  if (filter === 'readlater') {
    return getStreamContents(READ_LATER_LABEL, count, continuation, null, { cacheOnly });
  }
  // Specific feed or the global reading-list
  const streamId = selectedFeed
    ? selectedFeed.id
    : 'user/-/state/com.google/reading-list';
  // Server-side filtering: exclude read items when showing unread only
  const excludeTag = filter === 'unread' ? 'user/-/state/com.google/read' : null;
  const result = await getStreamContents(streamId, count, continuation, excludeTag, { cacheOnly });
  if (result == null) return null; // cache miss (cacheOnly)
  // Starred within a specific feed — filter client-side
  if (filter === 'starred' && selectedFeed) {
    result.items = result.items.filter((item) =>
      item.categories?.some((c) => c.endsWith('/state/com.google/starred'))
    );
  }
  return result;
}

// ── Client-side memory cache ─────────────────────────────────────────
// Keeps recently-opened views in memory so switching back is instant (0 ms,
// no round-trip, no empty flash). Revalidated live on every load. Bounded
// (LRU-ish) and cleared on server switch / logout.
interface CachedView {
  articles: Article[];
  continuation: string | null;
}
const MEM_CACHE_MAX = 60; // room for prefetched feed views alongside active ones
const memCache = new Map<string, CachedView>();
const viewKey = (feed: Subscription | null, filter: Filter) => `${feed?.id || ''}:${filter}`;

// A category is opened as its Google Reader label stream (user/-/label/Name).
// When such a stream is the selected "feed", the view aggregates every feed in
// the category — so the article list should behave like the multi-source
// "all feeds" view (show per-article source), not a single feed.
export const isCategoryStreamId = (id?: string | null): boolean =>
  !!id && id.startsWith('user/-/label/');

const STARRED_STREAM = 'user/-/state/com.google/starred';
const READING_LIST_STREAM = 'user/-/state/com.google/reading-list';

// The Google Reader stream a search should be scoped to, matching the current
// view: the selected feed/category, else the active filter's stream, else the
// whole reading-list (the "all feeds" view — search everywhere).
export function resolveSearchStreamId(selectedFeed: Subscription | null, filter: Filter): string {
  if (filter === 'readlater') return READ_LATER_LABEL;
  if (filter === 'starred' && !selectedFeed) return STARRED_STREAM;
  if (selectedFeed) return selectedFeed.id;
  return READING_LIST_STREAM;
}
function memGet(key: string): CachedView | undefined {
  return memCache.get(key);
}
function memSet(key: string, data: CachedView): void {
  memCache.delete(key);
  memCache.set(key, data);
  if (memCache.size > MEM_CACHE_MAX) {
    const oldest = memCache.keys().next().value;
    if (oldest !== undefined) memCache.delete(oldest);
  }
}
// A recent article URL for a feed, from any cached view — used to resolve a
// feed's real website when its htmlUrl is unusable (see feedSiteUrl / "Open
// site"). Feeds with unread items are prefetched at startup, so this is usually
// populated by the time the user opens a feed's menu.
export function getSampleArticleUrl(feedId: string): string | undefined {
  for (const view of memCache.values()) {
    for (const a of view.articles) {
      if (a.sourceId === feedId && a.url) return a.url;
    }
  }
  return undefined;
}
// Reflect a read/unread change in EVERY cached view, so coming back to any of
// them (from the memory cache) shows the current state instead of the stale
// list captured at load time.
function memMarkRead(articleId: string, read: boolean): void {
  for (const [key, view] of memCache) {
    let changed = false;
    const articles = view.articles.map((a) => {
      if (a.id === articleId && a.read !== read) { changed = true; return { ...a, read }; }
      return a;
    });
    if (changed) memCache.set(key, { ...view, articles });
  }
}
// Re-persist the current view's list to the offline store after an optimistic
// read change, so an offline return to it reflects the latest state.
function persistCurrentView(get: () => FeedState): void {
  const s = get();
  listPut(viewKey(s.selectedFeed, s.filter), s.articles, s.continuation).catch(() => {});
}

// Feeds we just confirmed as fully read (0 unread), kept for a short grace
// window: FreshRSS's own unread-count is eventually consistent, so without this
// the 60s server-count poll (or a subscription refresh) would briefly re-show a
// phantom "1 unread" before it catches up. feedId → expiry timestamp.
const zeroUnreadFloor = new Map<string, number>();
const ZERO_FLOOR_MS = 30_000;
function setZeroFloor(feedId: string, on: boolean): void {
  if (on) zeroUnreadFloor.set(feedId, Date.now() + ZERO_FLOOR_MS);
  else zeroUnreadFloor.delete(feedId);
}
// Force still-in-window feeds to 0 (server count is lagging) and drop expired
// entries. Applied wherever server unread counts overwrite the local ones.
function applyZeroFloor(counts: Record<string, number>): Record<string, number> {
  const now = Date.now();
  for (const [feedId, until] of zeroUnreadFloor) {
    if (until <= now) zeroUnreadFloor.delete(feedId);
    else counts[feedId] = 0;
  }
  return counts;
}
function memClear(): void {
  memCache.clear();
}

// Background-extract the auto-extract articles of a freshly loaded view so the
// WHOLE page is available offline (not only the ones the user opened).
// Sequential + delayed (doesn't compete with rendering), skips already-cached,
// writes through to the persistent cache. A token cancels stale runs when the
// user switches views, to avoid piling up dozens of parallel fetches.
let warmToken = 0;
async function warmExtracts(articles: Article[]): Promise<void> {
  const token = ++warmToken;
  const fs = useUiStore.getState().feedSettings;
  const targets = articles.filter((a) => a.url && fs[a.sourceId]?.autoExtract);
  if (!targets.length) return;
  await new Promise((r) => setTimeout(r, 2000)); // let the view settle first
  if (token !== warmToken) return;
  const { extractFullContent } = await import('../utils/extractContent');
  for (const a of targets) {
    if (token !== warmToken) return; // a newer view started warming
    if (peekExtract(a.id) || (await getExtract(a.id))) continue;
    try {
      await putExtract(a.id, await extractFullContent(a.url!));
    } catch { /* ignore */ }
  }
}

// ── First-page prefetch ─────────────────────────────────────────────
// Warm a feed's default view into the memory cache so opening it is instant.
// Bounded (only unread feeds, capped) so it stays cheap even with 500+ feeds.
const PREFETCH_CAP = 40;
const prefetchInFlight = new Set<string>();
let warmListsToken = 0;

// Which feeds to prefetch: those with unread, most-unread first, capped.
// Exported for testing.
export function pickPrefetchFeeds(
  subs: Subscription[],
  counts: Record<string, number>,
  cap = PREFETCH_CAP,
): Subscription[] {
  return subs
    .filter((f) => (counts[f.id] || 0) > 0)
    .sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0))
    .slice(0, cap);
}

// Skip background prefetch on data-saver / very slow connections (PWA/mobile).
function connectionTooSlow(): boolean {
  const c = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !!c && (c.saveData === true || c.effectiveType === 'slow-2g' || c.effectiveType === '2g');
}

/**
 * Image URLs worth caching for one article: the RSS thumbnail first (it is what
 * the list and the grid render), then body images from the extracted content.
 */
function articleImageUrls(rssHtml: string, extractedHtml: string | null, perArticle: number): string[] {
  if (perArticle <= 0) return [];
  const thumb = collectImageUrls(rssHtml, 1);
  if (perArticle === 1) return thumb;
  const body = collectImageUrls(extractedHtml || rssHtml, perArticle);
  return Array.from(new Set([...thumb, ...body])).slice(0, perArticle);
}

export interface FeedState {
  subscriptions: Subscription[];
  unreadCounts: Record<string, number>;
  articles: Article[];
  continuation: string | null;
  selectedFeed: Subscription | null;
  selectedArticle: Article | null;
  filter: Filter;
  loading: boolean;
  loadingMore: boolean;
  searchQuery: string;
  labels: Tag[];
  labelCounts: Record<string, number>;
  categoryIds: string[];
  starredCount: number;
  readLaterCount: number;
  feedErrors: Record<string, number>;
  // True while the initial subscriptions load is in flight — drives the thin
  // top progress bar so the user sees the app is revalidating (esp. after a
  // service-worker update reload, when every in-memory cache is cold).
  syncing: boolean;

  offlinePrep: {
    running: boolean;
    phase: 'lists' | 'articles' | 'done';
    done: number;
    total: number;
    /** Image URLs the sweep found, and how many it actually stored. */
    imagesFound?: number;
    imagesStored?: number;
    /** True when the budget guard cut image caching short. */
    budgetStopped?: boolean;
    /** Images that could not be fetched — a minority always fails. */
    imagesFailed?: number;
    /** First error met while caching images — a silent 0 is undiagnosable. */
    imagesError?: string;
  } | null;
  setFilter: (filter: Filter) => void;
  setUnreadFilter: (on: boolean) => void;
  loadLabelCounts: () => Promise<void>;
  warmOfflineCache: () => Promise<void>;
  prepareOffline: () => Promise<void>;
  prefetchView: (feed: Subscription) => Promise<void>;
  warmFeedLists: () => Promise<void>;
  selectFeed: (feed: Subscription | null) => void;
  selectView: (feed: Subscription | null, filter?: Filter) => void;
  selectCategory: (cat: FeedCategory) => void;
  selectArticle: (article: Article | null) => void;
  loadSubscriptions: () => Promise<void>;
  loadSpecialCounts: () => Promise<void>;
  loadArticles: () => Promise<void>;
  loadMore: () => Promise<void>;
  toggleRead: (article: Article) => Promise<void>;
  toggleStar: (article: Article) => Promise<void>;
  search: (query: string) => Promise<void>;
  clearSearch: () => void;
  markAllAsRead: () => Promise<void>;
  loadLabels: () => Promise<void>;
  toggleReadLater: (article: Article) => Promise<void>;
  toggleArticleLabel: (article: Article, labelId: string) => Promise<void>;
  renameLabel: (oldLabelId: string, newName: string) => Promise<boolean>;
  deleteLabel: (labelId: string) => Promise<boolean>;
  renameFeed: (feedId: string, newTitle: string) => Promise<boolean>;
  addFeed: (feedUrl: string, title?: string, categoryId?: string, categoryLabel?: string) => Promise<boolean>;
  removeFeed: (feedId: string) => Promise<boolean>;
  selectNextArticle: () => void;
  selectPrevArticle: () => void;
  syncCounts: () => Promise<void>;
  silentRefresh: () => Promise<void>;
  refresh: () => Promise<void>;
  resetAndReload: () => void;
  // Feedback after a manual refresh: how many new articles arrived and where.
  // Drives the "X new articles" banner + the per-feed pulse; cleared after a
  // few seconds by the banner.
  refreshResult: { totalNew: number; newByFeed: Record<string, number>; at: number } | null;
  clearRefreshResult: () => void;
}

export const useFeedStore = create<FeedState>()((set, get) => ({
  subscriptions: [],
  unreadCounts: {},
  articles: [],
  continuation: null,
  selectedFeed: null,
  selectedArticle: null,
  // Honour the persisted per-feed "unread only" preference for the startup
  // (landing / "all feeds") view.
  filter: useUiStore.getState().unreadOnlyByFeed[''] ? 'unread' : 'all',
  loading: false,
  loadingMore: false,
  refreshResult: null,
  searchQuery: '',
  labels: [],
  labelCounts: {},
  categoryIds: [],
  starredCount: 0,
  readLaterCount: 0,
  offlinePrep: null,
  syncing: false,
  feedErrors: {}, // { [feedId]: timestamp } — tracks feeds that errored on load

  setFilter: (filter) => {
    const c = memGet(viewKey(get().selectedFeed, filter));
    set({ filter, articles: c?.articles || [], continuation: c?.continuation || null, selectedArticle: null });
    get().loadArticles();
  },

  // Toggle the "unread only" reading mode for the CURRENT feed/label only:
  // persist the per-feed preference (synced, survives reloads) then apply it.
  setUnreadFilter: (on) => {
    const key = get().selectedFeed?.id ?? '';
    useUiStore.getState().setFeedUnreadOnly(key, on);
    get().setFilter(on ? 'unread' : 'all');
  },

  selectFeed: (feed) => {
    const c = memGet(viewKey(feed, get().filter));
    set({ selectedFeed: feed, articles: c?.articles || [], continuation: c?.continuation || null, selectedArticle: null });
    get().loadArticles();
  },

  // Combined action: set feed + filter in one go, single loadArticles call.
  // When no filter is given (feed/label navigation), fall back to that feed's
  // own persisted "unread only" preference instead of always showing everything.
  selectView: (feed, filter) => {
    const f = filter ?? (useUiStore.getState().unreadOnlyByFeed[feed?.id ?? ''] ? 'unread' : 'all');
    const c = memGet(viewKey(feed ?? null, f));
    set({ selectedFeed: feed ?? null, filter: f, articles: c?.articles || [], continuation: c?.continuation || null, selectedArticle: null });
    get().loadArticles();
  },

  // Open a whole category: its Google Reader label stream aggregates every feed
  // in the category server-side. Modelled as a synthetic "feed" (id = the label
  // stream, title = the category name) so the existing view machinery — paging,
  // caching, unread filter, "mark all read" — works unchanged.
  selectCategory: (cat) => {
    get().selectView({ id: cat.id, title: cat.label ?? cat.id } as Subscription);
  },

  selectArticle: (article) => {
    if (!article || article.read) {
      set({ selectedArticle: article });
      return;
    }
    // Optimistic update — mark read instantly in the UI, sync in the background.
    set((state) => ({
      selectedArticle: { ...article, read: true },
      articles: state.articles.map((a) =>
        a.id === article.id ? { ...a, read: true } : a
      ),
      unreadCounts: updateCount(state.unreadCounts, article, -1),
    }));
    memMarkRead(article.id, true);
    persistCurrentView(get);
    // Fire-and-forget; revert if the server call fails.
    markAsRead(article.id).catch(() => {
      set((state) => ({
        articles: state.articles.map((a) =>
          a.id === article.id ? { ...a, read: false } : a
        ),
        selectedArticle:
          state.selectedArticle?.id === article.id
            ? { ...state.selectedArticle, read: false }
            : state.selectedArticle,
        unreadCounts: updateCount(state.unreadCounts, article, 1),
      }));
      memMarkRead(article.id, false);
      persistCurrentView(get);
    });
  },

  loadSubscriptions: async () => {
    // Instant paint from the offline snapshot (structure only; counts arrive
    // with the live load) so the sidebar isn't blank while FreshRSS responds —
    // stale-while-revalidate. Guarded so it never clobbers already-loaded data.
    if (get().subscriptions.length === 0) {
      subsGet()
        .then((snap) => {
          if (snap?.length && get().subscriptions.length === 0) {
            set({ subscriptions: snap });
          }
        })
        .catch(() => {});
    }
    set({ syncing: true });
    try {
      const [subs, counts] = await Promise.all([
        getSubscriptionList(),
        getUnreadCounts(),
      ]);
      const serverUrl = useAuthStore.getState().serverUrl.replace(/\/$/, '');
      // Normalize favicon URLs — FreshRSS often returns internal Docker IPs
      // (e.g. http://10.0.0.10/f.php?h=abc) instead of the public URL.
      // We extract the path+query and prepend the user's serverUrl.
      const normalizedSubs = subs.map((sub) => {
        let iconUrl = sub.iconUrl;
        if (iconUrl) {
          try {
            const parsed = new URL(iconUrl, serverUrl);
            // Rewrite to use the public server URL (keeps path + query)
            iconUrl = `${serverUrl}${parsed.pathname}${parsed.search}`;
          } catch {
            // If URL parsing fails, try simple prepend for relative paths
            if (!iconUrl.startsWith('http')) {
              iconUrl = `${serverUrl}${iconUrl.startsWith('/') ? '' : '/'}${iconUrl}`;
            }
          }
        }
        return { ...sub, iconUrl };
      });
      const countMap: Record<string, number> = {};
      counts.forEach((c) => {
        countMap[c.id] = c.count;
      });
      // Collect category IDs (to distinguish from user labels)
      const catIds: string[] = [];
      normalizedSubs.forEach((sub) => {
        sub.categories?.forEach((c) => {
          if (c.id && !catIds.includes(c.id)) catIds.push(c.id);
        });
      });
      set({
        subscriptions: normalizedSubs,
        unreadCounts: applyZeroFloor(countMap),
        categoryIds: catIds,
      });
      subsPut(normalizedSubs).catch(() => {}); // persist for offline
      // Auto-load user labels now that we know categories
      get().loadLabels();
      // Load starred & read-later counts in background
      get().loadSpecialCounts();
    } catch {
      // Offline fallback: persisted subscriptions so the sidebar still works.
      const persisted = await subsGet();
      if (persisted && persisted.length) {
        const catIds: string[] = [];
        persisted.forEach((sub) => {
          sub.categories?.forEach((c) => {
            if (c.id && !catIds.includes(c.id)) catIds.push(c.id);
          });
        });
        set({ subscriptions: persisted, categoryIds: catIds });
        get().loadLabels();
      }
    } finally {
      set({ syncing: false });
    }
  },

  loadSpecialCounts: async () => {
    try {
      const empty: GReaderStream = { items: [], continuation: null };
      const [starred, readLater] = await Promise.all([
        getStarredItems(200).catch(() => empty),
        getStreamContents(READ_LATER_LABEL, 200, null).catch(() => empty),
      ]);
      set({
        starredCount: starred?.items.length ?? 0,
        readLaterCount: readLater?.items.length ?? 0,
      });
    } catch { /* ignore */ }
  },

  // Warm one feed's default view (first page) into the memory cache, so opening
  // it is instant. Skips already-cached / in-flight keys; discarded if the
  // server switches. Used both by the background sweep and on hover/touch.
  prefetchView: async (feed) => {
    if (!feed?.id) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const filter: Filter = useUiStore.getState().unreadOnlyByFeed[feed.id] ? 'unread' : 'all';
    const key = viewKey(feed, filter);
    if (memGet(key) || prefetchInFlight.has(key)) return;
    prefetchInFlight.add(key);
    const serverId = useAuthStore.getState().activeServerId;
    try {
      const result = await fetchArticleStream(filter, feed, PAGE_SIZE, null);
      if (result && useAuthStore.getState().activeServerId === serverId && !memGet(key)) {
        memSet(key, { articles: result.items.map(normalizeArticle), continuation: result.continuation });
      }
    } catch { /* best-effort */ } finally {
      prefetchInFlight.delete(key);
    }
  },

  // Background sweep: after the initial load, prefetch the first page of the
  // unread feeds (capped, throttled, connection-gated) so clicking any of them
  // is instant. Cheap by construction — bounded work, cancellable on switch.
  warmFeedLists: async () => {
    if (typeof navigator !== 'undefined' && (navigator.onLine === false || connectionTooSlow())) return;
    const token = ++warmListsToken;
    const feeds = pickPrefetchFeeds(get().subscriptions, get().unreadCounts);
    if (!feeds.length) return;
    let i = 0;
    const worker = async () => {
      while (i < feeds.length) {
        if (token !== warmListsToken) return; // superseded (new sweep / server switch)
        await get().prefetchView(feeds[i++]);
        await new Promise((r) => setTimeout(r, 150)); // gentle pacing
      }
    };
    await Promise.all([worker(), worker(), worker()]); // 3 in parallel
  },

  // Offline warming: persist the favorites + read-later lists and pre-extract
  // their content (pinned → never auto-evicted) so they're fully readable
  // offline. Also evicts cached lists older than the 30-day retention window.
  warmOfflineCache: async () => {
    listEvictOlderThan(Date.now() - 30 * 24 * 60 * 60 * 1000).catch(() => {});
    try {
      const [starred, readLater] = await Promise.all([
        getStarredItems(100).catch(() => null),
        getStreamContents(READ_LATER_LABEL, 100, null).catch(() => null),
      ]);
      const pinned: Article[] = [];
      if (starred?.items?.length) {
        const arts = starred.items.map(normalizeArticle);
        await listPut(viewKey(null, 'starred'), arts, starred.continuation);
        pinned.push(...arts);
      }
      if (readLater?.items?.length) {
        const arts = readLater.items.map(normalizeArticle);
        await listPut(viewKey(null, 'readlater'), arts, readLater.continuation);
        pinned.push(...arts);
      }
      // Extract + pin each (sequential, skip already cached) for offline reading.
      const { extractFullContent } = await import('../utils/extractContent');
      for (const a of pinned) {
        if (!a.url) continue;
        if (peekExtract(a.id) || (await getExtract(a.id))) {
          pinExtract(a.id).catch(() => {});
          continue;
        }
        try {
          const content = await extractFullContent(a.url);
          await putExtract(a.id, content, { pinned: true });
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  },

  // Full offline preparation (manual, user-triggered): sweep every feed for the
  // last 30 days — persist their lists, extract + cache content, and prefetch
  // images into the service-worker cache (capped ~550 MB). Heavy and network-
  // intensive, hence on-demand. Progress is exposed via `offlinePrep`.
  prepareOffline: async () => {
    if (get().offlinePrep?.running) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    set({ offlinePrep: { running: true, phase: 'lists', done: 0, total: 0 } });
    const subs = get().subscriptions;
    const collected: Article[] = [];
    // Phase 1 — gather recent articles per feed + persist their lists.
    for (const feed of subs) {
      try {
        let cont: string | null = null;
        let pages = 0;
        const feedArts: Article[] = [];
        do {
          const res = await getStreamContents(feed.id, PAGE_SIZE, cont, null, {});
          if (!res) break;
          const arts = res.items.map(normalizeArticle);
          feedArts.push(...arts);
          cont = res.continuation;
          pages++;
          if ((arts[arts.length - 1]?.published ?? 0) < cutoff) break; // past 30 days
        } while (cont && pages < 8);
        const recent = feedArts.filter((a) => a.published >= cutoff);
        if (recent.length) {
          await listPut(viewKey(feed, 'all'), recent.slice(0, PAGE_SIZE), null);
          collected.push(...recent);
        }
      } catch { /* skip this feed */ }
    }
    // Phase 2 — extract, cache, and prefetch images.
    // Images are prefetched whether or not the extract was already cached (the
    // two used to be coupled, which silently skipped images), in priority order,
    // and stop as soon as the storage budget is reached.
    const ui = useUiStore.getState();
    const budget = imageBudget(ui.offlineImagePreset, ui.offlineImageSizes, (await getStorageEstimate())?.quota ?? 0);
    const ordered = prioritizeForOffline(collected, READ_LATER_LABEL);
    let budgetReached = budget.bytes <= 0;
    let imagesFound = 0;
    let imagesStored = 0;
    let imagesBytes = 0;
    let imagesFailed = 0;
    let imagesError: string | undefined;

    set({ offlinePrep: { running: true, phase: 'articles', done: 0, total: ordered.length } });
    const { extractFullContent } = await import('../utils/extractContent');
    let done = 0;
    for (const a of ordered) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) break;

      let extracted: string | null = peekExtract(a.id)?.content ?? null;
      if (a.url && !extracted) {
        const stored = await getExtract(a.id);
        extracted = stored?.content ?? null;
        if (!extracted) {
          try {
            const content = await extractFullContent(a.url);
            await putExtract(a.id, content);
            extracted = content.content;
          } catch { /* keep the RSS content */ }
        }
      }

      if (!budgetReached) {
        const urls = articleImageUrls(a.content, extracted, budget.perArticle);
        imagesFound += urls.length;
        const res = await cacheImages(urls);
        imagesStored += res.stored;
        imagesBytes += res.bytes;
        imagesFailed += res.failed;
        imagesError ??= res.error;
        // Count the bytes we actually stored. The previous guard watched the
        // browser's storage estimate, which pads opaque entries so wildly that
        // it was unusable; proxied responses give us the real size.
        if (imagesBytes >= budget.bytes) budgetReached = true;
      }

      done++;
      if (done % 5 === 0 || done === ordered.length) {
        set({ offlinePrep: { running: true, phase: 'articles', done, total: ordered.length, imagesFound, imagesStored } });
      }
    }
    set({
      offlinePrep: {
        running: false, phase: 'done', done, total: ordered.length,
        imagesFound, imagesStored, imagesFailed,
        budgetStopped: budgetReached && budget.bytes > 0, imagesError,
      },
    });
  },

  loadArticles: async () => {
    const { selectedFeed, filter } = get();
    const key = viewKey(selectedFeed, filter);
    const sameView = () => viewKey(get().selectedFeed, get().filter) === key;
    const cached = memGet(key);
    // Memory cache already painted (set by the select action) → no spinner.
    set({ loading: !cached });

    // 1. Server cache (SWR) — only when memory had nothing, for an instant-ish
    //    first paint (first visit this session / cross-device). Non-blocking.
    if (!cached) {
      fetchArticleStream(filter, selectedFeed, PAGE_SIZE, null, true)
        .then((c) => {
          if (!c || !sameView() || !get().loading) return;
          const articles = c.items.map(normalizeArticle);
          memSet(key, { articles, continuation: c.continuation });
          set({ articles, continuation: c.continuation, loading: false });
        })
        .catch(() => {});
    }

    // 2. Live request — authoritative; updates the view + memory cache.
    try {
      const result = await fetchArticleStream(filter, selectedFeed, PAGE_SIZE, null);
      if (!sameView()) return; // user switched away while loading
      if (!result) { set({ loading: false }); return; }
      const articles = result.items.map(normalizeArticle);
      memSet(key, { articles, continuation: result.continuation });
      listPut(key, articles, result.continuation).catch(() => {}); // persist for offline
      warmExtracts(articles); // background: extract the whole page for offline
      set((state) => {
        const newErrors = { ...state.feedErrors };
        if (selectedFeed) delete newErrors[selectedFeed.id];
        // Reconcile the sidebar count: a specific feed that's fully loaded (no
        // more pages) with every article read has 0 unread — trust that over a
        // lagging server count that would otherwise show a phantom "1 unread".
        let unreadCounts = state.unreadCounts;
        if (selectedFeed && result.continuation == null) {
          if (articles.every((a) => a.read)) {
            setZeroFloor(selectedFeed.id, true); // hold it at 0 through the server-count lag
            if ((unreadCounts[selectedFeed.id] || 0) !== 0) {
              unreadCounts = { ...unreadCounts, [selectedFeed.id]: 0 };
            }
          } else {
            setZeroFloor(selectedFeed.id, false); // fully loaded but some unread → drop the floor
          }
        }
        return { articles, continuation: result.continuation, loading: false, feedErrors: newErrors, unreadCounts };
      });
    } catch (err) {
      if (!sameView()) return;
      // Offline fallback: serve the persisted list so reading still works.
      const persisted = await listGet(key);
      if (persisted && sameView()) {
        memSet(key, { articles: persisted.articles, continuation: persisted.continuation });
        set({ articles: persisted.articles, continuation: persisted.continuation, loading: false });
        return;
      }
      console.error('[FriRSS] loadArticles error:', err);
      set((state) => ({
        loading: false,
        feedErrors: selectedFeed
          ? { ...state.feedErrors, [selectedFeed.id]: Date.now() }
          : state.feedErrors,
      }));
    }
  },

  loadMore: async () => {
    const { continuation, selectedFeed, filter, loadingMore } = get();
    if (!continuation || loadingMore) return;
    set({ loadingMore: true });

    try {
      const result = await fetchArticleStream(filter, selectedFeed, PAGE_SIZE, continuation);
      if (!result) { set({ loadingMore: false }); return; }

      set((state) => {
        const articles = [...state.articles, ...result.items.map(normalizeArticle)];
        const key = viewKey(selectedFeed, filter);
        memSet(key, { articles, continuation: result.continuation });
        listPut(key, articles, result.continuation).catch(() => {}); // persist extended list
        return { articles, continuation: result.continuation, loadingMore: false };
      });
      warmExtracts(get().articles); // background: extract newly loaded pages for offline
    } catch {
      set({ loadingMore: false });
    }
  },

  toggleRead: async (article) => {
    const newRead = !article.read;
    // Optimistic update — instant UI feedback
    set((state) => ({
      articles: state.articles.map((a) =>
        a.id === article.id ? { ...a, read: newRead } : a
      ),
      selectedArticle:
        state.selectedArticle?.id === article.id
          ? { ...state.selectedArticle, read: newRead }
          : state.selectedArticle,
      unreadCounts: updateCount(state.unreadCounts, article, newRead ? -1 : 1),
    }));
    memMarkRead(article.id, newRead);
    persistCurrentView(get);
    try {
      if (newRead) {
        await markAsRead(article.id);
      } else {
        await markAsUnread(article.id);
      }
    } catch {
      // Rollback on failure
      set((state) => ({
        articles: state.articles.map((a) =>
          a.id === article.id ? { ...a, read: !newRead } : a
        ),
        selectedArticle:
          state.selectedArticle?.id === article.id
            ? { ...state.selectedArticle, read: !newRead }
            : state.selectedArticle,
        unreadCounts: updateCount(state.unreadCounts, article, newRead ? 1 : -1),
      }));
      memMarkRead(article.id, !newRead);
      persistCurrentView(get);
    }
  },

  toggleStar: async (article) => {
    const newStarred = !article.starred;
    // Optimistic update — instant UI feedback
    set((state) => {
      const isStarredFilter = state.filter === 'starred';
      const articles = isStarredFilter && !newStarred
        ? state.articles.filter((a) => a.id !== article.id)
        : state.articles.map((a) =>
            a.id === article.id ? { ...a, starred: newStarred } : a
          );
      return {
        articles,
        selectedArticle:
          isStarredFilter && !newStarred && state.selectedArticle?.id === article.id
            ? null
            : state.selectedArticle?.id === article.id
              ? { ...state.selectedArticle, starred: newStarred }
              : state.selectedArticle,
        starredCount: Math.max(0, state.starredCount + (newStarred ? 1 : -1)),
      };
    });
    try {
      if (newStarred) {
        await markAsStarred(article.id);
      } else {
        await removeStarred(article.id);
      }
    } catch {
      // Rollback on failure
      set((state) => ({
        articles: state.articles.map((a) =>
          a.id === article.id ? { ...a, starred: !newStarred } : a
        ),
        selectedArticle:
          state.selectedArticle?.id === article.id
            ? { ...state.selectedArticle, starred: !newStarred }
            : state.selectedArticle,
        starredCount: Math.max(0, state.starredCount + (newStarred ? -1 : 1)),
      }));
    }
  },

  // Search
  search: async (query) => {
    if (!query.trim()) {
      set({ searchQuery: '' });
      return get().loadArticles();
    }
    set({ searchQuery: query, loading: true });
    try {
      // Scope the search to the current view (feed / category / read-later /
      // starred), not always the whole reading-list.
      const { selectedFeed, filter } = get();
      const result = await searchItems(query, 40, null, resolveSearchStreamId(selectedFeed, filter));
      set({
        articles: result.items.map(normalizeArticle),
        continuation: result.continuation,
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },

  clearSearch: () => {
    set({ searchQuery: '' });
    get().loadArticles();
  },

  // Mark all as read
  markAllAsRead: async () => {
    const { selectedFeed } = get();
    const streamId = selectedFeed
      ? selectedFeed.id
      : 'user/-/state/com.google/reading-list';
    try {
      await markAllAsRead(streamId);
      // Update local state
      set((state) => {
        const updated = state.articles.map((a) => ({ ...a, read: true }));
        const newCounts = { ...state.unreadCounts };
        if (selectedFeed) {
          newCounts[selectedFeed.id] = 0;
        } else {
          // Reset all counts
          Object.keys(newCounts).forEach((k) => { newCounts[k] = 0; });
        }
        return {
          articles: updated,
          unreadCounts: newCounts,
          selectedArticle: state.selectedArticle
            ? { ...state.selectedArticle, read: true }
            : null,
        };
      });
    } catch { /* ignore */ }
  },

  // Labels / tags — exclude categories (which are used for feeds)
  loadLabels: async () => {
    try {
      const tags = await getTagList();
      const { subscriptions } = get();
      // Collect all category IDs used by subscriptions
      const categoryIds = new Set<string>();
      subscriptions.forEach((sub) => {
        sub.categories?.forEach((c) => categoryIds.add(c.id));
      });
      // User labels = /label/ tags that are NOT subscription categories and NOT Read Later
      const labels = tags.filter(
        (t) => t.id && t.id.includes('/label/') && !t.id.includes('/state/') && !categoryIds.has(t.id) && t.id !== READ_LATER_LABEL
      );
      set({ labels });
      // Article counts per label (background, only if the user shows them).
      if (useUiStore.getState().showLabelCounts) get().loadLabelCounts();
    } catch { /* ignore */ }
  },

  // Count articles per user label (lightweight IDs-only endpoint), in the
  // background with limited parallelism. Cached server-side (Redis) when on.
  loadLabelCounts: async () => {
    const { labels } = get();
    if (!labels.length) return;
    const counts: Record<string, number> = { ...get().labelCounts };
    const PARALLEL = 3;
    for (let i = 0; i < labels.length; i += PARALLEL) {
      await Promise.all(
        labels.slice(i, i + PARALLEL).map(async (l) => {
          try { counts[l.id] = await getStreamItemCount(l.id); } catch { /* skip this label */ }
        })
      );
    }
    set({ labelCounts: counts });
  },

  // Read Later
  toggleReadLater: async (article) => {
    const hasLabel = article.labels?.includes(READ_LATER_LABEL);
    const removing = hasLabel;
    // Optimistic update — instant UI feedback
    set((state) => {
      const isReadLaterFilter = state.filter === 'readlater';
      if (isReadLaterFilter && removing) {
        return {
          articles: state.articles.filter((a) => a.id !== article.id),
          selectedArticle:
            state.selectedArticle?.id === article.id ? null : state.selectedArticle,
          readLaterCount: Math.max(0, state.readLaterCount - 1),
        };
      }
      const update = (a: Article): Article => {
        if (a.id !== article.id) return a;
        const labels = removing
          ? (a.labels || []).filter((l) => l !== READ_LATER_LABEL)
          : [...(a.labels || []), READ_LATER_LABEL];
        return { ...a, labels };
      };
      return {
        articles: state.articles.map(update),
        selectedArticle: state.selectedArticle ? update(state.selectedArticle) : null,
        readLaterCount: Math.max(0, state.readLaterCount + (removing ? -1 : 1)),
      };
    });
    try {
      await setArticleLabel(article.id, READ_LATER_LABEL, !hasLabel);
    } catch {
      // Rollback on failure
      set((state) => {
        const update = (a: Article): Article => {
          if (a.id !== article.id) return a;
          const labels = removing
            ? [...(a.labels || []), READ_LATER_LABEL]
            : (a.labels || []).filter((l) => l !== READ_LATER_LABEL);
          return { ...a, labels };
        };
        return {
          articles: state.articles.map(update),
          selectedArticle: state.selectedArticle ? update(state.selectedArticle) : null,
          readLaterCount: Math.max(0, state.readLaterCount + (removing ? 1 : -1)),
        };
      });
    }
  },

  toggleArticleLabel: async (article, labelId) => {
    const hasLabel = article.labels?.includes(labelId);
    // Optimistic update — instant UI feedback
    const updateLabels = (a: Article): Article => {
      if (a.id !== article.id) return a;
      const labels = hasLabel
        ? (a.labels || []).filter((l) => l !== labelId)
        : [...(a.labels || []), labelId];
      return { ...a, labels };
    };
    set((state) => ({
      articles: state.articles.map(updateLabels),
      selectedArticle: state.selectedArticle
        ? updateLabels(state.selectedArticle)
        : null,
    }));
    try {
      await setArticleLabel(article.id, labelId, !hasLabel);
      // Refresh labels list in case a new label was created
      get().loadLabels();
    } catch (err) {
      console.error('[FriRSS] toggleArticleLabel failed:', err);
      // Rollback
      const rollbackLabels = (a: Article): Article => {
        if (a.id !== article.id) return a;
        const labels = hasLabel
          ? [...(a.labels || []), labelId]
          : (a.labels || []).filter((l) => l !== labelId);
        return { ...a, labels };
      };
      set((state) => ({
        articles: state.articles.map(rollbackLabels),
        selectedArticle: state.selectedArticle
          ? rollbackLabels(state.selectedArticle)
          : null,
      }));
    }
  },

  // Label management (rename / delete)
  renameLabel: async (oldLabelId, newName) => {
    const newLabelId = `user/-/label/${newName}`;
    try {
      await renameTag(oldLabelId, newLabelId);
      // Update all articles that had the old label
      set((state) => {
        const updateLabels = (a: Article): Article => {
          if (!a.labels?.includes(oldLabelId)) return a;
          return {
            ...a,
            labels: a.labels.map((l) => (l === oldLabelId ? newLabelId : l)),
          };
        };
        return {
          articles: state.articles.map(updateLabels),
          selectedArticle: state.selectedArticle
            ? updateLabels(state.selectedArticle)
            : null,
        };
      });
      await get().loadLabels();
      return true;
    } catch {
      return false;
    }
  },

  deleteLabel: async (labelId) => {
    try {
      await deleteTag(labelId);
      // Remove from all articles locally
      set((state) => {
        const removeLabel = (a: Article): Article => {
          if (!a.labels?.includes(labelId)) return a;
          return { ...a, labels: a.labels.filter((l) => l !== labelId) };
        };
        return {
          articles: state.articles.map(removeLabel),
          selectedArticle: state.selectedArticle
            ? removeLabel(state.selectedArticle)
            : null,
          labels: state.labels.filter((l) => l.id !== labelId),
        };
      });
      return true;
    } catch {
      return false;
    }
  },

  // Feed management
  renameFeed: async (feedId, newTitle) => {
    try {
      await editFeed(feedId, newTitle);
      set((state) => ({
        subscriptions: state.subscriptions.map((s) =>
          s.id === feedId ? { ...s, title: newTitle } : s
        ),
        selectedFeed:
          state.selectedFeed?.id === feedId
            ? { ...state.selectedFeed, title: newTitle }
            : state.selectedFeed,
      }));
      return true;
    } catch {
      return false;
    }
  },

  addFeed: async (feedUrl, title, categoryId, categoryLabel) => {
    try {
      await subscribeFeed(feedUrl, title, categoryId, categoryLabel);
      await get().loadSubscriptions();
      return true;
    } catch {
      return false;
    }
  },

  removeFeed: async (feedId) => {
    try {
      await unsubscribeFeed(feedId);
      set((state) => ({
        subscriptions: state.subscriptions.filter((s) => s.id !== feedId),
        selectedFeed: state.selectedFeed?.id === feedId ? null : state.selectedFeed,
      }));
      return true;
    } catch {
      return false;
    }
  },

  // Navigate articles
  selectNextArticle: () => {
    const { articles, selectedArticle } = get();
    if (!articles.length) return;
    const idx = selectedArticle
      ? articles.findIndex((a) => a.id === selectedArticle.id)
      : -1;
    const next = articles[idx + 1];
    if (next) get().selectArticle(next);
  },

  selectPrevArticle: () => {
    const { articles, selectedArticle } = get();
    if (!articles.length) return;
    const idx = selectedArticle
      ? articles.findIndex((a) => a.id === selectedArticle.id)
      : articles.length;
    const prev = articles[idx - 1];
    if (prev) get().selectArticle(prev);
  },

  // Lightweight sync — just refresh counters from server (no article reload)
  // Used for background polling & cross-device sync
  syncCounts: async () => {
    try {
      const counts = await getUnreadCounts();
      const countMap: Record<string, number> = {};
      counts.forEach((c) => { countMap[c.id] = c.count; });
      set({ unreadCounts: applyZeroFloor(countMap) });
      // Also refresh starred & read-later counts
      get().loadSpecialCounts();
    } catch { /* ignore */ }
  },

  // Full sync — refresh counters + reload current article list
  // Used when tab regains visibility (cross-device scenario)
  silentRefresh: async () => {
    await get().syncCounts();
    // Silently reload current article list (no loading spinner)
    const { selectedFeed, filter } = get();
    try {
      const result = await fetchArticleStream(filter, selectedFeed, PAGE_SIZE, null);
      if (!result) return;
      const newArticles = result.items.map(normalizeArticle);
      // Merge: keep selectedArticle in sync if it still exists
      set((state) => {
        const selectedId = state.selectedArticle?.id;
        const updatedSelected = selectedId
          ? newArticles.find((a) => a.id === selectedId) || state.selectedArticle
          : null;

        // Don't let the article you're currently reading vanish from under you:
        // in unread-only mode a background refresh drops it (it's now read), so
        // re-insert it at its previous spot. It falls away on the next refresh
        // once you've moved to another article.
        let articles = newArticles;
        if (updatedSelected && !newArticles.some((a) => a.id === updatedSelected.id)) {
          const prevIdx = state.articles.findIndex((a) => a.id === updatedSelected.id);
          const insertAt = prevIdx >= 0 ? Math.min(prevIdx, newArticles.length) : 0;
          articles = [...newArticles];
          articles.splice(insertAt, 0, { ...updatedSelected, read: true });
        }

        return {
          articles,
          continuation: result.continuation,
          selectedArticle: updatedSelected,
        };
      });
    } catch { /* ignore */ }
  },

  refresh: async () => {
    // Snapshot per-feed unread counts before the reload, so we can report how
    // many new articles arrived and in which feeds (see RefreshBanner + pulse).
    const before = { ...get().unreadCounts };
    await get().loadSubscriptions();
    await get().loadArticles();
    const { totalNew, newByFeed } = computeRefreshDelta(before, get().unreadCounts);
    set({ refreshResult: { totalNew, newByFeed, at: Date.now() } });
  },

  clearRefreshResult: () => set({ refreshResult: null }),

  // Full reset + reload — used when switching the active FreshRSS server
  resetAndReload: () => {
    // The CSRF write-token is per-server; drop the cached one so the next
    // write fetches a fresh token for the newly-active FreshRSS instance.
    clearWriteToken();
    warmListsToken++; // cancel any in-flight prefetch sweep for the old server
    memClear(); // memory cache is per-server (feed ids/global keys differ)
    set({
      subscriptions: [],
      unreadCounts: {},
      articles: [],
      continuation: null,
      selectedFeed: null,
      selectedArticle: null,
      filter: 'all',
      loading: true,
      loadingMore: false,
      searchQuery: '',
      labels: [],
      labelCounts: {},
      categoryIds: [],
      starredCount: 0,
      readLaterCount: 0,
      feedErrors: {},
    });
    get().loadSubscriptions();
    get().loadArticles();
  },
}));

function normalizeArticle(item: GReaderItem): Article {
  return {
    id: item.id,
    title: item.title || 'Sans titre',
    summary:
      item.summary?.content?.replace(/<[^>]*>/g, '').slice(0, 200) || '',
    content: item.content?.content || item.summary?.content || '',
    author: item.author || '',
    url: item.canonical?.[0]?.href || item.alternate?.[0]?.href || '',
    source: item.origin?.title || '',
    sourceId: item.origin?.streamId || '',
    published: item.published ? item.published * 1000 : Date.now(),
    read: item.categories?.some((c) =>
      c.endsWith('/state/com.google/read')
    ) ?? false,
    starred: item.categories?.some((c) =>
      c.endsWith('/state/com.google/starred')
    ) ?? false,
    labels: item.categories
      ?.filter((c) => c.includes('/label/')) || [],
    tags: item.categories
      ?.filter(
        (c) =>
          !c.includes('/state/') && !c.includes('/label/')
      ) || [],
  };
}

function updateCount(counts: Record<string, number>, article: Article, delta: number): Record<string, number> {
  const feedId = article.sourceId;
  if (!feedId) return counts;
  const next = { ...counts };
  next[feedId] = Math.max(0, (next[feedId] || 0) + delta);
  const totalKey = Object.keys(next).find((k) => k.includes('/reading-list'));
  if (totalKey) next[totalKey] = Math.max(0, (next[totalKey] || 0) + delta);
  return next;
}
