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
  fetchStreamPage,
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
import { articleHaystack, parseQuery } from '../lib/searchMatch';
import { scanErrorKind } from '../lib/scanError';
import {
  createCorpus, addPage, corpusIsUsable, corpusMatches, patchCorpusArticle,
  type Corpus,
} from '../lib/searchCorpus';
import { useAuthStore } from './authStore';
import { useUiStore, isUnreadOnly } from './uiStore';
import type { HomeEntry } from '../lib/unreadScope';
import { peekExtract, getExtract, putExtract, pinExtract } from '../lib/extractCache';
import { listGet, listPut, listEvictOlderThan, subsGet, subsPut, queueGet, queuePut } from '../lib/offlineStore';
import { computeRefreshDelta } from '../lib/refreshDelta';
import { countNewInView, viewFeedIds } from '../lib/newArticles';
import { isValidCategoryName } from '../lib/feedCategories';
import {
  actionKey, mergeAction, isNetworkFailure, shouldRetry,
  type QueuedAction, type QueuedActionType,
} from '../lib/actionQueue';
import { articleImageUrls, imageBudget, prioritizeForOffline } from '../lib/offlineImages';
import { getStorageEstimate } from '../lib/storageEstimate';
import { cacheImages } from '../lib/imageCache';
import { nextPhase, shouldTriggerRealRefresh, POLL_INTERVAL_MS, type RefreshPhase } from '../lib/refreshPolling';
import { shouldLeaveList } from '../lib/removeOnRead';
import { shouldTopUpAfterRemoval } from '../lib/listTopUp';
import { listCanScroll } from '../lib/listOverflow';
import { planRowRestore } from '../lib/rollbackRow';
import { writeFailureNotice } from '../lib/writeFailureNotice';
import { canLoadMore, shouldReportInvisibleProgress } from '../lib/listPagination';
import { createWarmRunner } from '../lib/warmSchedule';
import { startActualize, getActualizeStatus, type ActualizeJob } from '../api/backend';
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

/**
 * Taille d'une tranche de balayage de recherche.
 * Mesuré : 1 000 articles en ~830 ms, ~2 Mo. `PAGE_SIZE` reste la taille des
 * tranches VISIBLES (résultats rendus d'un coup) — deux constantes à 50 dans
 * ce même fichier seraient un doublon.
 */
const SCAN_PAGE = 1000;

/** Le seul corpus gardé — celui du dernier périmètre balayé. */
let searchCorpus: Corpus | null = null;
/**
 * Jeton du balayage courant. Toute nouvelle recherche, tout arrêt, tout
 * changement de serveur l'incrémente : la boucle en vol se voit périmée et rend
 * la main sans rien écrire. Même garde que `countsEpoch` pour les compteurs.
 */
let scanToken = 0;
/** Les mots du balayage en cours, pour que `retrySearch` reprenne les mêmes. */
let scanTerms: string[] = [];

export function __resetSearchStateForTests(): void {
  searchCorpus = null;
  scanToken = 0;
  scanTerms = [];
}

/** Le corpus n'appartient qu'au serveur qui l'a produit. */
export function dropSearchCorpus(): void {
  searchCorpus = null;
  scanToken++;
}

/** Répercute une écriture locale sur le corpus gardé. */
function patchSearchCorpus(id: string, patch: Partial<Article>): void {
  if (searchCorpus) searchCorpus = patchCorpusArticle(searchCorpus, id, patch);
}

// Lazy (dynamic) import of i18n, not a static one at the top of the file:
// `feedStore.ts` is imported by nearly every component, and a static import
// of `../i18n` ran its `i18n.init()` as soon as the module loaded — including
// in isolated component tests that stub `react-i18next` without
// `initReactI18next`. In the real app `../i18n` is already loaded by
// `main.tsx` well before a click is possible, so this dynamic import resolves
// from cache — no real cost.
async function pushI18nToast(key: string, opts?: { tone: 'error' }): Promise<void> {
  const { default: i18n } = await import('../i18n');
  useUiStore.getState().pushToast(i18n.t(key), opts);
}

/**
 * Dire à l'utilisateur qu'une écriture d'article n'est pas passée.
 *
 * Le ✓ retire la ligne avant la réponse de FreshRSS : sans ce message, un
 * échec est indiscernable d'une réussite jusqu'au prochain rechargement, où
 * tout ce qu'on croyait avoir lu revient non lu. `writeFailureNotice`
 * (`src/lib/writeFailureNotice.ts`) décide seul s'il faut parler et de quoi ;
 * le hors-ligne véritable reste muet, le bandeau global le couvre déjà.
 */
