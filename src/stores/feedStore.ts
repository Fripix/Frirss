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
import type {
  Article,
  Subscription,
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
const MEM_CACHE_MAX = 25;
const memCache = new Map<string, CachedView>();
const viewKey = (feed: Subscription | null, filter: Filter) => `${feed?.id || ''}:${filter}`;
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
function memClear(): void {
  memCache.clear();
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

  setFilter: (filter: Filter) => void;
  loadLabelCounts: () => Promise<void>;
  selectFeed: (feed: Subscription | null) => void;
  selectView: (feed: Subscription | null, filter?: Filter) => void;
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
}

export const useFeedStore = create<FeedState>()((set, get) => ({
  subscriptions: [],
  unreadCounts: {},
  articles: [],
  continuation: null,
  selectedFeed: null,
  selectedArticle: null,
  filter: 'all',
  loading: false,
  loadingMore: false,
  searchQuery: '',
  labels: [],
  labelCounts: {},
  categoryIds: [],
  starredCount: 0,
  readLaterCount: 0,
  feedErrors: {}, // { [feedId]: timestamp } — tracks feeds that errored on load

  setFilter: (filter) => {
    const c = memGet(viewKey(get().selectedFeed, filter));
    set({ filter, articles: c?.articles || [], continuation: c?.continuation || null, selectedArticle: null });
    get().loadArticles();
  },

  selectFeed: (feed) => {
    const c = memGet(viewKey(feed, get().filter));
    set({ selectedFeed: feed, articles: c?.articles || [], continuation: c?.continuation || null, selectedArticle: null });
    get().loadArticles();
  },

  // Combined action: set feed + filter in one go, single loadArticles call
  selectView: (feed, filter) => {
    const f = filter || 'all';
    const c = memGet(viewKey(feed ?? null, f));
    set({ selectedFeed: feed ?? null, filter: f, articles: c?.articles || [], continuation: c?.continuation || null, selectedArticle: null });
    get().loadArticles();
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
    });
  },

  loadSubscriptions: async () => {
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
        unreadCounts: countMap,
        categoryIds: catIds,
      });
      // Auto-load user labels now that we know categories
      get().loadLabels();
      // Load starred & read-later counts in background
      get().loadSpecialCounts();
    } catch { /* ignore */ }
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
      set((state) => {
        const newErrors = { ...state.feedErrors };
        if (selectedFeed) delete newErrors[selectedFeed.id];
        return { articles, continuation: result.continuation, loading: false, feedErrors: newErrors };
      });
    } catch (err) {
      console.error('[FriRSS] loadArticles error:', err);
      if (!sameView()) return;
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
        memSet(viewKey(selectedFeed, filter), { articles, continuation: result.continuation });
        return { articles, continuation: result.continuation, loadingMore: false };
      });
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
      const result = await searchItems(query, 40);
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
      set({ unreadCounts: countMap });
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
        return {
          articles: newArticles,
          continuation: result.continuation,
          selectedArticle: updatedSelected,
        };
      });
    } catch { /* ignore */ }
  },

  refresh: async () => {
    await get().loadSubscriptions();
    await get().loadArticles();
  },

  // Full reset + reload — used when switching the active FreshRSS server
  resetAndReload: () => {
    // The CSRF write-token is per-server; drop the cached one so the next
    // write fetches a fresh token for the newly-active FreshRSS instance.
    clearWriteToken();
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