async function notifyWriteFailure(err: unknown): Promise<void> {
  const notice = writeFailureNotice({
    networkFailure: isNetworkFailure(err),
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
  });
  if (!notice) return;
  await pushI18nToast(
    notice === 'refused' ? 'toast.markFailed' : 'toast.markQueued',
    { tone: 'error' },
  );
}

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
// Retirer une ligne du cache mémoire de TOUTES les vues portant un filtre
// donné. Sans cela, un retrait ne dure que le temps de la vue : `loadArticles`
// repeint depuis ce cache et pose `loading: !cached`, donc y revenir
// réaffichait la ligne retirée, sans spinner et sans limite de temps hors
// ligne. Le filtre est lu dans la clé (`<feedId>:<filter>`).
//
// Générique parce que DEUX écrivains retirent une ligne : le ✓ sous « Non
// lus » (`toggleRead`) et le retrait de l'étiquette depuis « À lire plus
// tard » (`toggleReadLater`). Le second avait été oublié — même défaut, même
// symptôme.
function memRemoveFromViews(articleId: string, filter: Filter): void {
  const suffix = `:${filter}`;
  for (const [key, view] of memCache) {
    if (!key.endsWith(suffix)) continue;
    const articles = view.articles.filter((a) => a.id !== articleId);
    if (articles.length !== view.articles.length) memCache.set(key, { ...view, articles });
  }
}
// Re-persist the current view's list to the offline store after ANY optimistic
// change, so an offline return to it reflects the latest state. Longtemps
// appelé par les seuls chemins de lecture : le favori et « à lire plus tard »
// étaient donc perdus du cache, et un rechargement hors ligne les affichait
// dans leur état d'avant.
// Identité de la vue affichée : le flux, le filtre, et la recherche en cours.
// Le rollback d'un retrait optimiste s'en sert pour vérifier qu'il réinsère
// bien dans la liste d'où la ligne vient — `selectFeed` remplace `articles` en
// bloc, et une recherche aussi. La clé du cache (`viewKey`) ne suffit pas : une
// recherche ne change ni le flux ni le filtre, mais bien la liste à l'écran.
function viewIdentity(s: FeedState): string {
  return `${s.selectedFeed?.id || ''}:${s.filter}:${s.searchQuery || ''}`;
}
function persistCurrentView(get: () => FeedState): void {
  const s = get();
  // `viewKey` ignore `searchQuery` : persister pendant une recherche
  // écrirait les résultats filtrés sous la clé de la vue nue, que le
  // prochain retour hors ligne sur ce flux resservirait comme s'il n'y avait
  // jamais eu de recherche.
  if (s.searchQuery) return;
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
// Flux dont le plancher zéro vient d'expirer au dernier `applyZeroFloor` : ils
// sautent de 0 au compte réel, ce qui n'est pas une arrivée pour la pastille
// « nouveaux articles » (`syncCounts` la consomme et la vide — voir plus bas).
const zeroFloorJustExpired = new Set<string>();
// Force still-in-window feeds to 0 (server count is lagging) and drop expired
// entries. Applied wherever server unread counts overwrite the local ones.
function applyZeroFloor(counts: Record<string, number>): Record<string, number> {
  const now = Date.now();
  for (const [feedId, until] of zeroUnreadFloor) {
    if (until <= now) {
      zeroUnreadFloor.delete(feedId);
      zeroFloorJustExpired.add(feedId);
    } else {
      counts[feedId] = 0;
    }
  }
  return counts;
}

// ── Pastille « nouveaux articles » : garde contre les fausses arrivées ─────
// (revue finale, discussion #14, 2026-09-17)
//
// `syncCounts` lit les compteurs du serveur APRÈS un aller-retour réseau. Si
// l'app écrit `unreadCounts` localement (✓, tout marquer lu, une nouvelle vue
// qui repart de zéro) pendant que ce relevé est en vol, le compteur local a
// déjà bougé avant que le serveur ne le sache : le relevé qui répond ensuite
// avec l'ancien compte ressemble à une arrivée, alors que ce n'est que l'écho
// du propre changement de l'app.
//
// `countsEpoch` sert d'horodatage grossier : toute écriture locale
// l'incrémente. `syncCounts` retient sa valeur avant son attente réseau et la
// compare à sa valeur après — un écart dit qu'une écriture locale a eu lieu
// entre-temps, et ce relevé ne compte alors aucune arrivée (les compteurs
// eux-mêmes sont quand même appliqués : une arrivée manquée se voit au
// prochain relevé).
let countsEpoch = 0;
function bumpCountsEpoch(): void { countsEpoch++; }

// Posé chaque fois qu'un relevé qui suit pourrait lire une écriture locale
// non encore reflétée côté serveur, sans que ce soit une hausse : une action
// mise en file (`enqueueAction`, hors-ligne ou après un 5xx transitoire) et
// une file rejouée qui abandonne une action (`replayQueue` — un refus ET des
// échecs répétés atterrissent tous deux dans `failed`, donc les deux posent
// ce drapeau) laissent un ✓ local sans correspondant côté serveur. Consommé
// (remis à faux) par le PROCHAIN RELEVÉ RÉUSSI seulement — un relevé qui
// échoue (exception avant d'atteindre la ligne qui le consomme) le laisse
// posé, sans quoi l'arrivée resterait masquée pour rien à la panne suivante.
let skipNextArrivals = false;

// Contrôle du 2026-09-17 (Important 1) : `countsEpoch` est incrémenté au
// moment de l'écriture LOCALE optimiste (juste avant l'appel réseau), pas à
// sa confirmation. Un relevé qui démarre APRÈS ce bump mais alors que
// `markAsRead`/`markAsUnread` n'a pas encore atteint FreshRSS capture donc un
// epoch déjà à jour : la comparaison avant/après de `syncCounts` n'y voit
// aucun écart, alors que le compte local a déjà bougé et que le serveur, lui,
// répond encore avec l'ancien. `readWritesInFlight` couvre ce trou : posé à
// vrai dès que l'appel réseau démarre, il reste vrai tant que la réponse
// (succès ou échec) n'est pas revenue. `syncCounts` le lit AVANT sa propre
// attente réseau ; s'il était vrai à ce moment-là, ce relevé ne compte aucune
// arrivée — l'écriture qui se règle PENDANT le relevé reste couverte par le
// second bump d'epoch posé à son règlement (voir les sites d'appel).
// `markAllAsRead` n'a pas besoin de ce compteur : elle n'écrit
// `unreadCounts` qu'APRÈS la confirmation du serveur, jamais avant.
let readWritesInFlight = 0;

/**
 * Remet à l'état neutre l'état module-level de la garde anti-fausse-arrivée
 * de la pastille « nouveaux articles ». N'existe QUE pour l'isolation des
 * tests (`feedStore.test.ts`) : ce module-level n'est jamais remis à zéro
 * entre les fichiers/tests d'un même run, contrairement au store Zustand
 * lui-même (`useFeedStore.setState`).
 */
export function __resetNewArticlesStateForTests(): void {
  skipNextArrivals = false;
  readWritesInFlight = 0;
  zeroFloorJustExpired.clear();
  zeroUnreadFloor.clear();
}

function memClear(): void {
  memCache.clear();
}

// Background-extract the auto-extract articles of a freshly loaded view so the
// WHOLE page is available offline (not only the ones the user opened).
// Sequential + delayed (doesn't compete with rendering), skips already-cached,
// writes through to the persistent cache.
//
// L'ordonnancement — quand annuler, quand étendre, quand payer le délai
// d'installation — vit dans `src/lib/warmSchedule.ts`. Il tenait ici dans un
// compteur de jetons que CHAQUE appel incrémentait, donc que chaque appel
// annulait ; le rattrapage de pagination, qui redemande une page à chaque
// retrait de ligne, le relançait alors sans fin sur une même vue.
const warmRunner = createWarmRunner<Article>({
  isCached: async (a) => !!peekExtract(a.id) || !!(await getExtract(a.id)),
  extract: async (a) => {
    // Import dynamique : résolu depuis le cache de modules dès la deuxième
    // extraction, et jamais chargé sur une vue qui n'extrait rien.
    const { extractFullContent } = await import('../utils/extractContent');
    await putExtract(a.id, await extractFullContent(a.url!));
  },
  settle: () => new Promise((r) => setTimeout(r, 2000)), // let the view settle first
});
function warmExtracts(articles: Article[], view: string): void {
  const fs = useUiStore.getState().feedSettings;
  void warmRunner.schedule(view, articles.filter((a) => a.url && fs[a.sourceId]?.autoExtract));
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

/** État du balayage de recherche en cours (ou du dernier terminé). */
export interface SearchScan {
  running: boolean;
  scanned: number;
  done: boolean;
  stopped: boolean;
  error: 'network' | 'rate-limit' | 'offline' | null;
}

export interface FeedState {
  subscriptions: Subscription[];
  unreadCounts: Record<string, number>;
  articles: Article[];
  continuation: string | null;
  selectedFeed: Subscription | null;
  selectedArticle: Article | null;
  filter: Filter;
  /** Entrée d'accueil choisie — voir `homeEntryActive` (`src/lib/unreadScope.ts`). */
  homeEntry: HomeEntry;
  loading: boolean;
  loadingMore: boolean;
  /**
   * Vrai pendant la requête AUTHORITATIVE de `loadArticles` (celle qui
   * confirme/actualise ce que le cache mémoire vient de peindre), du hit de
   * cache jusqu'à sa résolution. `loading` reste faux dans ce cas — la vue
   * est déjà peinte, pas de spinner — donc rien d'autre ne dit qu'une requête
   * est en vol. Sert à bloquer « charger la suite » : un clic dans cette
   * fenêtre lancerait `loadMore` en même temps que cette requête, qui gagne
   * presque toujours la course et écraserait la page ajoutée en
   * réinitialisant `continuation`. Voir `canLoadMore` dans `listPagination.ts`.
   */
  revalidating: boolean;
  searchQuery: string;
  /** Toutes les correspondances trouvées par le balayage en cours. */
  searchResults: Article[];
  /** Combien de `searchResults` sont montrés dans `articles` (pagination locale, par tranches). */
  searchVisible: number;
  /** Avancement / issue du balayage de recherche — voir `SearchScan`. */
  searchScan: SearchScan;
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
  /** Entrée « Tous les flux » (barre latérale, palette). */
  selectHomeAll: () => void;
  selectCategory: (cat: FeedCategory) => void;
  selectArticle: (article: Article | null) => void;
  loadSubscriptions: () => Promise<void>;
  loadSpecialCounts: () => Promise<void>;
  loadArticles: () => Promise<void>;
  loadMore: () => Promise<void>;
  toggleRead: (article: Article, opts?: { implicit?: boolean }) => Promise<void>;
  toggleStar: (article: Article) => Promise<void>;
  search: (query: string) => Promise<void>;
  clearSearch: () => void;
  /** Interrompt le balayage en cours, résultats conservés. */
  stopSearch: () => void;
  /** Reprend un balayage interrompu à sa continuation, sans refaire ce qui est déjà acquis. */
  retrySearch: () => Promise<void>;
  /** Montre la tranche de résultats suivante — purement local, aucun réseau. */
  showMoreSearchResults: () => void;
  markAllAsRead: () => Promise<void>;
  loadLabels: () => Promise<void>;
  toggleReadLater: (article: Article) => Promise<void>;
  toggleArticleLabel: (article: Article, labelId: string) => Promise<void>;
  renameLabel: (oldLabelId: string, newName: string) => Promise<boolean>;
  deleteLabel: (labelId: string) => Promise<boolean>;
  renameFeed: (feedId: string, newTitle: string) => Promise<boolean>;
  /** Catégories de flux — voir `src/lib/feedCategories.ts` pour le modèle. */
  renameCategory: (categoryId: string, newName: string) => Promise<boolean>;
  deleteCategory: (categoryId: string) => Promise<boolean>;
  moveFeedToCategory: (feedId: string, categoryName: string) => Promise<boolean>;
  addFeed: (feedUrl: string, title?: string, categoryId?: string, categoryLabel?: string) => Promise<boolean>;
  removeFeed: (feedId: string) => Promise<boolean>;
  selectNextArticle: () => void;
  selectPrevArticle: () => void;
  syncCounts: () => Promise<void>;
  silentRefresh: () => Promise<void>;
  /** Remet `newInView` à zéro et recharge la liste. */
  loadNewArticles: () => Promise<void>;
  refresh: () => Promise<void>;
  resetAndReload: () => void;
  // Feedback after a manual refresh: how many new articles arrived and where.
  // Drives the "X new articles" banner + the per-feed pulse; cleared after a
  // few seconds by the banner.
  refreshResult: { totalNew: number; newByFeed: Record<string, number>; at: number } | null;
  /** Articles arrivés dans la vue affichée depuis son chargement (pastille, discussion #14). */
  newInView: number;
  clearRefreshResult: () => void;
  /** Phase of a real (server-side) feed refresh; 'idle' when none is running. */
  refreshPhase: RefreshPhase;
  /** Whether the active server has a master token configured. */
  hasRefreshToken: boolean;
  setHasRefreshToken: (v: boolean) => void;
  /** Actions made offline, waiting for the network. */
  pendingActions: number;
  /** Actions given up on after repeated failures, since the last replay. */
  failedActions: number;
  replayQueue: () => Promise<void>;
}

// The queue lives in IndexedDB; this mirror avoids a read on every toggle.
let actionQueue: QueuedAction[] = [];
let queueLoaded = false;
/**
 * Rejeu en cours, s'il y en a un.
 *
 * `replayQueue` est déclenché au montage de l'application ET à chaque événement
 * `online` (`App.tsx`). Deux passes pouvaient donc se chevaucher : elles
 * lisaient la même file, envoyaient chaque action deux fois, et la plus lente
 * réécrivait ensuite la file de la plus rapide — ressuscitant au passage des
 * actions déjà traitées. Les appelants concurrents attendent désormais la
 * même exécution.
 */
let replayInFlight: Promise<void> | null = null;

async function loadQueue(): Promise<QueuedAction[]> {
  if (!queueLoaded) { actionQueue = await queueGet(); queueLoaded = true; }
  return actionQueue;
}

/**
 * Remember an action that failed for lack of network, so it can be replayed.
 * Business refusals never come here — see isNetworkFailure.
 */
async function enqueueAction(
  set: (partial: Partial<FeedState>) => void,
  articleId: string,
  type: QueuedActionType,
  value: boolean,
  labelId?: string,
): Promise<void> {
  // Posé EN PREMIER, avant tout `await` (dernier contrôle, 2026-09-17) : le
  // caller a déjà décrémenté `readWritesInFlight` et bumpé `countsEpoch` dans
  // son propre `finally`, AVANT d'appeler `enqueueAction` (voir
  // `selectArticle`/`toggleRead`) — un relevé qui démarre entre ce moment-là
  // et la fin des deux `await` ci-dessous (IndexedDB) ne verrait ni l'un ni
  // l'autre signal, seulement `skipNextArrivals`. La mise en file EST le
  // changement local qui a échoué à atteindre le serveur : le relevé qui
  // suit ne doit rien en conclure. Un seul relevé suffit à l'ignorer : ce
  // relevé-là écrase le compte local par celui du serveur (`syncCounts`
  // applique toujours `next`), donc à partir du suivant les deux compteurs
  // sont d'accord et une vraie arrivée redevient détectable — inutile
  // d'attendre que la file entière soit rejouée (`replayQueue` ne tourne
  // qu'au montage et sur l'événement `online` : une action encore en attente
  // aurait sinon masqué la pastille pour toute une session).
  skipNextArrivals = true;
  await loadQueue();
  actionQueue = mergeAction(actionQueue, {
    key: actionKey(articleId, type, labelId),
    articleId, type, value, labelId, at: Date.now(), attempts: 0,
  });
  await queuePut(actionQueue);
  set({ pendingActions: actionQueue.length });
}

const IDLE_SCAN: SearchScan = { running: false, scanned: 0, done: false, stopped: false, error: null };

export const useFeedStore = create<FeedState>()((set, get) => ({
  subscriptions: [],
  unreadCounts: {},
  articles: [],
  continuation: null,
  selectedFeed: null,
  selectedArticle: null,
  // Honour the persisted per-feed "unread only" preference for the startup
  // (landing / "all feeds") view.
  filter: isUnreadOnly('') ? 'unread' : 'all',
  homeEntry: 'all',
  loading: false,
  loadingMore: false,
  revalidating: false,
  refreshResult: null,
  newInView: 0,
  refreshPhase: 'idle',
  hasRefreshToken: false,
  pendingActions: 0,
  failedActions: 0,
  searchQuery: '',
  searchResults: [],
  searchVisible: PAGE_SIZE,
  searchScan: { ...IDLE_SCAN },
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

  // Toggle the "unread only" reading mode. Where the choice is stored depends
  // on the scope (Preferences → General): per feed, for the CURRENT feed/label
  // only; all feeds, one state for every view. Synced, survives reloads.
  setUnreadFilter: (on) => {
    const ui = useUiStore.getState();
    if (ui.unreadOnlyScope === 'all') ui.setUnreadOnlyAll(on);
    else ui.setFeedUnreadOnly(get().selectedFeed?.id ?? '', on);
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
    const f = filter ?? (isUnreadOnly(feed?.id ?? '') ? 'unread' : 'all');
    const c = memGet(viewKey(feed ?? null, f));
    // Entrée d'accueil surlignée (`homeEntryActive`) : « Non lus » seulement
    // quand la vue non lus est DEMANDÉE ; toute autre vue d'accueil relève de
    // « Tous les flux ». Ouvrir un flux ne la change pas.
    const homeEntry: HomeEntry = feed ? get().homeEntry : filter === 'unread' ? 'unread' : 'all';
    set({ selectedFeed: feed ?? null, filter: f, homeEntry, articles: c?.articles || [], continuation: c?.continuation || null, selectedArticle: null });
    get().loadArticles();
  },

  // Entrée « Tous les flux ». Par flux, elle montre tout, comme avant. En
  // portée « Tous les flux », elle suit l'état global : sans filtre explicite,
  // `selectView` résout par `isUnreadOnly('')`.
  selectHomeAll: () => {
    get().selectView(null, useUiStore.getState().unreadOnlyScope === 'all' ? undefined : 'all');
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
    bumpCountsEpoch(); // écriture locale — voir la garde en tête de fichier
    memMarkRead(article.id, true);
    persistCurrentView(get);
    // Fire-and-forget; revert if the server call fails.
    // NOTE: reading an article goes through here, NOT through toggleRead —
    // this is the path that must survive being offline.
    readWritesInFlight++; // Important 1 — voir la garde en tête de fichier
    markAsRead(article.id).catch((err) => {
      // No network: keep it read and replay later. Only a refusal is reverted.
      if (isNetworkFailure(err)) {
        enqueueAction(set, article.id, 'read', true);
        return;
      }
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
      bumpCountsEpoch(); // écriture locale (rollback) — voir la garde en tête de fichier
      memMarkRead(article.id, false);
      persistCurrentView(get);
    }).finally(() => {
      readWritesInFlight--;
      bumpCountsEpoch(); // règlement (succès ou échec) — voir Important 1 en tête de fichier
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
      // `applyZeroFloor` ci-dessus a pu noter des flux dont le plancher zéro
      // vient d'expirer (`zeroFloorJustExpired`) : seul `syncCounts` sait
      // quoi en faire (les exclure d'un décompte d'arrivées) ; ici, personne
      // ne le consommera jamais. Le vider évite qu'un `syncCounts` ultérieur
      // n'exclue à tort un flux dont le saut à son vrai compte remonte à ce
      // chargement des abonnements, pas à son propre relevé.
      zeroFloorJustExpired.clear();
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
    const filter: Filter = isUnreadOnly(feed.id) ? 'unread' : 'all';
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
    bumpCountsEpoch(); // une vue qui repart de zéro n'est pas une arrivée
    const { selectedFeed, filter } = get();
    const key = viewKey(selectedFeed, filter);
    const sameView = () => viewKey(get().selectedFeed, get().filter) === key;
    const cached = memGet(key);
    // Memory cache already painted (set by the select action) → no spinner.
    // `revalidating` covers the gap this leaves: the request below (2.) stays
    // in flight until it resolves, whether or not `cached` was set.
    // La liste repart du serveur : ce qui était signalé comme nouveau y sera.
    set({ loading: !cached, revalidating: true, newInView: 0 });

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
      if (!result) { set({ loading: false, revalidating: false }); return; }
      const articles = result.items.map(normalizeArticle);
      memSet(key, { articles, continuation: result.continuation });
      listPut(key, articles, result.continuation).catch(() => {}); // persist for offline
      warmExtracts(articles, viewIdentity(get())); // background: extract the whole page for offline
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
        return { articles, continuation: result.continuation, loading: false, revalidating: false, feedErrors: newErrors, unreadCounts };
      });
    } catch (err) {
      if (!sameView()) return;
      // Offline fallback: serve the persisted list so reading still works.
      const persisted = await listGet(key);
      if (persisted && sameView()) {
        memSet(key, { articles: persisted.articles, continuation: persisted.continuation });
        set({ articles: persisted.articles, continuation: persisted.continuation, loading: false, revalidating: false });
        return;
      }
      console.error('[FriRSS] loadArticles error:', err);
      set((state) => ({
        loading: false,
        revalidating: false,
        feedErrors: selectedFeed
          ? { ...state.feedErrors, [selectedFeed.id]: Date.now() }
          : state.feedErrors,
      }));
    }
  },

  loadMore: async () => {
    // Une recherche est déjà entièrement en mémoire : paginer, c'est montrer
    // la tranche suivante. Plus aucun appel réseau — c'est ce chemin qui
    // appendait autrefois le flux nu sous une boîte de recherche remplie.
    // `continuation` n'a plus aucun sens ici : la garde plus bas ne la
    // consulte donc jamais pour une recherche.
    if (get().searchQuery) { get().showMoreSearchResults(); return; }

    const { continuation, selectedFeed, filter, loadingMore, revalidating } = get();
    if (!canLoadMore({ hasContinuation: !!continuation, loadingMore, revalidating })) return;
    // La vue POUR LAQUELLE cette page est demandée, retenue avant la requête.
    // Sans elle, une page arrivée après un changement de flux abîmait deux
    // choses d'un coup : `state.articles` étant la NOUVELLE liste, la page de
    // l'ancienne vue lui était appendue ; et cette liste mélangée était écrite
    // dans les caches sous la clé de l'ANCIENNE vue, donc la corruption
    // survivait au rechargement. `viewIdentity` couvre le flux, le filtre et
    // la recherche — les trois choses qui changent la liste à l'écran.
    const view = viewIdentity(get());
    set({ loadingMore: true });

    try {
      const result = await fetchArticleStream(filter, selectedFeed, PAGE_SIZE, continuation);
      // La vue a changé pendant l'aller-retour : cette page n'appartient plus
      // à rien de ce qui est affiché. On la jette entièrement — pas d'ajout,
      // pas d'écriture de cache, pas de `continuation` — et on rend la main.
      if (viewIdentity(get()) !== view) { set({ loadingMore: false }); return; }
      if (!result) { set({ loadingMore: false }); return; }

      set((state) => {
        const articles = [...state.articles, ...result.items.map(normalizeArticle)];
        const key = viewKey(selectedFeed, filter);
        memSet(key, { articles, continuation: result.continuation });
        listPut(key, articles, result.continuation).catch(() => {}); // persist extended list
        return { articles, continuation: result.continuation, loadingMore: false };
      });
      // Même vue qu'à l'ouverture : ces articles s'ajoutent au travail en
      // cours au lieu de l'annuler (voir `src/lib/warmSchedule.ts`).
      warmExtracts(get().articles, viewIdentity(get())); // background: extract newly loaded pages for offline

      // Le clic a-t-il changé quoi que ce soit à l'écran ? Les favoris d'un
      // flux sont filtrés CÔTÉ CLIENT (voir `fetchArticleStream` ci-dessus) :
      // une page peut légitimement ne rendre AUCUNE ligne. Sans un mot pour
      // le dire, des clics répétés repeignent le même écran vide et le
      // bouton a l'air cassé.
      if (shouldReportInvisibleProgress({ itemsAdded: result.items.length, hasMore: result.continuation != null })) {
        await pushI18nToast('toast.loadMoreEmpty');
      }
    } catch {
      set({ loadingMore: false });
      // Le `catch` se contentait de remettre `loadingMore` à faux : sur un
      // échec réseau/serveur, le bouton reprenait son état de départ sans un
      // mot nulle part. Réutilise le mécanisme de toast existant et un
      // message d'erreur déjà traduit plutôt que d'en inventer un nouveau.
      await pushI18nToast('sidebar.loadError', { tone: 'error' });
    }
  },

  toggleRead: async (article, opts) => {
    const newRead = !article.read;
    // Une seule page de rattrapage, décidée au moment du retrait et exécutée
    // APRÈS le `try` : un geste ⇒ au plus une requête, sans effet React pour
    // la relancer (voir `src/lib/listTopUp.ts` pour les deux emballements que
    // cette forme interdit).
    let topUp = false;
    // Le retrait de la LIGNE est optimiste, comme le drapeau `read` : attendre
    // la confirmation faisait payer à l'utilisateur l'aller-retour vers
    // FreshRSS — instantané quand il répond vite, plusieurs secondes sinon.
    // Ce qu'il en coûte est assumé plus bas : le rollback doit savoir remettre
    // une ligne déjà partie — sa place est recalculée par `planRowRestore()`,
    // qui s'abstient si la vue a changé ou si l'article est déjà revenu.
    const leaving = shouldLeaveList({
      becameRead: newRead,
      filter: get().filter,
      implicit: opts?.implicit ?? false,
      selected: get().selectedArticle?.id === article.id,
    });
    // Ce que le rollback retient du retrait : la ligne elle-même, la VUE d'où
    // elle vient, et le voisin qu'elle avait au-dessus. Pas son index — entre
    // le retrait et un refus, la liste peut avoir changé de flux, avoir été
    // remplacée par un rafraîchissement, ou avoir perdu d'autres lignes ; un
    // index ne survit à aucun des trois (`src/lib/rollbackRow.ts`).
    const removedIndex = leaving ? get().articles.findIndex((a) => a.id === article.id) : -1;
    const removedRow = removedIndex >= 0 ? get().articles[removedIndex] : null;
    const removedPreviousId = removedIndex > 0 ? get().articles[removedIndex - 1].id : null;
    const removedView = viewIdentity(get());
    // Optimistic update — instant UI feedback
    set((state) => {
      const updated = state.articles.map((a) =>
        a.id === article.id ? { ...a, read: newRead } : a
      );
      return {
        articles: leaving ? updated.filter((a) => a.id !== article.id) : updated,
        selectedArticle:
          state.selectedArticle?.id === article.id
            ? { ...state.selectedArticle, read: newRead }
            : state.selectedArticle,
        unreadCounts: updateCount(state.unreadCounts, article, newRead ? -1 : 1),
      };
    });
    bumpCountsEpoch(); // écriture locale — voir la garde en tête de fichier
    memMarkRead(article.id, newRead);
    persistCurrentView(get);
    try {
      // Important 1 (deuxième re-revue) : posé AVANT l'appel réseau, levé
      // dans le `finally` qui suit — que l'appel réussisse ou échoue. Un
      // relevé qui capture ce drapeau avant son propre aller-retour sait
      // qu'une écriture est en vol, même si l'epoch (posé plus haut) ne
      // bouge plus d'ici là. Voir la garde en tête de fichier.
      readWritesInFlight++;
      try {
        if (newRead) {
          await markAsRead(article.id);
        } else {
          await markAsUnread(article.id);
        }
      } finally {
        readWritesInFlight--;
        bumpCountsEpoch(); // règlement (succès ou échec)
      }
      // La purge du cache MÉMOIRE des vues attend la confirmation : c'est le
      // seul cache qu'un refus n'a alors rien à défaire, la ligne réinsérée y
      // étant toujours. (Le cache durable, lui, est déjà réécrit d'avance par
      // le `persistCurrentView` ci-dessus.) Le chemin HORS LIGNE, qui garde la
      // ligne retirée, doit donc purger de son côté — voir le `catch`.
      if (leaving) {
        memRemoveFromViews(article.id, 'unread');
        persistCurrentView(get);
        // Ce qui reste peut désormais tenir tout entier dans la fenêtre : plus
        // rien ne défile, aucun `scroll` n'est émis, et la pagination
        // s'arrêterait là avec une `continuation` pourtant non nulle. Le
        // critère est bien le débordement, mesuré par la liste elle-même
        // (`src/lib/listOverflow.ts`) — un nombre de lignes restantes ne veut
        // rien dire d'un écran à l'autre.
        const s = get();
        topUp = shouldTopUpAfterRemoval({
          listCanScroll: listCanScroll(),
          hasContinuation: s.continuation != null,
          loadingMore: s.loadingMore,
          searching: !!s.searchQuery,
        });
      }
    } catch (err) {
      // No network: keep the optimistic state and replay it later. Only a
      // server refusal is rolled back.
      if (isNetworkFailure(err)) {
        // La ligne RESTE retirée : l'état optimiste est celui qu'`enqueueAction`
        // rejouera. La remettre contredirait la file d'attente. Le cache
        // mémoire doit donc suivre, sans quoi quitter la vue et y revenir la
        // repeint — marquée LUE, sous « Non lus », sans spinner et sans limite
        // de temps. C'est le symptôme exact de l'issue #10, par le seul chemin
        // qui ne purgeait pas.
        if (leaving) memRemoveFromViews(article.id, 'unread');
        await enqueueAction(set, article.id, 'read', newRead);
        // La ligne reste partie alors que RIEN n'a été écrit. Hors ligne, le
        // bandeau global suffit ; en ligne — un 5xx de FreshRSS, une requête
        // restée sans réponse — plus rien ne le signalait.
        await notifyWriteFailure(err);
        return;
      }
      // Rollback sur refus du serveur : tout est rendu, la ligne comprise —
      // mais seulement si la liste à l'écran est encore la sienne et qu'elle
      // n'y est pas déjà revenue. `planRowRestore` tranche, et recalcule la
      // place sur la liste TELLE QU'ELLE EST.
      const plan = removedRow
        ? planRowRestore({
            row: removedRow,
            articles: get().articles,
            viewAtRemoval: removedView,
            viewNow: viewIdentity(get()),
            previousId: removedPreviousId,
          })
        : null;
      set((state) => {
        const articles = plan?.insert
          ? [...state.articles.slice(0, plan.index), removedRow!, ...state.articles.slice(plan.index)]
          : state.articles.map((a) => (a.id === article.id ? { ...a, read: !newRead } : a));
        return {
          articles,
          selectedArticle:
            state.selectedArticle?.id === article.id
              ? { ...state.selectedArticle, read: !newRead }
              : state.selectedArticle,
          unreadCounts: updateCount(state.unreadCounts, article, newRead ? 1 : -1),
        };
      });
      bumpCountsEpoch(); // écriture locale (rollback) — voir la garde en tête de fichier
      memMarkRead(article.id, !newRead);
      persistCurrentView(get);
      // Le rollback rend la ligne et le compteur, mais une ligne qui
      // réapparaît toute seule est incompréhensible : il faut la commenter.
      await notifyWriteFailure(err);
    }
    // Hors du `try` : une page de rattrapage en échec ne doit jamais être
    // confondue avec un marquage refusé, et ne déclenche RIEN d'autre.
    // `loadMore` avale ses propres erreurs — un échec s'arrête ici.
    if (topUp) await get().loadMore();
  },

  toggleStar: async (article) => {
    const newStarred = !article.starred;
    // Retirer le favori depuis la vue Favoris NE SORT PAS l'article de la
    // liste ; la vue se réconcilie au rechargement.
    //
    // Depuis 2026-09-01, `toggleRead` retire la ligne sous le filtre non-lus
    // (issue #10) : l'alignement invoqué ici ne tient donc plus, et c'est
    // assumé. La règle n'est pas « tous les sites d'écriture se ressemblent »
    // mais « une mise à l'écart explicite retire, sous le filtre qu'elle
    // concerne ». Personne n'a demandé ce comportement pour les favoris, et
    // l'y étendre coûterait le même soin : retrait après confirmation
    // seulement, sans quoi le rollback ci-dessous — un simple `.map()` —
    // laisserait l'article hors de l'écran tout en le gardant favori.
    //
    // Ce retrait venait du commit initial, sans décision consignée, et il
    // coûtait cher : le rollback ne pouvait pas remettre une ligne déjà
    // retirée, donc un refus du serveur faisait disparaître l'article de
    // l'écran alors qu'il restait en favori côté FreshRSS — avec un compteur
    // correctement restauré annonçant « 1 favori » au-dessus d'une liste vide.
    // Optimistic update — instant UI feedback
    set((state) => ({
      articles: state.articles.map((a) =>
        a.id === article.id ? { ...a, starred: newStarred } : a
      ),
      selectedArticle:
        state.selectedArticle?.id === article.id
          ? { ...state.selectedArticle, starred: newStarred }
          : state.selectedArticle,
      starredCount: Math.max(0, state.starredCount + (newStarred ? 1 : -1)),
    }));
    persistCurrentView(get);
    try {
      if (newStarred) {
        await markAsStarred(article.id);
      } else {
        await removeStarred(article.id);
      }
    } catch (err) {
      // No network: keep the optimistic state and replay it later. Only a
      // server refusal is rolled back.
      if (isNetworkFailure(err)) {
        await enqueueAction(set, article.id, 'star', newStarred);
        return;
      }
      // Rollback on failure — un simple `.map()` suffit désormais : plus rien
      // n'est retiré de la liste, il n'y a donc jamais de ligne à réinsérer.
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
      persistCurrentView(get);
    }
  },

  // Search — balaye le périmètre courant page par page (`runScan`, plus bas
  // dans ce fichier) et filtre au passage. Voir
  // docs/superpowers/specs/2026-09-23-client-side-search-design.md.
  search: async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      scanToken++; // périme un balayage en vol
      set({ searchQuery: '', searchResults: [], searchVisible: PAGE_SIZE, searchScan: { ...IDLE_SCAN } });
      return get().loadArticles();
    }
    const { selectedFeed, filter } = get();
    const streamId = resolveSearchStreamId(selectedFeed, filter);
    const serverId = String(useAuthStore.getState().activeServerId ?? '');
    scanTerms = parseQuery(trimmed);
    const token = ++scanToken;

    // Une recherche repart d'une liste neuve : la pastille de la vue qu'elle
    // recouvre ne doit pas flotter au-dessus des résultats. `continuation`
    // appartenait à la vue nue qu'on quitte ; la laisser pendrait la
    // pagination locale des résultats à celle, périmée, du flux brut.
    set({ searchQuery: trimmed, newInView: 0, searchVisible: PAGE_SIZE, loading: false, continuation: null });

    if (corpusIsUsable(searchCorpus, streamId, serverId, Date.now())) {
      const hits = corpusMatches(searchCorpus as Corpus, scanTerms);
      set({
        searchResults: hits,
        articles: hits.slice(0, PAGE_SIZE),
        searchScan: { running: false, scanned: (searchCorpus as Corpus).entries.length, done: true, stopped: false, error: null },
      });
      return;
    }

    searchCorpus = createCorpus(streamId, serverId, Date.now());
    set({
      searchResults: [],
      articles: [],
      searchScan: { running: true, scanned: 0, done: false, stopped: false, error: null },
    });
    await runScan(token, streamId, viewIdentity(get()));
  },

  stopSearch: () => {
    scanToken++;
    set((s) => ({ searchScan: { ...s.searchScan, running: false, stopped: true } }));
  },

  retrySearch: async () => {
    const { selectedFeed, filter } = get();
    const streamId = resolveSearchStreamId(selectedFeed, filter);
    const serverId = String(useAuthStore.getState().activeServerId ?? '');
    // Le corpus gardé peut appartenir à un autre périmètre que celui d'à
    // présent (flux ou serveur changés pendant la panne) : sa continuation ne
    // veut alors plus rien dire pour le flux courant. Repartir d'une
    // recherche neuve plutôt que de mélanger deux flux sous une même étiquette.
    if (!searchCorpus || searchCorpus.streamId !== streamId || searchCorpus.serverId !== serverId) {
      return get().search(get().searchQuery);
    }
    const token = ++scanToken;
    set((s) => ({ searchScan: { ...s.searchScan, running: true, stopped: false, error: null } }));
    await runScan(token, streamId, viewIdentity(get()));
  },

  showMoreSearchResults: () => set((s) => {
    // Ne jamais reculer : si `searchResults` est momentanément plus court que
    // `searchVisible` (une tranche vidée par une dédup en cours de balayage),
    // `Math.min` seul ferait chuter la tranche affichée — et avec elle, tout
    // ce qui avait déjà été montré.
    const visible = Math.max(s.searchVisible, Math.min(s.searchVisible + PAGE_SIZE, s.searchResults.length));
    return { searchVisible: visible, articles: s.searchResults.slice(0, visible) };
  }),

  clearSearch: () => {
    // Referme la recherche comme le ferait une requête blanche : périme un
    // balayage en vol et vide les résultats, sinon une page qui arrive après
    // coup continuerait d'écrire dans `articles`.
    scanToken++;
    set({ searchQuery: '', searchResults: [], searchVisible: PAGE_SIZE, searchScan: { ...IDLE_SCAN } });
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
      bumpCountsEpoch(); // écriture locale — voir la garde en tête de fichier
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
    // L'optimisme s'arrête à l'étiquette et au compteur : la LIGNE, elle, ne
    // part qu'après confirmation du serveur (voir plus bas). Le retrait était
    // optimiste, et le rollback n'est qu'un `.map()` : incapable de remettre
    // une ligne déjà sortie du tableau. Un refus laissait donc `articles: []`
    // au-dessus d'un `readLaterCount: 1` — un élément compté sans ligne, et
    // l'étiquette toujours en place côté FreshRSS. C'est le défaut corrigé sur
    // `toggleStar` en 1.4.4, réglé ici de la même façon que sur `toggleRead`.
    // Optimistic update — instant UI feedback
    set((state) => {
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
    persistCurrentView(get);
    try {
      await setArticleLabel(article.id, READ_LATER_LABEL, !hasLabel);
      // Le retrait vient APRÈS la confirmation, jamais avant : le rollback
      // ci-dessous ne fait qu'un `.map()` et ne saurait pas remettre une ligne
      // déjà sortie de la liste.
      if (removing && get().filter === 'readlater') {
        set((state) => ({
          articles: state.articles.filter((a) => a.id !== article.id),
          selectedArticle:
            state.selectedArticle?.id === article.id ? null : state.selectedArticle,
        }));
        // Le cache mémoire des vues aussi, sans quoi quitter « À lire plus
        // tard » puis y revenir repeint la ligne retirée depuis `memGet`.
        memRemoveFromViews(article.id, 'readlater');
        persistCurrentView(get);
      }
    } catch (err) {
      // No network: keep the optimistic state and replay it later. Only a
      // server refusal is rolled back.
      if (isNetworkFailure(err)) {
        await enqueueAction(set, article.id, 'readLater', !hasLabel);
        return;
      }
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
      persistCurrentView(get);
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
      // No network: keep the optimistic state and replay it later. Only a
      // server refusal is rolled back.
      if (isNetworkFailure(err)) {
        await enqueueAction(set, article.id, 'label', !hasLabel, labelId);
        return;
      }
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
  // ── Catégories de flux ────────────────────────────────────────────
  // Une catégorie n'est pas un objet stocké : elle n'existe que portée par les
  // flux. Ces trois actions rechargent donc les abonnements plutôt que de
  // rapiécer l'état local — le serveur est la seule source qui sache ce qui
  // reste après un renommage ou une suppression.
  renameCategory: async (categoryId, newName) => {
    const name = newName.trim();
    if (!isValidCategoryName(name)) return false;
    try {
      await renameTag(categoryId, `user/-/label/${name}`);
      await get().loadSubscriptions();
      return true;
    } catch {
      return false;
    }
  },

  deleteCategory: async (categoryId) => {
    try {
      await deleteTag(categoryId);
      // Les flux ne sont PAS supprimés : ils se retrouvent sans catégorie.
      await get().loadSubscriptions();
      return true;
    } catch {
      return false;
    }
  },

  moveFeedToCategory: async (feedId, categoryName) => {
    const name = categoryName.trim();
    if (!isValidCategoryName(name)) return false;
    try {
      // `editFeed` envoie `a=` (ajouter à la catégorie). FreshRSS n'accorde
      // qu'une catégorie par flux, donc cela vaut déplacement — mais on
      // recharge derrière plutôt que de le supposer : si le serveur en décidait
      // autrement, l'interface montrerait la réalité et non une promesse.
      await editFeed(feedId, undefined, `user/-/label/${name}`, name);
      await get().loadSubscriptions();
      return true;
    } catch {
      return false;
    }
  },

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
    // Pris AVANT l'attente réseau : comparés à leur valeur après, ils disent
    // si l'app a écrit `unreadCounts` (ou changé de serveur) pendant le vol —
    // voir la garde en tête de fichier.
    const epoch = countsEpoch;
    const serverId = useAuthStore.getState().activeServerId;
    // Important 1 (deuxième re-revue) : un ✓/non-lu déjà en vol AU DÉMARRAGE
    // de ce relevé a déjà bougé `unreadCounts` et déjà bumpé l'epoch — cette
    // comparaison avant/après n'y verra donc AUCUN écart si l'écriture ne se
    // règle pas pendant l'attente ci-dessous. Seul ce drapeau, lu ici, le
    // sait encore.
    const writeWasInFlight = readWritesInFlight > 0;
    try {
      const counts = await getUnreadCounts();
      // Ce relevé appartient au serveur sur lequel il a démarré : un autre est
      // actif entre-temps, ses compteurs décriraient un monde différent.
      // Fix 3 (revue finale) — rien n'est touché, pas même `unreadCounts`. Les
      // deux drapeaux module-level sont vidés ici : ils décrivaient un état
      // (planchers zéro expirés, file changée) qui appartient lui aussi au
      // serveur qu'on vient de quitter — `resetAndReload` les videra encore
      // à l'arrivée sur le nouveau, mais rien ne doit rester d'ici là.
      if (String(useAuthStore.getState().activeServerId) !== String(serverId)) {
        zeroFloorJustExpired.clear();
        skipNextArrivals = false;
        return;
      }
      const countMap: Record<string, number> = {};
      counts.forEach((c) => { countMap[c.id] = c.count; });
      const next = applyZeroFloor(countMap);
      // Pastille « nouveaux articles » (discussion #14) : seules les HAUSSES des
      // flux de la vue affichée comptent. Une action locale a déjà mis le
      // compteur à jour, elle ne produit donc aucune hausse ici. Sans compteur
      // connu (premier relevé), rien n'est compté : tout le stock passerait
      // pour une arrivée.
      const { selectedFeed, filter, searchQuery, subscriptions, unreadCounts } = get();
      const feedIds = viewFeedIds(
        { feedId: selectedFeed?.id ?? null, filter, searching: !!searchQuery },
        subscriptions,
      );
      // Fix 2 (revue finale, corrigée aux contrôles du 2026-09-17) : ce
      // relevé ne compte AUCUNE arrivée si quelque chose a pu le fausser —
      // une écriture locale pendant son vol (`countsEpoch` a changé), une
      // écriture ✓/non-lu déjà en vol à son démarrage (`writeWasInFlight`,
      // Important 1 — l'epoch seul ne le voit pas si l'écriture ne se règle
      // pas pendant l'attente), un rejeu hors-ligne en cours, un
      // rafraîchissement manuel (qui a son propre bandeau et se termine par
      // `loadArticles`), ou une action mise en file/abandonnée depuis le
      // relevé précédent (`skipNextArrivals`, consommée ici).
      //
      // `pendingActions > 0` a été RETIRÉ : `replayQueue` ne tourne qu'au
      // montage de l'app et sur l'événement `online` (`App.tsx`), donc une
      // seule action mise en file (un 5xx transitoire, par exemple) aurait
      // masqué la pastille pour toute la session — bien après que ce relevé
      // ait déjà écrasé le compte local par celui du serveur. Seul LE relevé
      // qui suit la mise en file doit l'ignorer ; `skipNextArrivals` (posé
      // par `enqueueAction`) le fait déjà et se consomme en un seul coup.
      const skipThisPoll = epoch !== countsEpoch
        || writeWasInFlight
        || replayInFlight !== null
        || get().refreshPhase === 'running'
        || skipNextArrivals;
      if (skipNextArrivals) skipNextArrivals = false;
      let arrived = 0;
      if (!skipThisPoll && feedIds && Object.keys(unreadCounts).length) {
        const newByFeed = { ...computeRefreshDelta(unreadCounts, next).newByFeed };
        // Un flux qui vient de quitter son plancher zéro saute de 0 à son
        // vrai compte : ce n'est pas une arrivée.
        for (const id of zeroFloorJustExpired) delete newByFeed[id];
        arrived = countNewInView(newByFeed, feedIds);
      }
      zeroFloorJustExpired.clear();
      set((s) => ({ unreadCounts: next, newInView: s.newInView + arrived }));
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
    // La vue affichée au moment de la requête — comme `loadArticles` avec
    // `sameView()`. Sans ce garde-fou (M2, revue finale), un résultat qui
    // arrive après un changement de vue écrirait `articles` et remettrait
    // `newInView` à zéro pour une vue qui n'est plus à l'écran.
    const key = viewKey(selectedFeed, filter);
    try {
      const result = await fetchArticleStream(filter, selectedFeed, PAGE_SIZE, null);
      if (!result) return;
      if (viewKey(get().selectedFeed, get().filter) !== key) return;
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
          // La liste vient d'être rechargée : plus rien de nouveau à signaler.
          newInView: 0,
        };
      });
    } catch { /* ignore */ }
  },

  loadNewArticles: async () => {
    set({ newInView: 0 });
    await get().loadArticles();
  },

  setHasRefreshToken: (v: boolean) => set({ hasRefreshToken: v }),

  refresh: async () => {
    if (get().refreshPhase === 'running') return;
    set({ refreshPhase: 'idle' });

    // Snapshot per-feed unread counts before the reload, so we can report how
    // many new articles arrived and in which feeds (see RefreshBanner + pulse).
    const before = { ...get().unreadCounts };

    const serverId = useAuthStore.getState().activeServerId;
    const wantsReal = shouldTriggerRealRefresh(get().hasRefreshToken, serverId);

    if (!wantsReal) {
      // Read-only sync: exactly the pre-existing behaviour.
      await get().loadSubscriptions();
      await get().loadArticles();
      const { totalNew, newByFeed } = computeRefreshDelta(before, get().unreadCounts);
      set({ refreshResult: { totalNew, newByFeed, at: Date.now() } });
      return;
    }

    // startActualize returns null for a 409 and ONLY for a 409. A 500, an
    // expired JWT or a dropped connection must not be read as "no token
    // configured": clearing the flag there would silently disable the feature
    // for the rest of the session and put the "enable refreshing" hint in front
    // of someone who configured it long ago.
    let job: ActualizeJob | null = null;
    let noToken = false;
    try {
      job = await startActualize(Number(serverId));
      noToken = job === null;
    } catch {
      job = null; // transient failure — this attempt degrades, the flag stands
    }

    if (!job) {
      if (noToken) set({ hasRefreshToken: false });
      // Fall back to a plain sync rather than leaving the user with nothing.
      await get().loadSubscriptions();
      await get().loadArticles();
      const { totalNew, newByFeed } = computeRefreshDelta(before, get().unreadCounts);
      set({ refreshResult: { totalNew, newByFeed, at: Date.now() } });
      return;
    }

    const startedAt = Date.now();
    set({ refreshPhase: 'running' });

    // A refresh belongs to the server it was started on. If the user switches
    // servers mid-flight, `before` (old server) and the live counters (new
    // server) describe different worlds, so any delta computed from them is
    // fiction. Abandon instead: resetAndReload() owns the state from then on.
    const stillActive = () =>
      String(useAuthStore.getState().activeServerId) === String(serverId);

    let phase: RefreshPhase = 'running';
    while (phase === 'running') {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (!stillActive()) return;
      // Counters AND list: silentRefresh does both, which is what actually
      // makes new articles appear as they land (and it already handles not
      // yanking the article being read out from under the reader). But
      // silentRefresh always fetches page 1 and replaces `articles` wholesale
      // — fine once, corrosive every 3s for up to 10 minutes if the user has
      // paged deeper via loadMore(): their scroll position keeps getting
      // yanked back to a 50-item list. Only run it while they're still on
      // page 1; otherwise just keep the counters (and thus the pulse/banner)
      // live and leave their list alone.
      if (get().articles.length <= PAGE_SIZE) {
        await get().silentRefresh();
      } else {
        await get().syncCounts();
      }
      if (!stillActive()) return;
      const status = await getActualizeStatus(Number(serverId)).catch(() => null);
      if (!stillActive()) return;
      phase = nextPhase(status?.status, startedAt, Date.now());
      set({
        refreshPhase: phase,
        refreshResult: {
          ...computeRefreshDelta(before, get().unreadCounts),
          at: Date.now(),
        },
      });
    }

    // Final load once the job resolved, so the visible list matches the counters.
    await get().loadSubscriptions();
    await get().loadArticles();
    if (!stillActive()) return;
    const { totalNew, newByFeed } = computeRefreshDelta(before, get().unreadCounts);
    set({ refreshResult: { totalNew, newByFeed, at: Date.now() }, refreshPhase: phase });
  },

  replayQueue: async () => {
    if (replayInFlight) return replayInFlight;
    const run = (async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const queue = await loadQueue();
    if (!queue.length) return;

    const remaining: QueuedAction[] = [];
    let failed = 0;
    for (const action of queue) {
      try {
        if (action.type === 'read') {
          await (action.value ? markAsRead(action.articleId) : markAsUnread(action.articleId));
        } else if (action.type === 'star') {
          await (action.value ? markAsStarred(action.articleId) : removeStarred(action.articleId));
        } else if (action.type === 'readLater') {
          await setArticleLabel(action.articleId, READ_LATER_LABEL, action.value);
        } else if (action.type === 'label' && action.labelId) {
          await setArticleLabel(action.articleId, action.labelId, action.value);
        }
      } catch (err) {
        const attempts = action.attempts + 1;
        // A refusal will never succeed; only keep what is worth retrying.
        if (isNetworkFailure(err) && shouldRetry(attempts)) remaining.push({ ...action, attempts });
        else failed++;
      }
    }

    // Une action abandonnée — refusée par le serveur OU rejetée après trop
    // d'échecs, les deux tombent dans `failed` ci-dessus — laisse un ✓ local
    // sans correspondant côté serveur : le prochain relevé de compteurs le
    // lirait comme une arrivée qui ne s'efface jamais.
    if (failed > 0) skipNextArrivals = true;
    actionQueue = remaining;
    await queuePut(remaining);
    set({ pendingActions: remaining.length, failedActions: failed });
    })();
    replayInFlight = run;
    try {
      await run;
    } finally {
      replayInFlight = null;
    }
  },

  clearRefreshResult: () => set({ refreshResult: null }),

  // Full reset + reload — used when switching the active FreshRSS server
  resetAndReload: () => {
    // The CSRF write-token is per-server; drop the cached one so the next
    // write fetches a fresh token for the newly-active FreshRSS instance.
    clearWriteToken();
    warmListsToken++; // cancel any in-flight prefetch sweep for the old server
    memClear(); // memory cache is per-server (feed ids/global keys differ)
    // Pastille « nouveaux articles » : les deux drapeaux module-level de
    // `syncCounts` décrivent un état (plancher zéro expiré, écriture/file en
    // cours) qui appartenait au serveur qu'on quitte. `syncCounts` les vide
    // déjà s'il constate le changement en plein vol (Fix 3) ; ici pour le cas
    // où aucun relevé n'était en vol au moment du changement.
    zeroFloorJustExpired.clear();
    skipNextArrivals = false;
    // Le corpus balayé décrit un autre monde une fois le serveur changé —
    // même garde que ci-dessus, pour la recherche.
    dropSearchCorpus();
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
      revalidating: false,
      searchQuery: '',
      searchResults: [],
      searchVisible: PAGE_SIZE,
      searchScan: { ...IDLE_SCAN },
      labels: [],
      labelCounts: {},
      categoryIds: [],
      starredCount: 0,
      readLaterCount: 0,
      feedErrors: {},
      // A refresh in flight belongs to the server we are leaving; its loop
      // abandons itself. Clear its state here so the banner doesn't stay
      // pinned on the new server and the re-entrancy guard doesn't wedge the
      // Refresh button shut.
      refreshPhase: 'idle',
      refreshResult: null,
    });
    get().loadSubscriptions();
    get().loadArticles();
  },
}));

/**
 * Balaye le périmètre page par page et filtre au passage.
 *
 * Séquentiel par nature : chaque page porte la continuation de la suivante. Les
 * résultats sont poussés à chaque tranche — une recherche qui n'a rien trouvé et
 * une recherche qui n'a pas fini se ressemblent trop pour attendre la fin.
 *
 * `view` est l'identité de la vue (`viewIdentity`) retenue à l'entrée : ni
 * `selectFeed`, ni `selectView`, ni `setFilter`, ni `selectCategory` ne
 * touchent `scanToken` ou le corpus, donc une page arrivée après un de ces
 * changements passerait la garde du jeton et écrirait les articles de
 * l'ancien flux dans la nouvelle vue. Revérifiée après CHAQUE `await`, comme
 * dans `loadMore`.
 */
async function runScan(token: number, streamId: string, view: string): Promise<void> {
  const stale = () =>
    token !== scanToken || !searchCorpus || viewIdentity(useFeedStore.getState()) !== view;
  try {
    for (;;) {
      if (stale()) return;
      const result = await fetchStreamPage(streamId, SCAN_PAGE, searchCorpus!.continuation);
      if (stale()) return;
      const entries = result.items.map((item) => {
        const article = normalizeArticle(item);
        return { article, haystack: articleHaystack(article) };
      });
      searchCorpus = addPage(searchCorpus!, entries, result.continuation, Date.now());
      const hits = corpusMatches(searchCorpus, scanTerms);
      const complete = searchCorpus.complete;
      const scanned = searchCorpus.entries.length;
      useFeedStore.setState((s) => ({
        searchResults: hits,
        articles: hits.slice(0, s.searchVisible),
        searchScan: { running: !complete, scanned, done: complete, stopped: false, error: null },
      }));
      if (complete) return;
    }
  } catch (err) {
    if (token !== scanToken || viewIdentity(useFeedStore.getState()) !== view) return;
    useFeedStore.setState({
      searchScan: {
        running: false,
        scanned: searchCorpus?.entries.length ?? 0,
        done: false,
        stopped: false,
        error: scanErrorKind(err),
      },
    });
  }
}

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
