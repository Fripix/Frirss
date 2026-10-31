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
  getUnreadItemIds,
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
  itemIdsNewerThanEntry, getStreamIdsSince, getItemsByIds,
} from '../api/feeds';
import { entryIdUsec, exclusiveOlderThanEntryId, isOlderEntry } from '../lib/entryId';
import { articleHaystack, parseQuery, matchesTerms } from '../lib/searchMatch';
import { scanErrorKind } from '../lib/scanError';
import {
  createCorpus, addPage, corpusIsUsable, corpusMatches, matchPage, newerEntries, prependEntries,
  patchCorpusArticle, patchCorpusByEntry, inEntryRange, applyArticlePatch, withLabel,
  type Corpus, type CorpusEntry, type ArticlePatch,
} from '../lib/searchCorpus';
import { canMarkAllRead } from '../lib/markAllRead';
import { useAuthStore } from './authStore';
import { jwtUserId } from '../lib/jwtUserId';
import { isBackendAuthFailure } from '../lib/loginErrors';
import { useUiStore, isUnreadOnly } from './uiStore';
import { effectiveOrder, type ArticleOrder } from '../lib/effectiveOrder';
import { effectiveAutoExtract } from '../lib/effectiveAutoExtract';
import { homeStreamId, mainStreamFeedIds, READING_LIST_STREAM } from '../lib/mainStream';
import type { HomeEntry } from '../lib/unreadScope';
import { peekExtract, getExtract, putExtract, pinExtract, unpinExtractsExcept } from '../lib/extractCache';
import { listGet, listPut, listsPatch, listEvictOlderThan, listsWithoutSource, subsGet, subsPut, queueGet, queuePut, clearOfflineViews } from '../lib/offlineStore';
import { computeRefreshDelta } from '../lib/refreshDelta';
import { countNewInView, viewFeedIds } from '../lib/newArticles';
import { isValidCategoryName } from '../lib/feedCategories';
import {
  actionKey, mergeAction, isNetworkFailure, shouldRetry,
  type QueuedAction, type QueuedActionType,
} from '../lib/actionQueue';
import { articleImageUrls, imageBudget, prioritizeForOffline } from '../lib/offlineImages';
import { getStorageEstimate } from '../lib/storageEstimate';
import { cacheImages, pruneImages } from '../lib/imageCache';
import { nextPhase, shouldTriggerRealRefresh, POLL_INTERVAL_MS, type RefreshPhase } from '../lib/refreshPolling';
import { shouldLeaveList } from '../lib/removeOnRead';
import { shouldTopUpAfterRemoval } from '../lib/listTopUp';
import { listCanScroll } from '../lib/listOverflow';
import { planRowRestore } from '../lib/rollbackRow';
import { writeFailureNotice } from '../lib/writeFailureNotice';
import { canLoadMore, shouldReportInvisibleProgress } from '../lib/listPagination';
import { createWarmRunner } from '../lib/warmSchedule';
import { startActualize, getActualizeStatus, type ActualizeJob } from '../api/backend';
import { fromFreshrssTitle, fromFreshrssName } from '../lib/freshrssText';
import { canRandomView, drawIds, inDrawOrder, randomCutoffUsec, randomViewKey, RANDOM_MAX_IDS } from '../lib/randomDraw';
import { createLocalWrites, applyField, type WriteField } from '../lib/localWrites';
import {
  viewListKey, viewListKeys, parseViewKey, preparedListKey, READ_LATER_LABEL, fallbackSources, offlineViewList, markStreamRead, PREPARED_MAX,
  type ViewAddress, type ViewList, type StoredView, type OfflineView, type OfflineSources,
} from '../lib/viewLists';
import type {
  Article,
  Subscription,
  FeedCategory,
  Tag,
  Filter,
  GReaderItem,
  GReaderStream,
} from '../types';

export { READ_LATER_LABEL };

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

/**
 * Le corpus n'appartient qu'au serveur qui l'a produit — et qu'à la session
 * FriRSS qui l'a balayé : il est aussi libéré à la déconnexion (abonnement à
 * `useAuthStore`, en bas de ce fichier), un autre compte pouvant ouvrir le
 * même navigateur.
 */
export function dropSearchCorpus(): void {
  searchCorpus = null;
  scanToken++;
}

/**
 * Répercute une écriture locale (lu, favori, à lire plus tard, étiquette) sur
 * le corpus gardé ET sur `searchResults` — le point unique pour les deux.
 * Sans le second, « Afficher plus » recopiait les résultats d'avant l'écriture
 * et une coche posée dans les résultats se défaisait à la tranche suivante.
 */
function patchSearchCorpus(id: string, patch: ArticlePatch): void {
  if (searchCorpus) searchCorpus = patchCorpusArticle(searchCorpus, id, patch);
  const { searchResults } = useFeedStore.getState();
  if (!searchResults.some((a) => a.id === id)) return;
  useFeedStore.setState((s) => ({
    searchResults: s.searchResults.map((a) => (a.id === id ? applyArticlePatch(a, patch) : a)),
  }));
}

/** Répercute un marquage de plage sur le corpus gardé, s'il y en a un, et sur ses résultats. */
function patchSearchCorpusByEntry(
  bound: { direction: 'above' | 'below'; articleId: string },
  patch: Partial<Article>,
  exclude?: (id: string) => boolean,
): void {
  if (!searchCorpus) return;
  searchCorpus = patchCorpusByEntry(searchCorpus, bound, patch, exclude);
  // Les résultats sont des articles du corpus : même critère, même exclusion.
  if (!useFeedStore.getState().searchResults.length) return;
  const touche = (id: string) => inEntryRange(bound, id) && !exclude?.(id);
  useFeedStore.setState((s) => ({
    searchResults: s.searchResults.map((a) => (touche(a.id) ? { ...a, ...patch } : a)),
  }));
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

/**
 * Même décision que `notifyWriteFailure`, pour un marquage de PLAGE
 * (`markReadRelative`) plutôt qu'une ligne : le refus ne se dit que si le
 * serveur a répondu, le hors-ligne véritable reste muet. Seul le texte
 * change — « ces articles » (`toast.markRangeFailed`), pas « cet article : sa
 * ligne a été remise », qui décrit le rollback d'une seule ligne.
 *
 * Le plafond du proxy (429, `FRIRSS_PROXY_RATE_LIMIT`) est écarté AVANT cette
 * décision : `writeFailureNotice` le rangerait sous « refus » (un 429 n'est
 * ni un 5xx ni une absence de réponse, donc `isNetworkFailure` dit faux), ce
 * qui mentirait deux fois — le serveur n'a pas refusé, il a demandé de
 * ralentir, et la plupart des lots ont déjà été acceptés au moment où il le
 * demande. `scanErrorKind` (`src/lib/scanError.ts`) porte déjà cette
 * distinction pour le balayage de recherche ; on la réutilise ici plutôt que
 * d'en écrire une deuxième.
 */
async function notifyRangeFailure(err: unknown): Promise<void> {
  if (scanErrorKind(err) === 'rate-limit') {
    await pushI18nToast('toast.markRangeThrottled', { tone: 'error' });
    return;
  }
  const notice = writeFailureNotice({
    networkFailure: isNetworkFailure(err),
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
  });
  if (!notice) return;
  await pushI18nToast(
    notice === 'refused' ? 'toast.markRangeFailed' : 'toast.markQueued',
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
  // The view's order travels with every page, including the SWR first paint:
  // the server cache keys on the full URL, so the two orders never mix.
  const order = viewOrder(selectedFeed);
  // Global starred — dedicated API
  if (filter === 'starred' && !selectedFeed) {
    return getStarredItems(count, continuation, cacheOnly, order);
  }
  // Read Later — label stream
  if (filter === 'readlater') {
    return getStreamContents(READ_LATER_LABEL, count, continuation, null, { cacheOnly, order });
  }
  // Specific feed, or the home view — the main stream when FreshRSS knows
  // about feed visibility, the whole reading-list otherwise.
  const streamId = selectedFeed
    ? selectedFeed.id
    : homeStreamId(useFeedStore.getState().subscriptions);
  // Server-side filtering: exclude read items when showing unread only
  const excludeTag = filter === 'unread' ? 'user/-/state/com.google/read' : null;
  const result = await getStreamContents(streamId, count, continuation, excludeTag, { cacheOnly, order });
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
const MEM_CACHE_MAX = 60; // room for prefetched feed views alongside active ones
const memCache = new Map<string, StoredView>();
/**
 * Les vues dont la liste affichée a été construite hors ligne
 * (`offlineViewList`, `rebuilt`). Elle n'a rien d'une lecture du serveur : rangée
 * sous la clé de la vue par un geste, elle s'y figeait, tronquée, sans page
 * suivante, et la préparation suivante ne l'atteignait plus. Rendues à leur clé
 * par la première vraie réponse.
 */
const rebuiltViews = new Set<string>();
/** Order in effect for a view — the only reader of the global + per-feed settings. */
function viewOrder(feed: Subscription | null): ArticleOrder {
  const ui = useUiStore.getState();
  return effectiveOrder(ui.articleOrder, ui.feedSettings, feed?.id, useAuthStore.getState().activeServerId);
}
// The order is part of the view: the same feed read from the other end is
// another list, in memory and in the offline store alike. So are the account
// and the server (`offlineScope`): `feed/12` names another feed elsewhere,
// and a response from the server just left must not land in this one's view,
// memory cache or offline store (relecture 1.8.0).
const viewAddress = (feed: Subscription | null, filter: Filter): ViewAddress =>
  ({ scope: offlineScope(), feedId: feed?.id || '', filter, order: viewOrder(feed) });
const viewKey = (feed: Subscription | null, filter: Filter) => viewListKey(viewAddress(feed, filter));

/**
 * Compte et serveur actifs. Tout ce qui est gardé pour le hors ligne (listes,
 * barre latérale) leur est rangé : un navigateur sert plusieurs comptes et
 * plusieurs serveurs, et les numéros de flux (`feed/12`) se recouvrent d'un
 * serveur à l'autre. Sans cela, le compte suivant voyait les abonnements et
 * l'accueil du précédent, et un serveur servait les listes d'un autre.
 */
function offlineScope(): string {
  return scopeOf(useAuthStore.getState());
}
/**
 * Le compte vient du jeton d'abord, comme `prefsSync` : au retour SSO,
 * `backendUser` reste nul tant que `getMe` n'a pas abouti — souvent pendant
 * une panne, justement — et les actions mises en file sous `@1` ne passaient
 * plus le filtre du rejeu une fois l'utilisateur connu (`7@1`).
 */
function accountOf(auth: Pick<AuthSnapshot, 'backendToken' | 'backendUser'>): string {
  return String(jwtUserId(auth.backendToken) ?? auth.backendUser?.id ?? '');
}
function scopeOf(auth: AuthSnapshot): string {
  return `${accountOf(auth)}@${auth.activeServerId ?? ''}`;
}
type AuthSnapshot = Pick<ReturnType<typeof useAuthStore.getState>, 'backendToken' | 'backendUser' | 'activeServerId'>;
const storedKey = (key: string) => `${offlineScope()}|${key}`; // la barre latérale (les listes passent par `viewKey`)

// A category is opened as its Google Reader label stream (user/-/label/Name).
// When such a stream is the selected "feed", the view aggregates every feed in
// the category — so the article list should behave like the multi-source
// "all feeds" view (show per-article source), not a single feed.
export const isCategoryStreamId = (id?: string | null): boolean =>
  !!id && id.startsWith('user/-/label/');

const STARRED_STREAM = 'user/-/state/com.google/starred';

// The Google Reader stream a search should be scoped to, matching the current
// view: the selected feed/category, else the active filter's stream, else the
// whole reading-list (the "all feeds" view — search everywhere).
export function resolveSearchStreamId(
  selectedFeed: Subscription | null,
  filter: Filter,
  subscriptions: readonly Subscription[] = [],
): string {
  if (filter === 'readlater') return READ_LATER_LABEL;
  if (filter === 'starred' && !selectedFeed) return STARRED_STREAM;
  if (selectedFeed) return selectedFeed.id;
  // Home: the same stream the list is loaded from, so a search, a range
  // mark and "mark all" never reach a feed the home view does not show.
  return subscriptions.length ? homeStreamId(subscriptions) : READING_LIST_STREAM;
}
function memGet(key: string): StoredView | undefined {
  return memCache.get(key);
}
function memSet(key: string, data: ViewList): void {
  rebuiltViews.delete(key);
  memCache.delete(key);
  memCache.set(key, { ...data, at: Date.now() });
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
// Une liste gardée vient de changer sous un geste : elle est à jour de ce geste,
// ce que dit sa date, face à une préparation plus ancienne (`offlineViewList`).
function memPatch(key: string, view: StoredView, articles: Article[]): void {
  memCache.set(key, { ...view, articles, at: Date.now() });
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
    if (changed) memPatch(key, view, articles);
  }
}
// Retirer une ligne du cache mémoire de TOUTES les vues portant un filtre
// donné. Sans cela, un retrait ne dure que le temps de la vue : `loadArticles`
// repeint depuis ce cache et pose `loading: !cached`, donc y revenir
// réaffichait la ligne retirée, sans spinner et sans limite de temps hors
// ligne. Le filtre est lu dans la clé, ordre inverse compris (`parseViewKey`) :
// un simple suffixe `:unread` manquait les vues en « plus anciens d'abord ».
//
// Générique parce que DEUX écrivains retirent une ligne : le ✓ sous « Non
// lus » (`toggleRead`) et le retrait de l'étiquette depuis « À lire plus
// tard » (`toggleReadLater`). Le second avait été oublié — même défaut, même
// symptôme.
function memRemoveFromViews(articleId: string, filter: Filter): void {
  for (const [key, view] of memCache) {
    if (parseViewKey(key)?.filter !== filter) continue;
    const articles = view.articles.filter((a) => a.id !== articleId);
    if (articles.length !== view.articles.length) memPatch(key, view, articles);
  }
}
// Ce qu'un « Tout lu » réussi change aux AUTRES vues du même flux, et à l'accueil.
// FreshRSS a tout marqué dans le flux : pas besoin de la liste des identifiants,
// le flux des articles suffit, et le relevé peut d'ailleurs avoir échoué.
//
// `marked` est le flux marqué (vide pour l'accueil), `sourceIds` les flux qu'il
// couvre. `whole` ne vaut que pour « Tous » et « Non lus » : Favoris et À lire
// plus tard traversent les flux, et leurs lignes d'un flux gardé hors de
// l'accueil n'ont pas été marquées.
//
// En mémoire, toutes les vues de la portée. Hors ligne, celles du flux marqué, sa
// liste préparée comprise, et de l'accueil : lire une liste de préparation par
// flux pour un « Tout lu » de l'accueil chargerait des centaines de listes, pour
// un état qu'une relecture en ligne remet d'aplomb.
function markStreamReadInViews(marked: string, sourceIds: ReadonlySet<string>, skipKey: string | null): void {
  const scope = offlineScope();
  const patch = (v: ViewAddress) => ({
    whole: v.feedId === marked && (v.filter === 'all' || v.filter === 'unread'),
    sourceIds,
    drop: v.filter === 'unread',
  });
  for (const [key, view] of memCache) {
    const v = parseViewKey(key);
    if (!v || v.scope !== scope) continue;
    const articles = markStreamRead(view.articles, patch(v));
    if (articles !== view.articles) memPatch(key, view, articles);
  }
  void (async () => {
    for (const feedId of new Set([marked, ''])) {
      for (const filter of ['all', 'unread', 'starred', 'readlater'] as const) {
        for (const order of ['newest', 'oldest'] as const) {
          const v: ViewAddress = { scope, feedId, filter, order };
          const key = viewListKey(v);
          if (key === skipKey) continue;
          const stored = await listGet(key);
          // Rien sous une portée quittée : ses vues viennent peut-être d'être effacées.
          if (offlineScope() !== scope) return;
          if (!stored) continue;
          const articles = markStreamRead(stored.articles, patch(v));
          if (articles !== stored.articles) await listPut(key, articles, stored.continuation);
        }
      }
    }
    if (!marked) return;
    const key = preparedListKey(scope, marked);
    const stored = await listGet(key);
    if (!stored || offlineScope() !== scope) return;
    const articles = markStreamRead(stored.articles, { whole: true, sourceIds, drop: false });
    // Sa date reste celle de sa lecture : un « Tout lu » ne la fait pas passer
    // devant une liste visitée après elle.
    if (articles !== stored.articles) await listPut(key, articles, null, stored.cachedAt);
  })().catch(() => {});
}
/** Les flux qu'un « Tout lu » couvre, vu de la vue marquée. */
function markedSources(feed: Subscription | null, subscriptions: readonly Subscription[]): Set<string> {
  if (!feed) return new Set(mainStreamFeedIds(subscriptions));
  if (!isCategoryStreamId(feed.id)) return new Set([feed.id]);
  return new Set(subscriptions.filter((s) => s.categories?.some((c) => c.id === feed.id)).map((s) => s.id));
}
/**
 * Ce qu'une vue sert hors ligne : la liste de `offlineViewList`, dans laquelle
 * `loadArticles` et la recherche lisent la même chose. Pour une même source, la
 * mémoire d'abord et le disque seulement si elle manque : un « Tout lu » de
 * l'accueil patche la première et pas les listes des flux sur le second. Comparer
 * leurs longueurs allait à contre-sens : sous Non lus, la liste la plus à jour
 * est la plus courte. La mémoire est aussi le seul recours quand le stockage est
 * bloqué (navigation privée, quota).
 *
 * Tout ce que le registre connaît s'applique (`since` à 0) : une liste rangée
 * n'est pas une réponse partie après un geste, elle n'a pas le dernier mot.
 *
 * Une liste dont toutes les lignes sont filtrées reste une réponse : « Non lus »
 * affiche alors « tout est lu », et non un échec de chargement.
 */
async function offlineList(view: ViewAddress): Promise<OfflineView | null> {
  await ensureQueue();
  const read = async (address: ViewAddress): Promise<StoredView | undefined> => {
    const key = viewListKey(address);
    const cached = rebuiltViews.has(key) ? undefined : memGet(key);
    return cached ?? asStored(await listGet(key).catch(() => undefined));
  };
  const sources: OfflineSources = { own: await read(view) };
  if (!sources.own) {
    for (const source of fallbackSources(view)) {
      const list = await read(source);
      if (list) { sources.fallback = { list, source }; break; }
    }
  }
  if (view.feedId && (view.filter === 'all' || view.filter === 'unread')) {
    sources.prepared = asStored(await listGet(preparedListKey(view.scope, view.feedId)).catch(() => undefined));
  }
  return offlineViewList(view, sources, {
    overlay: (rows) => localWrites.overlay(view.scope, applyQueued(rows, view.scope), 0),
    stays: (row) => useFeedStore.getState().selectedArticle?.id === row.id,
  });
}
const asStored = (record: Awaited<ReturnType<typeof listGet>>): StoredView | undefined =>
  record && { articles: record.articles, continuation: record.continuation, at: record.cachedAt ?? 0 };

// Re-persist the current view's list to the offline store after ANY optimistic
// change, so an offline return to it reflects the latest state. Longtemps
// appelé par les seuls chemins de lecture : le favori et « à lire plus tard »
// étaient donc perdus du cache, et un rechargement hors ligne les affichait
// dans leur état d'avant.
// Identité de la vue affichée : le flux, le filtre, et la recherche en cours.
// Le rollback d'un retrait optimiste s'en sert pour vérifier qu'il réinsère
// bien dans la liste d'où la ligne vient — `selectView` remplace `articles` en
// bloc, et une recherche aussi. La clé du cache (`viewKey`) ne suffit pas : une
// recherche ne change ni le flux ni le filtre, mais bien la liste à l'écran.
function viewIdentity(s: FeedState): string {
  return `${offlineScope()}|${s.selectedFeed?.id || ''}:${s.filter}:${s.searchQuery || ''}`;
}
function persistCurrentView(get: () => FeedState): void {
  const s = get();
  // `viewKey` ignore `searchQuery` : persister pendant une recherche
  // écrirait les résultats filtrés sous la clé de la vue nue, que le
  // prochain retour hors ligne sur ce flux resservirait comme s'il n'y avait
  // jamais eu de recherche.
  if (s.searchQuery) return;
  // Pareil pour un tirage : mélangé, il fausserait la lecture normale de la vue.
  if (s.randomView) return;
  // Une liste pas encore chargée n'est pas une liste vide : un geste sur l'article
  // ouvert, en sortant d'un tirage, écrasait la copie gardée par un `[]`.
  if (s.loading && !s.articles.length) return;
  const key = viewKey(s.selectedFeed, s.filter);
  // La mémoire aussi : elle passe avant le disque hors ligne (`offlineList`), et
  // seul l'état `read` la suivait. Un favori posé y était perdu.
  const cached = memGet(key);
  if (cached) memPatch(key, cached, s.articles);
  if (rebuiltViews.has(key)) return;
  listPut(key, s.articles, s.continuation).catch(() => {});
}

// Incrémentée par un « Tout lu » : la page suivante en vol est celle d'une liste
// qui n'existe plus. Ni le flux ni le filtre n'ont changé, `viewIdentity` ne le
// voit pas.
let listGeneration = 0;

// Les écritures locales récentes : une réponse partie avant l'une d'elles est
// recalée à son arrivée (`src/lib/localWrites.ts`). Le rang de départ se prend
// AVANT l'appel réseau, comme `beginCountsReading` pour les compteurs.
const localWrites = createLocalWrites();
const noteWrite = (id: string, field: WriteField, value: boolean) =>
  localWrites.record(offlineScope(), id, field, value);
/** Une écriture déjà confirmée : elle ne passe pas par le vol. */
function noteConfirmed(scope: string, id: string, field: WriteField, value: boolean): void {
  localWrites.record(scope, id, field, value);
  localWrites.touch(scope, id, field);
}
const labelField = (labelId: string): WriteField => `label:${labelId}`;
/**
 * Les lignes d'une réponse, recalées. Une ligne qu'un geste a sortie de la vue
 * (✓ sous Non lus, retrait d'« À lire plus tard ») n'y revient pas ; celle qui y
 * est encore y reste, comme l'article ouvert sous Non lus, qui ne disparaît pas
 * sous les yeux de qui le lit.
 */
function reconcile(articles: Article[], filter: Filter, since: number): Article[] {
  const scope = offlineScope();
  const keep = (row: Article) => {
    const left = (filter === 'unread' && row.read)
      || (filter === 'readlater' && !row.labels?.includes(READ_LATER_LABEL));
    if (!left) return true;
    const s = useFeedStore.getState();
    return s.selectedArticle?.id === row.id || s.articles.some((a) => a.id === row.id);
  };
  return localWrites.overlay(scope, applyQueued(articles, scope, keep), since, keep);
}

/**
 * Le seul point où la file rejoint une liste : toute liste servie, réponse du
 * serveur, disque ou repli, y passe. Une action en attente n'est pas encore sur
 * le serveur, et personne d'autre ne l'y porte sur une liste : la ligne repassait
 * en gras à la relecture suivante, pour toute la session après un 502 (le rejeu
 * ne part qu'au montage et sur `online`), et rouvrir la ligne la décomptait une
 * seconde fois. Une action sans portée (d'avant 1.8.0) partira avec celle-ci.
 */
function applyQueued(rows: Article[], scope: string, keep?: (row: Article) => boolean): Article[] {
  const pending = new Map<string, QueuedAction[]>();
  for (const action of actionQueue) {
    if (action.scope && action.scope !== scope) continue;
    const same = pending.get(action.articleId);
    if (same) same.push(action);
    else pending.set(action.articleId, [action]);
  }
  if (!pending.size) return rows;
  let changed = false;
  const out: Article[] = [];
  for (const row of rows) {
    let next = row;
    for (const action of pending.get(row.id) ?? []) {
      next = applyField(next, writeFieldOf(action.type, action.labelId), action.value);
    }
    if (next === row) { out.push(row); continue; }
    changed = true;
    if (!keep || keep(next)) out.push(next);
  }
  return changed ? out : rows;
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

// ── Décompte des arrivées, partagé par les deux relevés de compteurs ───────
// `syncCounts` (toutes les 60 s) et `loadSubscriptions` (démarrage, renommage
// ou suppression de catégorie, déplacement ou ajout de flux, rafraîchissement)
// écrasent tous deux `unreadCounts` par les compteurs du serveur. Si seul le
// premier comptait, les arrivées de la minute qui précède un renommage
// disparaîtraient : le relevé suivant partirait d'une base déjà relevée.
// Les deux passent donc par ici, avec les mêmes gardes.

/** Ce qu'un relevé doit retenir AVANT son attente réseau. */
interface CountsReading {
  epoch: number;
  serverId: string | number | null;
  /** Un ✓/non-lu était en vol au démarrage (Important 1, voir plus haut). */
  writeWasInFlight: boolean;
}
function beginCountsReading(): CountsReading {
  return {
    epoch: countsEpoch,
    serverId: useAuthStore.getState().activeServerId,
    writeWasInFlight: readWritesInFlight > 0,
  };
}

/**
 * Arrivées dans la vue entre `before` (compteurs du store au retour du relevé)
 * et `next` (compteurs du serveur, plancher zéro appliqué). Rend 0 si une
 * garde tient (voir la garde en tête de fichier et Fix 2 dans `syncCounts`),
 * sans compteur connu (premier relevé : tout le stock passerait pour une
 * arrivée), ou si la vue n'a pas de bandeau (`feedIds === null`).
 *
 * Consomme `skipNextArrivals` et vide `zeroFloorJustExpired` dans tous les
 * cas : ce relevé a écrasé le compte local, ce qu'ils décrivaient est réglé.
 * `skip` laisse l'appelant écarter ce relevé du décompte sans le priver de
 * cette consommation (le rafraîchissement manuel, qui a son propre bandeau).
 */
function arrivalsInView(
  reading: CountsReading,
  before: Record<string, number>,
  next: Record<string, number>,
  feedIds: readonly string[] | null,
  refreshPhase: RefreshPhase,
  opts: { ignoreUnknownFeeds?: boolean; skip?: boolean } = {},
): number {
  const skipThisPoll = !!opts.skip
    || reading.epoch !== countsEpoch
    || reading.writeWasInFlight
    || replayInFlight !== null
    || refreshPhase === 'running'
    || skipNextArrivals
    || String(useAuthStore.getState().activeServerId) !== String(reading.serverId);
  skipNextArrivals = false;
  let arrived = 0;
  if (!skipThisPoll && feedIds && Object.keys(before).length) {
    const newByFeed = {
      ...computeRefreshDelta(before, next, { ignoreUnknownFeeds: opts.ignoreUnknownFeeds }).newByFeed,
    };
    // Un flux qui vient de quitter son plancher zéro saute de 0 à son vrai
    // compte : ce n'est pas une arrivée.
    for (const id of zeroFloorJustExpired) delete newByFeed[id];
    arrived = countNewInView(newByFeed, feedIds);
  }
  zeroFloorJustExpired.clear();
  return arrived;
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
  const ui = useUiStore.getState();
  void warmRunner.schedule(view, articles.filter((a) => a.url && effectiveAutoExtract(ui.autoExtractDefault, ui.feedSettings, a.sourceId)));
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
  // Le dernier chargement de la vue a échoué sans liste de secours : la liste
  // vide n'est pas un « tout est lu », elle le dit (`listBodyState`).
  listFailed: boolean;
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
    /** Images stopped because the device ran out of space. */
    deviceFull?: boolean;
    /** Images that could not be fetched — a minority always fails. */
    imagesFailed?: number;
    /** First error met while caching images — a silent 0 is undiagnosable. */
    imagesError?: string;
  } | null;
  setFilter: (filter: Filter) => void;
  setUnreadFilter: (on: boolean) => void;
  loadLabelCounts: () => Promise<void>;
  warmOfflineCache: () => Promise<void>;
  /** `userInitiated`: started by a click (asks for protected storage). */
  prepareOffline: (opts?: { userInitiated?: boolean }) => Promise<void>;
  prefetchView: (feed: Subscription) => Promise<void>;
  warmFeedLists: () => Promise<void>;
  selectView: (feed: Subscription | null, filter?: Filter) => void;
  /** Entrée « Tous les flux » (barre latérale, palette). */
  selectHomeAll: () => void;
  selectCategory: (cat: FeedCategory) => void;
  selectArticle: (article: Article | null) => void;
  /** Recharge abonnements et compteurs, et compte les arrivées comme
   *  `syncCounts`. `countArrivals: false` : ne rien ajouter à `newInView`
   *  (le rafraîchissement manuel, qui a son propre bandeau). */
  loadSubscriptions: (opts?: { countArrivals?: boolean }) => Promise<void>;
  /**
   * Instant paint from the offline snapshot of the subscriptions (structure
   * only; counts arrive with the live load). Resolves once applied, so the
   * startup view can be chosen with the feeds' visibility known — the home
   * stream depends on it (`homeStreamId`). Never clobbers loaded data.
   */
  restoreSubscriptionsSnapshot: () => Promise<void>;
  loadSpecialCounts: () => Promise<void>;
  loadArticles: () => Promise<void>;
  loadMore: () => Promise<void>;
  /** Un tirage au hasard dans la vue affichée. Jamais enregistré ni rangé. */
  randomView: boolean;
  /** Numéro du tirage affiché : un nouveau tirage remonte la liste. */
  randomDraw: number;
  setRandomView: (on: boolean) => void;
  /** Recale la vue sur son réglage quand les préférences arrivent après elle. */
  syncRandomView: (before: Record<string, true>) => void;
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
  /** Prépare le retour en arrière pendant que la confirmation est à l'écran. */
  prepareMarkAllUndo: () => void;
  /** La question de « Tout lu » annulée : son relevé est abandonné. */
  cancelMarkAllUndo: () => void;
  /**
   * L'écriture de masse en cours, ou `null`. Elle existe pour être MONTRÉE :
   * un « tout lu » sur un gros flux et son annulation prennent plusieurs
   * secondes, et sans rien à l'écran ils passent pour des clics perdus —
   * remonté le 2026-09-30, « je n'ai pas de vision sur les tâches en cours ».
   */
  bulkWork: { done: number; total: number | null } | null;
  markReadRelative: (article: Article, direction: 'above' | 'below') => Promise<void>;
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
  /** Ignore le bandeau : remet `newInView` à zéro sans rien charger. Il
   *  réapparaîtra à la prochaine arrivée. */
  dismissNewArticles: () => void;
  refresh: () => Promise<void>;
  resetAndReload: () => void;
  // Feedback after a manual refresh: how many new articles arrived and where.
  // Drives the "X new articles" banner + the per-feed pulse; cleared after a
  // few seconds by the banner.
  refreshResult: { totalNew: number; newByFeed: Record<string, number>; at: number } | null;
  /** Articles arrivés dans la vue affichée depuis son chargement (bandeau, discussion #14). */
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
  /** FreshRSS answered the replay with its own 401 (not FriRSS's): the queue
   *  is kept whole and waits; the banner says so. Cleared by the next replay
   *  that gets an action through, by a change of scope, or as soon as the
   *  active scope has nothing pending (`pendingPatch`). Set only if the
   *  replay's session is still the active one. */
  replayRefusedByServer: boolean;
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
/** Incrémentée à chaque changement de portée (abonnement en fin de fichier) :
 *  le rejeu la compare, pour qu'un aller-retour de serveur ne passe pas pour
 *  « rien n'a changé ». */
let scopeGeneration = 0;

/**
 * Les actions d'avant 1.8.0, sans portée, prennent `scope`. Une action de la
 * portée sur le même article est forcément plus récente (faite après la mise
 * à jour) : l'ancienne lui cède la place.
 *
 * Jamais sous une portée sans compte ou sans serveur (`@`, `@1`, `7@`) :
 * aucune session réelle n'y revient, et une action adoptée là n'était plus
 * ni rejouée, ni comptée, ni retirée par `dropUnscopedActions`.
 */
async function adoptUnscopedActions(scope: string): Promise<void> {
  if (scope.startsWith('@') || scope.endsWith('@')) return;
  if (!actionQueue.some((a) => !a.scope)) return;
  const own = new Set(actionQueue.filter((a) => a.scope === scope).map((a) => a.key));
  actionQueue = actionQueue.flatMap((a) => {
    if (a.scope) return [a];
    const key = `${scope}|${actionKey(a.articleId, a.type, a.labelId)}`;
    if (own.has(key)) return [];
    own.add(key);
    return [{ ...a, key, scope }];
  });
  await queuePut(actionQueue);
  useFeedStore.setState(pendingPatch());
}

/**
 * La lecture de la file, une seule par session. La PROMESSE est gardée, pas
 * un booléen posé après l'attente : deux premiers appels concurrents (un
 * geste qui échoue, le rejeu de l'événement `online`) lisaient chacun la file,
 * et le plus lent remplaçait en mémoire ce que l'autre venait d'y mettre —
 * puis la prochaine écriture l'effaçait du stockage.
 */
let queueLoading: Promise<void> | null = null;
/** Avant de servir une liste : relancée hors ligne, l'app n'a pas encore lu sa file. */
async function ensureQueue(): Promise<void> {
  if (!queueLoaded) await loadQueue().catch(() => {});
}
async function loadQueue(): Promise<QueuedAction[]> {
  queueLoading ??= queueGet().then(
    (stored) => {
      // Le numéro d'ordre d'un geste ne vaut que dans sa session : relue, une
      // action est plus ancienne que tout geste à venir (voir `Gesture`).
      actionQueue = stored.map(({ seq: _seq, ...a }) => a);
      queueLoaded = true;
    },
    () => { queueLoading = null; }, // illisible : le prochain appel réessaie
  );
  await queueLoading;
  return actionQueue;
}

/**
 * Le compteur du bandeau, et l'avertissement « FreshRSS refuse » qui tombe
 * dès que la portée active n'a plus rien en attente : sans actions, la
 * phrase « les actions en attente » ne décrit plus rien.
 */
function pendingPatch(scope: string = offlineScope()): Partial<FeedState> {
  const n = pendingHere(scope);
  return n === 0 ? { pendingActions: 0, replayRefusedByServer: false } : { pendingActions: n };
}

/** Ce que le compteur du bandeau annonce : les actions qui partiront ICI.
 *  Celles d'un autre compte ou serveur attendent le leur, sans rien devoir
 *  à celui-ci ; les anciennes, sans portée, partiront avec la première
 *  portée active (voir le rejeu) — elles comptent donc ici. */
const pendingHere = (scope: string = offlineScope()) =>
  actionQueue.filter((a) => !a.scope || a.scope === scope).length;

/**
 * Un geste d'article (lu, favori, étiquette), relevé AVANT son appel réseau.
 *
 * La portée est celle du moment du geste : l'échec peut arriver jusqu'à 75 s
 * plus tard (`TIMEOUT_DEFAULT_MS`), après un changement de serveur, et
 * l'action était alors rangée — puis rejouée — sous le serveur suivant, où
 * le même numéro désigne un autre article. Le numéro d'ordre départage deux
 * gestes sur le même article, dans les trois sens : un ancien qui échoue
 * après qu'un plus récent a réussi n'entre pas en file ; un ancien qui
 * réussit tard ne retire pas de la file un plus récent qui avait échoué
 * (`settleAction`) ; un ancien qui échoue tard n'y écrase pas un plus récent
 * (`mergeAction`). L'action en file garde ce numéro, en mémoire seulement.
 */
interface Gesture { scope: string; seq: number }
let gestureSeq = 0;
const gesture = (): Gesture => ({ scope: offlineScope(), seq: ++gestureSeq });
/** Clé d'action → numéro du dernier geste confirmé en direct par le serveur. */
const settledGestures = new Map<string, number>();

function writeFieldOf(type: QueuedActionType, labelId?: string): WriteField {
  if (type === 'read') return 'read';
  if (type === 'star') return 'starred';
  return labelField(type === 'readLater' ? READ_LATER_LABEL : labelId ?? '');
}

/**
 * Le serveur vient de confirmer un geste en direct : toute action en attente
 * sur le même article et le même attribut est périmée. Laissée en file, elle
 * écrasait ce geste au rejeu suivant — une action qui attend le retour de sa
 * portée peut attendre longtemps.
 */
async function settleAction(
  set: (partial: Partial<FeedState>) => void,
  g: Gesture,
  article: Pick<Article, 'id' | 'sourceId'>,
  type: QueuedActionType,
  value: boolean,
  labelId?: string,
): Promise<void> {
  const articleId = article.id;
  const key = `${g.scope}|${actionKey(articleId, type, labelId)}`;
  const outrun = (settledGestures.get(key) ?? 0) > g.seq;
  if (!outrun) settledGestures.set(key, g.seq);
  // Le vol est terminé, et une lecture partie pendant lui a pu passer au serveur
  // avant ce geste : elle compte comme partie avant.
  const field = writeFieldOf(type, labelId);
  localWrites.touch(g.scope, articleId, field);
  await loadQueue();
  if (!outrun && !actionQueue.some((a) => a.key === key && (a.seq ?? 0) > g.seq)) {
    reportOnLists(g.scope, article.sourceId, articleId, field, value);
  }
  // Seulement une action PLUS ANCIENNE que ce geste : le geste suivant, mis
  // en file pendant que celui-ci traînait (un 502 rapide), est la dernière
  // intention — le retirer laissait le serveur sur « lu » et l'écran sur
  // « non lu », sans rien à rejouer.
  const stale = (a: QueuedAction) => a.key === key && (a.seq ?? 0) < g.seq;
  if (!actionQueue.some(stale)) return;
  actionQueue = actionQueue.filter((a) => !stale(a));
  await queuePut(actionQueue);
  set(pendingPatch());
}

/**
 * Un geste se reporte sur les listes gardées de son flux, préparée comprise, et
 * sur celles de l'accueil. Une vue construite hors ligne ne s'écrit pas
 * (`rebuiltViews`) et un geste fait ailleurs n'écrivait que sa vue : la liste
 * préparée disait encore non lu, et l'article revenait sous Non lus au trajet
 * suivant. Leur date ne bouge pas : rien n'a été relu. Les listes de catégorie
 * n'en sont pas : trouver celles d'un flux demanderait de les parcourir toutes.
 * Les vues en mémoire suivent : `offlineList` les lit avant le disque, et
 * `memMarkRead` ne couvre que la lecture.
 */
function reportOnLists(scope: string, sourceId: string | undefined, articleId: string, field: WriteField, value: boolean): void {
  if (!sourceId) return;
  const change = (rows: Article[]) => {
    const i = rows.findIndex((a) => a.id === articleId);
    if (i < 0) return rows;
    const row = applyField(rows[i], field, value);
    if (row === rows[i]) return rows;
    const next = [...rows];
    next[i] = row;
    return next;
  };
  for (const [key, view] of memCache) {
    if (!key.startsWith(`${scope}|`)) continue;
    const articles = change(view.articles);
    if (articles !== view.articles) memPatch(key, view, articles);
  }
  void listsPatch(feedListKeys(scope, [sourceId]), change);
}

/** Les listes gardées de ces flux et de l'accueil : ce qu'un geste atteint. */
function feedListKeys(scope: string, sourceIds: Iterable<string>): string[] {
  const keys = viewListKeys(scope, '');
  for (const id of sourceIds) keys.push(preparedListKey(scope, id), ...viewListKeys(scope, id));
  return keys;
}

/** Comme `reportOnLists`, pour une plage lue : mêmes listes, un seul passage. */
function reportRangeRead(scope: string, sourceIds: ReadonlySet<string>, inRange: (a: Article) => boolean): void {
  const change = (rows: Article[]) => {
    if (!rows.some((a) => !a.read && sourceIds.has(a.sourceId) && inRange(a))) return rows;
    return rows.map((a) => (!a.read && sourceIds.has(a.sourceId) && inRange(a) ? { ...a, read: true } : a));
  };
  for (const [key, view] of memCache) {
    if (!key.startsWith(`${scope}|`)) continue;
    const articles = change(view.articles);
    if (articles !== view.articles) memPatch(key, view, articles);
  }
  void listsPatch(feedListKeys(scope, sourceIds), change);
}

/**
 * Remember an action that failed for lack of network, so it can be replayed.
 * Business refusals never come here — see isNetworkFailure.
 */
async function enqueueAction(
  set: (partial: Partial<FeedState>) => void,
  g: Gesture,
  article: Pick<Article, 'id' | 'sourceId'>,
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
  const { scope } = g;
  const articleId = article.id;
  const key = `${scope}|${actionKey(articleId, type, labelId)}`;
  const field = writeFieldOf(type, labelId);
  // Un geste plus récent sur le même article a déjà été confirmé : celui-ci,
  // resté en vol jusqu'au délai d'attente, est dépassé.
  if ((settledGestures.get(key) ?? 0) > g.seq) { localWrites.touch(scope, articleId, field); return; }
  await loadQueue();
  actionQueue = mergeAction(actionQueue, {
    key, articleId, type, value, labelId, at: Date.now(), attempts: 0, scope, seq: g.seq, sourceId: article.sourceId,
  });
  // La valeur que la file a gardée : un ancien geste qui échoue tard n'y écrase
  // pas un plus récent, et il ne doit pas l'écraser sur les listes non plus.
  const kept = actionQueue.find((a) => a.key === key);
  if (kept) reportOnLists(scope, article.sourceId, articleId, field, kept.value);
  // La file prend le relais du registre : c'est elle qui porte désormais la valeur
  // sur les listes servies (`applyQueued`), sans limite de temps.
  localWrites.touch(scope, articleId, field);
  await queuePut(actionQueue);
  set(pendingPatch());
}

const IDLE_SCAN: SearchScan = { running: false, scanned: 0, done: false, stopped: false, error: null };

/**
 * Referme la recherche : périme un balayage en vol et remet la recherche à
 * son état neutre (requête, résultats, tranche visible, barre d'état).
 *
 * Appelée par les trois actions de changement de vue (`setFilter`,
 * `selectView`, `selectCategory` — cette dernière via `selectView`) et par `markAllAsRead` juste après `dropSearchCorpus()`.
 * Sans ce geste, un balayage abandonné (`runScan` rend la main sur `stale()`
 * sans rien écrire) laissait `searchScan.running` bloqué à vrai pour
 * toujours — squelette sans fin dans `listBodyState`, ou barre d'état
 * flottant au-dessus d'un tout autre flux (revue finale, C1). Et sans lui,
 * `loadMore` se fiait au seul `searchQuery` (toujours renseigné) pour
 * décider de paginer localement, et REMPLAÇAIT la liste de la nouvelle vue
 * par les résultats de l'ancienne recherche (C2).
 *
 * `scanToken++` — pas seulement le `set` — car une page déjà en vol ne doit
 * plus rien écrire une fois la vue quittée, même après coup.
 *
 * Inoffensif quand aucune recherche n'est en cours (démarrage, restauration
 * de la dernière vue via `App.tsx`) : `scanToken` avance d'un cran pour
 * rien, et le `set` ne fait que réécrire des champs déjà à leur valeur
 * neutre.
 */
function closeSearch(set: (partial: Partial<FeedState>) => void): void {
  scanToken++;
  // Seulement si une recherche l'avait interrompu : ce chemin sert aussi hors
  // recherche, sur une liste normale que rien ne doit déclarer tirage.
  const state = useFeedStore.getState();
  if (state.searchQuery) set({ randomView: viewOpensRandom(state) });
  set({ searchQuery: '', searchResults: [], searchVisible: PAGE_SIZE, searchScan: { ...IDLE_SCAN } });
}

/**
 * Hors ligne : aucun balayage possible. Filtre ce qui est disponible
 * localement — la liste en mémoire et ce que la vue sert hors ligne
 * (`offlineList`), doublons entre les deux écartés — et le dit dans la barre
 * d'état plutôt que de prétendre avoir tout vu. La même source que la vue, pas
 * la seule clé exacte : sans liste exacte, le corpus se réduisait aux résultats
 * de la recherche précédente.
 *
 * Partagée entre `search()` et `retrySearch()` (I3, revue finale) :
 * `retrySearch` empruntait jusque-là le seul chemin réseau même hors ligne,
 * échouait à coup sûr, et réécrivait la panne en « connexion perdue pendant
 * le balayage » — un mensonge sur la cause. `scanTerms` (module-level) porte
 * déjà les mots de la recherche en cours, posés par `search()` avant tout
 * appel possible à `retrySearch()`.
 */
async function scanOffline(
  set: (partial: Partial<FeedState>) => void,
  get: () => FeedState,
  selectedFeed: Subscription | null,
  filter: Filter,
): Promise<void> {
  const served = await offlineList(viewAddress(selectedFeed, filter));
  const pool = [...get().articles, ...(served?.articles ?? [])];
  // `scanned` compte les articles DISTINCTS effectivement examinés — voir la
  // même remarque dans l'ancien emplacement de ce code, `search()`.
  const seen = new Set<string>();
  const hits: Article[] = [];
  let scanned = 0;
  for (const a of pool) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    scanned++;
    if (matchesTerms(articleHaystack(a), scanTerms)) hits.push(a);
  }
  set({
    searchResults: hits,
    articles: hits.slice(0, PAGE_SIZE),
    searchScan: { running: false, scanned, done: true, stopped: false, error: 'offline' },
  });
}

export const useFeedStore = create<FeedState>()((set, get) => ({
  subscriptions: [],
  unreadCounts: {},
  bulkWork: null,
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
  randomView: false,
  randomDraw: 0,
  refreshResult: null,
  newInView: 0,
  refreshPhase: 'idle',
  hasRefreshToken: false,
  replayRefusedByServer: false,
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
  listFailed: false,

  setFilter: (filter) => {
    closeSearch(set);
    const randomView = canRandomView(filter) && opensRandom(get().selectedFeed);
    const c = randomView ? undefined : memGet(viewKey(get().selectedFeed, filter));
    set({ filter, randomView, articles: c?.articles || [], continuation: c?.continuation || null, selectedArticle: null });
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

  // Combined action: set feed + filter in one go, single loadArticles call.
  // When no filter is given (feed/label navigation), fall back to that feed's
  // own persisted "unread only" preference instead of always showing everything.
  selectView: (feed, filter) => {
    closeSearch(set);
    const f = filter ?? (isUnreadOnly(feed?.id ?? '') ? 'unread' : 'all');
    const randomView = canRandomView(f) && opensRandom(feed ?? null);
    const c = randomView ? undefined : memGet(viewKey(feed ?? null, f));
    // Entrée d'accueil surlignée (`homeEntryActive`) : « Non lus » seulement
    // quand la vue non lus est DEMANDÉE ; toute autre vue d'accueil relève de
    // « Tous les flux ». Ouvrir un flux ne la change pas.
    const homeEntry: HomeEntry = feed ? get().homeEntry : filter === 'unread' ? 'unread' : 'all';
    set({ selectedFeed: feed ?? null, filter: f, homeEntry, randomView, articles: c?.articles || [], continuation: c?.continuation || null, selectedArticle: null });
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
    noteWrite(article.id, 'read', true);
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
    // Le corpus gardé suit l'optimisme, comme sur `toggleRead`.
    patchSearchCorpus(article.id, { read: true });
    // Fire-and-forget; revert if the server call fails.
    // NOTE: reading an article goes through here, NOT through toggleRead —
    // this is the path that must survive being offline.
    readWritesInFlight++; // Important 1 — voir la garde en tête de fichier
    const g = gesture();
    // Le règlement de la file ne doit jamais passer pour un échec de l'écriture.
    markAsRead(article.id).then(() => { settleAction(set, g, article, 'read', true).catch(() => {}); }).catch((err) => {
      // No network: keep it read and replay later. Only a refusal is reverted.
      if (isNetworkFailure(err)) {
        enqueueAction(set, g, article, 'read', true);
        return;
      }
      localWrites.rollback(g.scope, article.id, 'read', false);
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
      // Rollback : le corpus revient avec la ligne.
      patchSearchCorpus(article.id, { read: false });
    }).finally(() => {
      readWritesInFlight--;
      bumpCountsEpoch(); // règlement (succès ou échec) — voir Important 1 en tête de fichier
    });
  },

  restoreSubscriptionsSnapshot: async () => {
    if (get().subscriptions.length > 0) return;
    try {
      const snap = await subsGet(storedKey('subscriptions'));
      if (snap?.length && get().subscriptions.length === 0) set({ subscriptions: snap });
    } catch {
      // No snapshot (first launch, blocked storage): the live load fills in.
    }
  },

  loadSubscriptions: async (opts) => {
    // Stale-while-revalidate: the snapshot paints the sidebar while FreshRSS
    // responds. Not awaited here — the startup effect awaits it itself,
    // before choosing the view (see `restoreSubscriptionsSnapshot`).
    void get().restoreSubscriptionsSnapshot();
    set({ syncing: true });
    // Pris avant l'attente réseau, comme dans `syncCounts`.
    const reading = beginCountsReading();
    try {
      const [subs, counts] = await Promise.all([
        getSubscriptionList(),
        getUnreadCounts(),
      ]);
      // Fix 3 de `syncCounts`, appliqué ici : un chargement parti sur un autre
      // serveur que l'actif n'écrit rien. Revenu après le `unreadCounts: {}`
      // de `resetAndReload`, il donnerait au nouveau serveur la base de
      // l'ancien (les ids `feed/1`, `feed/2`… se recouvrent d'un serveur à
      // l'autre) et son premier chargement annoncerait des « arrivées » qui ne
      // sont que des différences entre deux serveurs. Avant `applyZeroFloor` :
      // les planchers zéro sont eux aussi ceux du nouveau serveur.
      if (String(useAuthStore.getState().activeServerId) !== String(reading.serverId)) return;
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
      const next = applyZeroFloor(countMap);
      // Arrivées depuis le dernier relevé (voir `arrivalsInView`). Un flux que
      // le store ne connaissait pas (on vient de l'ajouter) apporte tout son
      // stock, pas des arrivées : il est écarté (`ignoreUnknownFeeds`). Les
      // flux déjà abonnés sont posés à 0 dans la base s'ils n'y ont pas de
      // compteur, pour que leurs vraies arrivées comptent quand même. La vue
      // est lue sur les NOUVEAUX abonnements : c'est ce que montrera le
      // rechargement que propose le bandeau (un flux déplacé dans la
      // catégorie affichée y apparaîtra).
      const prev = get();
      const before: Record<string, number> = {};
      if (Object.keys(prev.unreadCounts).length) {
        for (const sub of prev.subscriptions) before[sub.id] = 0;
        Object.assign(before, prev.unreadCounts);
      }
      const feedIds = viewFeedIds(
        { feedId: prev.selectedFeed?.id ?? null, filter: prev.filter, searching: !!prev.searchQuery },
        normalizedSubs,
      );
      // `refresh()` passe `countArrivals: false` : son propre bandeau
      // (`refreshResult`, calculé depuis `before`) annonce déjà ces arrivées,
      // elles ne doivent pas l'être une seconde fois dans `newInView`.
      const arrived = arrivalsInView(reading, before, next, feedIds, prev.refreshPhase, {
        ignoreUnknownFeeds: true,
        skip: opts?.countArrivals === false,
      });
      set((st) => ({
        subscriptions: normalizedSubs,
        unreadCounts: next,
        categoryIds: catIds,
        newInView: st.randomView ? 0 : st.newInView + arrived,
      }));
      subsPut(storedKey('subscriptions'), normalizedSubs).catch(() => {}); // persist for offline
      // Auto-load user labels now that we know categories
      get().loadLabels();
      // Load starred & read-later counts in background
      get().loadSpecialCounts();
    } catch {
      // Même garde que le succès : un chargement parti sur un autre serveur
      // n'écrit rien — la clé persistée est commune à tous les serveurs.
      if (String(useAuthStore.getState().activeServerId) !== String(reading.serverId)) return;
      // Offline fallback: persisted subscriptions so the sidebar still works.
      const persisted = await subsGet(storedKey('subscriptions'));
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
      // L'indicateur appartient au chargement du serveur actif : celui d'un
      // serveur quitté ne l'éteint pas sous le chargement du suivant.
      if (String(useAuthStore.getState().activeServerId) === String(reading.serverId)) set({ syncing: false });
    }
  },

  loadSpecialCounts: async () => {
    const scope = offlineScope(); // la réponse d'un serveur quitté n'a rien à dire ici
    try {
      const empty: GReaderStream = { items: [], continuation: null };
      const [starred, readLater] = await Promise.all([
        getStarredItems(200).catch(() => empty),
        getStreamContents(READ_LATER_LABEL, 200, null).catch(() => empty),
      ]);
      if (offlineScope() !== scope) return;
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
    const since = localWrites.mark();
    try {
      const result = await fetchArticleStream(filter, feed, PAGE_SIZE, null);
      if (result && useAuthStore.getState().activeServerId === serverId && !memGet(key)) {
        memSet(key, { articles: reconcile(result.items.map(normalizeArticle), filter, since), continuation: result.continuation });
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
    // Clés et portée relevées AVANT les attentes : une bascule pendant la
    // lecture des favoris rangeait ceux du serveur quitté sous le nouveau
    // (servis hors ligne sur le mauvais serveur), ou sous `@` après une
    // déconnexion — réécrits après l'effacement des vues du compte parti.
    const scope = offlineScope();
    const starredKey = viewKey(null, 'starred');
    const readLaterKey = viewKey(null, 'readlater');
    const sameScope = () => offlineScope() === scope;
    const since = localWrites.mark();
    try {
      const [starred, readLater] = await Promise.all([
        getStarredItems(100).catch(() => null),
        getStreamContents(READ_LATER_LABEL, 100, null).catch(() => null),
      ]);
      if (!sameScope()) return;
      const pinned: Article[] = [];
      if (starred?.items?.length) {
        const arts = reconcile(starred.items.map(normalizeArticle), 'starred', since);
        await listPut(starredKey, arts, starred.continuation);
        pinned.push(...arts);
      }
      if (readLater?.items?.length) {
        const arts = reconcile(readLater.items.map(normalizeArticle), 'readlater', since);
        await listPut(readLaterKey, arts, readLater.continuation);
        pinned.push(...arts);
      }
      // Both lists read whole: whatever else THIS scope pinned is no longer
      // starred nor read-later — once no scope pins it, its extract goes back
      // under the normal retention. Not on a truncated or failed list (it
      // would unpin what it never saw).
      if (starred && readLater && starred.continuation == null && readLater.continuation == null) {
        unpinExtractsExcept(new Set(pinned.map((a) => a.id)), scope).catch(() => {});
      }
      // Extract + pin each (sequential, skip already cached) for offline reading.
      const { extractFullContent } = await import('../utils/extractContent');
      for (const a of pinned) {
        if (!sameScope()) return; // le serveur quitté n'a plus rien à préparer ici
        if (!a.url) continue;
        if (peekExtract(a.id) || (await getExtract(a.id))) {
          pinExtract(a.id, scope).catch(() => {});
          continue;
        }
        try {
          const content = await extractFullContent(a.url);
          await putExtract(a.id, content, { pinned: true, scope });
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  },

  // Full offline preparation (manual, user-triggered): sweep every feed for the
  // last 30 days — persist their lists, extract + cache content, and prefetch
  // images into the service-worker cache (capped ~550 MB). Heavy and network-
  // intensive, hence on-demand. Progress is exposed via `offlinePrep`.
  prepareOffline: async ({ userInitiated = false } = {}) => {
    if (get().offlinePrep?.running) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    // Protected storage: without it, a device short of space lets the browser
    // wipe the whole site (prepared images AND extracts) mid-preparation — seen
    // on Android. Chrome and Safari grant it silently to an installed app;
    // Firefox asks — so only from a click, never from the run at app start.
    // Not awaited: an unanswered prompt must not hold the run.
    if (userInitiated) {
      try { void navigator.storage?.persist?.().catch(() => {}); } catch { /* unsupported */ }
    }
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    // Figée au départ : la préparation dure plusieurs minutes, et la relire en
    // route étiquetait les images suivantes du nom du serveur où l'on venait
    // de passer — puis le balayage final tournait sous ce serveur-là avec la
    // liste de l'autre, et effaçait toutes ses images préparées. Une bascule
    // (ou une déconnexion) interrompt la préparation, comme une coupure.
    const scope = offlineScope();
    const scopeLeft = () => offlineScope() !== scope;
    set({ offlinePrep: { running: true, phase: 'lists', done: 0, total: 0 } });
    try {
      const subs = get().subscriptions;
      const collected: Article[] = [];
      // Une préparation qui n'a pas vu toute la liste ne décide pas de ce qui ne
      // sert plus (voir le retrait, en fin de fonction) : un flux sauté, ou pas
      // d'abonnements du tout, et ses images passaient pour « sorties des 30
      // jours » — FreshRSS en panne vidait ainsi tout le cache des préparées.
      let interrupted = subs.length === 0;
      // Phase 1 — gather recent articles per feed + persist their lists.
      for (const feed of subs) {
        if (scopeLeft()) { interrupted = true; break; }
        try {
          let cont: string | null = null;
          let pages = 0;
          const feedArts: Article[] = [];
          const since = localWrites.mark();
          do {
            const res = await getStreamContents(feed.id, PAGE_SIZE, cont, null, {});
            if (!res) { interrupted = true; break; }
            const arts = res.items.map(normalizeArticle);
            feedArts.push(...arts);
            cont = res.continuation;
            pages++;
            if ((arts[arts.length - 1]?.published ?? 0) < cutoff) break; // past 30 days
          } while (cont && pages < 8);
          // Pas de liste rangée sous une autre portée que celle qui l'a lue.
          if (scopeLeft()) { interrupted = true; break; }
          const recent = localWrites.overlay(scope, applyQueued(feedArts, scope), since)
            .filter((a) => a.published >= cutoff)
            .slice(0, PREPARED_MAX);
          // Toute la liste collectée, sinon le reste, extrait et téléchargé, est
          // injoignable hors ligne. Sous sa propre clé, qu'elle remplace entière :
          // une visite ne l'y atteint pas, et ce que le serveur a purgé en sort.
          // Vide aussi, pour la même raison : une vide ne compte pas à la lecture
          // (`offlineViewList`). L'ordre est celui par défaut, seul lu ici
          // (`getStreamContents` sans `order`) : la vue inverse s'en sert retournée.
          await listPut(preparedListKey(scope, feed.id), recent, null);
          collected.push(...recent);
        } catch { interrupted = true; /* skip this feed */ }
      }
      // Phase 2 — extract, cache, and prefetch images.
      // Images are prefetched whether or not the extract was already cached (the
      // two used to be coupled, which silently skipped images), in priority order,
      // and stop as soon as the storage budget is reached.
      const ui = useUiStore.getState();
      const budget = imageBudget(ui.offlineImagePreset, ui.offlineImageSizes, (await getStorageEstimate())?.quota ?? 0);
      const ordered = prioritizeForOffline(collected, READ_LATER_LABEL);
      let budgetReached = budget.bytes <= 0;
      let deviceFull = false;
      let imagesFound = 0;
      let imagesStored = 0;
      let imagesBytes = 0;
      let imagesFailed = 0;
      let imagesError: string | undefined;
      // Every image the prepared cache holds once this run is over: what it
      // does not list is swept at the end.
      const keptImages = new Set<string>();

      set({ offlinePrep: { running: true, phase: 'articles', done: 0, total: ordered.length } });
      const { extractFullContent } = await import('../utils/extractContent');
      let done = 0;
      for (const a of ordered) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) { interrupted = true; break; }
        if (scopeLeft()) { interrupted = true; break; }

        let extracted: string | null = peekExtract(a.id)?.content ?? null;
        if (a.url && !extracted) {
          const stored = await getExtract(a.id);
          extracted = stored?.content ?? null;
          // Device full: a new extract could not be kept — read what is
          // already stored, fetch nothing.
          if (!extracted && !deviceFull) {
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
          // Device full: nothing is downloaded any more, but the images already
          // prepared are still looked up — kept and counted in the budget — or
          // the final sweep, the only one that frees space, would drop them.
          const res = await cacheImages(urls, { scope, ...(deviceFull ? { noFetch: true } : {}) });
          imagesStored += res.stored;
          imagesFailed += res.failed;
          imagesError ??= res.error;
          // Each image weighs once in the budget, even when several articles
          // share it (a logo, an avatar): counted per article, it reached the
          // budget early, and the sweep dropped the later articles' images.
          for (const url of res.kept) {
            if (keptImages.has(url)) continue;
            keptImages.add(url);
            imagesBytes += res.sizes?.[url] ?? 0;
          }
          if (res.error?.startsWith('open:')) interrupted = true;
          // Device full: every later image would fail too, after a wasted
          // download. The run goes on, downloads and new extracts off.
          if (res.full) deviceFull = true;
          // Count the bytes actually held — stored now or kept from an earlier
          // run, or the cache would outgrow the budget over successive runs. The
          // previous guard watched the browser's storage estimate, which pads
          // opaque entries so wildly that it was unusable; proxied responses
          // give us the real size.
          if (imagesBytes >= budget.bytes) budgetReached = true;
        }

        done++;
        if (done % 5 === 0 || done === ordered.length) {
          set({ offlinePrep: { running: true, phase: 'articles', done, total: ordered.length, imagesFound, imagesStored } });
        }
      }
      // Nothing else evicts prepared images. Only a run that saw the whole list
      // may decide what is no longer wanted: not one cut short by the network or
      // by an unopenable cache, and not one with images turned off (that keeps
      // what was prepared rather than wiping it).
      if (!interrupted && !scopeLeft() && budget.bytes > 0) await pruneImages(keptImages, undefined, scope);
      set({
        offlinePrep: {
          running: false, phase: 'done', done, total: ordered.length,
          imagesFound, imagesStored, imagesFailed,
          budgetStopped: budgetReached && budget.bytes > 0, deviceFull, imagesError,
        },
      });
    } finally {
      // Une erreur imprévue (import dynamique introuvable après un déploiement,
      // IndexedDB) laissait « Préparer » en cours jusqu'au rechargement.
      const prep = get().offlinePrep;
      if (prep?.running) set({ offlinePrep: { ...prep, running: false, phase: 'done' } });
    }
  },

  loadArticles: async () => {
    // Pendant une recherche, la liste affichée est celle des résultats :
    // « recharger la liste » (Rafraîchir, la pastille des nouveaux, un retour
    // en arrière), c'est la compléter par les articles arrivés depuis le
    // balayage. Ce chemin posait `loading`/`revalidating` puis renonçait sur
    // `sameView()` sans les relever : squelette et spinner restaient à vrai.
    if (get().searchQuery) {
      await topUpSearch();
      return;
    }
    bumpCountsEpoch(); // une vue qui repart de zéro n'est pas une arrivée
    if (get().randomView) {
      await drawRandomList();
      return;
    }
    const { selectedFeed, filter } = get();
    const key = viewKey(selectedFeed, filter);
    const since = localWrites.mark();
    // `viewKey` ne voit que le flux et le filtre : une recherche démarrée
    // pendant l'aller-retour ci-dessous (ex. le bouton « chercher dans tous
    // les flux » de l'état vide, qui enchaîne `selectView` puis `search`
    // sans attendre le premier) restait invisible à cette garde, et le flux
    // nu écrasait les résultats de la recherche à sa place (I1, revue
    // finale). `runScan`/`loadMore` se gardent déjà sur `viewIdentity`
    // (flux + filtre + requête) ; ce chemin-ci renonce plus simplement dès
    // qu'une recherche est en cours, avant sa propre écriture.
    const sameView = () => viewKey(get().selectedFeed, get().filter) === key && !get().searchQuery && !get().randomView;
    const cached = memGet(key);
    // Memory cache already painted (set by the select action) → no spinner.
    // `revalidating` covers the gap this leaves: the request below (2.) stays
    // in flight until it resolves, whether or not `cached` was set.
    // La liste repart du serveur : ce qui était signalé comme nouveau y sera.
    set({ loading: !cached, revalidating: true, newInView: 0, listFailed: false });

    // 1. Server cache (SWR) — only when memory had nothing, for an instant-ish
    //    first paint (first visit this session / cross-device). Non-blocking.
    if (!cached) {
      fetchArticleStream(filter, selectedFeed, PAGE_SIZE, null, true)
        .then((c) => {
          if (!c || !sameView() || !get().loading) return;
          const articles = reconcile(c.items.map(normalizeArticle), filter, since);
          memSet(key, { articles, continuation: c.continuation });
          set({ articles, continuation: c.continuation, loading: false });
        })
        .catch(() => {});
    }

    // 2. Live request — authoritative; updates the view + memory cache.
    try {
      const result = await fetchArticleStream(filter, selectedFeed, PAGE_SIZE, null);
      await ensureQueue();
      if (!sameView()) {
        // Une recherche a pris la vue pendant le vol (même flux, même
        // filtre) : personne d'autre ne relèvera les drapeaux posés plus
        // haut. Un vrai changement de vue, lui, a son propre chargement qui
        // les possède désormais.
        // Un tirage, lui aussi, possède ses drapeaux.
        if (viewKey(get().selectedFeed, get().filter) === key && !get().randomView) set({ loading: false, revalidating: false });
        return;
      }
      if (!result) { set({ loading: false, revalidating: false }); return; }
      const articles = reconcile(result.items.map(normalizeArticle), filter, since);
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
      const served = await offlineList(viewAddress(selectedFeed, filter));
      if (!sameView()) return;
      if (served) {
        memSet(key, { articles: served.articles, continuation: served.continuation });
        if (served.rebuilt) rebuiltViews.add(key);
        set({ articles: served.articles, continuation: served.continuation, loading: false, revalidating: false });
        return;
      }
      console.error('[FriRSS] loadArticles error:', err);
      set((state) => ({
        loading: false,
        revalidating: false,
        listFailed: true,
        feedErrors: selectedFeed
          ? { ...state.feedErrors, [selectedFeed.id]: Date.now() }
          : state.feedErrors,
      }));
    }
  },

  setRandomView: (on) => {
    if (on === get().randomView) return;
    if (on && (!canRandomView(get().filter) || get().searchQuery)) return;
    // Le bouton est le réglage : choisi, il reste choisi pour cette vue. Sans réseau,
    // le choix est retenu et la liste ne bouge pas : il servira à la prochaine visite.
    useUiStore.getState().setViewRandom(useAuthStore.getState().activeServerId, get().selectedFeed?.id ?? '', on);
    if (on && !opensRandom(get().selectedFeed)) return;
    showRandomView(on);
  },

  syncRandomView: (before) => {
    const { selectedFeed, subscriptions, searchQuery } = get();
    // Avant les abonnements ou sans session, l'ouverture de la vue lira le réglage.
    if (!useAuthStore.getState().isAuthenticated || !subscriptions.length || searchQuery) return;
    const key = randomViewKey(useAuthStore.getState().activeServerId, selectedFeed?.id ?? '');
    // Seul un choix changé compte : le repli d'un serveur muet ne se rejoue pas ici.
    if (!before[key] === !useUiStore.getState().randomViews[key]) return;
    const want = viewOpensRandom(get());
    if (want !== get().randomView) showRandomView(want);
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
    const generation = listGeneration;
    const since = localWrites.mark();
    set({ loadingMore: true });

    try {
      const result = await fetchArticleStream(filter, selectedFeed, PAGE_SIZE, continuation);
      // La vue a changé pendant l'aller-retour : cette page n'appartient plus
      // à rien de ce qui est affiché. On la jette entièrement — pas d'ajout,
      // pas d'écriture de cache, pas de `continuation` — et on rend la main.
      // Ni sur un tirage, qu'on y soit entré par le bouton, une visite ou la fin
      // d'une recherche : ajoutée, la page rangerait le mélange sous la clé de la vue.
      if (viewIdentity(get()) !== view || generation !== listGeneration || get().randomView) { set({ loadingMore: false }); return; }
      if (!result) { set({ loadingMore: false }); return; }

      const page = reconcile(result.items.map(normalizeArticle), filter, since);
      set((state) => {
        const articles = [...state.articles, ...page];
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
    const g = gesture(); // portée du geste, pas celle de l'échec — voir `Gesture`
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
    noteWrite(article.id, 'read', newRead);
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
    // Le corpus gardé suit l'optimisme : sans ce relais, une recherche future
    // réutiliserait le corpus et ressortirait l'ancien état de lecture.
    patchSearchCorpus(article.id, { read: newRead });
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
      await settleAction(set, g, article, 'read', newRead).catch(() => {});
      // La purge du cache MÉMOIRE des autres vues attend la confirmation : un
      // refus n'y a alors rien à défaire, la ligne y étant toujours. (La vue
      // affichée, mémoire et disque, est déjà réécrite d'avance par le
      // `persistCurrentView` ci-dessus.) Le chemin HORS LIGNE, qui garde la
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
        await enqueueAction(set, g, article, 'read', newRead);
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
      localWrites.rollback(g.scope, article.id, 'read', !newRead);
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
      // Le corpus doit revenir avec la ligne : un refus laissé tel quel y
      // garderait l'état optimiste, jamais écrit côté FreshRSS.
      patchSearchCorpus(article.id, { read: !newRead });
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
    noteWrite(article.id, 'starred', newStarred);
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
    // Le corpus gardé suit l'optimisme, comme sur `toggleRead`.
    patchSearchCorpus(article.id, { starred: newStarred });
    const g = gesture();
    try {
      if (newStarred) {
        await markAsStarred(article.id);
      } else {
        await removeStarred(article.id);
      }
      await settleAction(set, g, article, 'star', newStarred).catch(() => {});
    } catch (err) {
      // No network: keep the optimistic state and replay it later. Only a
      // server refusal is rolled back.
      if (isNetworkFailure(err)) {
        await enqueueAction(set, g, article, 'star', newStarred);
        return;
      }
      // Rollback on failure — un simple `.map()` suffit désormais : plus rien
      // n'est retiré de la liste, il n'y a donc jamais de ligne à réinsérer.
      localWrites.rollback(g.scope, article.id, 'starred', !newStarred);
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
      // Rollback : le corpus revient avec la ligne.
      patchSearchCorpus(article.id, { starred: !newStarred });
    }
  },

  // Search — balaye le périmètre courant page par page (`runScan`, plus bas
  // dans ce fichier) et filtre au passage. Voir
  // docs/superpowers/specs/2026-09-23-client-side-search-design.md.
  search: async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      scanToken++; // périme un balayage en vol
      set({ randomView: viewOpensRandom(get()), searchQuery: '', searchResults: [], searchVisible: PAGE_SIZE, searchScan: { ...IDLE_SCAN } });
      return get().loadArticles();
    }
    const { selectedFeed, filter } = get();
    const streamId = resolveSearchStreamId(selectedFeed, filter, get().subscriptions);
    const serverId = String(useAuthStore.getState().activeServerId ?? '');
    scanTerms = parseQuery(trimmed);
    const token = ++scanToken;

    // Une recherche repart d'une liste neuve : la pastille de la vue qu'elle
    // recouvre ne doit pas flotter au-dessus des résultats. `continuation`
    // appartenait à la vue nue qu'on quitte ; la laisser pendrait la
    // pagination locale des résultats à celle, périmée, du flux brut.
    // `listFailed: false` : l'échec de la vue nue ne dit rien de la recherche,
    // et son « Réessayer » ne recharge pas la vue pendant qu'une recherche est ouverte.
    set({ randomView: false, searchQuery: trimmed, newInView: 0, searchVisible: PAGE_SIZE, loading: false, continuation: null, listFailed: false });

    // Hors ligne : aucun balayage possible. On filtre ce qu'on détient — la
    // liste en mémoire et la liste rangée pour cette vue — et la barre d'état
    // dit ce qui a été fouillé. Prétendre avoir tout vu serait pire que ne rien
    // chercher.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await scanOffline(set, get, selectedFeed, filter);
      return;
    }

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
    // Rien ne tourne : ne pas produire l'état contradictoire
    // { done: true, stopped: true }, que la barre d'état devrait ensuite
    // départager.
    if (!get().searchScan.running) return;
    scanToken++;
    set((s) => ({ searchScan: { ...s.searchScan, running: false, stopped: true } }));
  },

  retrySearch: async () => {
    const { selectedFeed, filter } = get();
    // I3 (revue finale) : hors ligne, reprendre le chemin réseau échoue à
    // coup sûr et réécrit la panne en « connexion perdue pendant le
    // balayage » — faux, la cause est l'absence de réseau, pas une coupure
    // en vol. Emprunter le même chemin que `search()`.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await scanOffline(set, get, selectedFeed, filter);
      return;
    }
    const streamId = resolveSearchStreamId(selectedFeed, filter, get().subscriptions);
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
    // `searchVisible`, `Math.min` seul ferait chuter la tranche affichée — et
    // avec elle, tout ce qui avait déjà été montré.
    const visible = Math.max(s.searchVisible, Math.min(s.searchVisible + PAGE_SIZE, s.searchResults.length));
    // La tranche suivante s'AJOUTE aux lignes affichées au lieu de les
    // recopier depuis `searchResults` : une ligne sortie de la liste (✓ sous
    // le filtre Non lus) ne revient pas, et rien de ce qui est à l'écran
    // n'est réécrit.
    return {
      searchVisible: visible,
      articles: [...s.articles, ...s.searchResults.slice(s.searchVisible, visible)],
    };
  }),

  clearSearch: () => {
    // Referme la recherche comme le ferait une requête blanche : périme un
    // balayage en vol et vide les résultats, sinon une page qui arrive après
    // coup continuerait d'écrire dans `articles`.
    // Fermer une boîte vide ne recharge ni un tirage, ni une liste normale dont le
    // réglage est allumé : celle-ci deviendrait un tirage sans geste.
    if (!get().searchQuery && (get().randomView || viewOpensRandom(get()))) return;
    scanToken++;
    set({ randomView: viewOpensRandom(get()), searchQuery: '', searchResults: [], searchVisible: PAGE_SIZE, searchScan: { ...IDLE_SCAN } });
    get().loadArticles();
  },

  /**
   * Lancer le relevé des non-lus SANS marquer quoi que ce soit.
   *
   * Appelée à l'ouverture de la boîte de confirmation : le relevé coûte une
   * requête par millier d'articles, et ce temps se dépense pendant que la
   * question est lue plutôt qu'après la validation. Si l'utilisateur annule,
   * le relevé est simplement abandonné — il n'a rien écrit.
   */
  prepareMarkAllUndo: () => {
    const { selectedFeed, subscriptions } = get();
    const streamId = selectedFeed ? selectedFeed.id : homeStreamId(subscriptions);
    undoSnapshot = { streamId, ids: snapshotUnread(streamId) };
  },

  // La question annulée, son relevé l'est aussi : gardé, il servait au « Tout
  // lu » suivant du même flux (confirmation désactivée entre-temps), et le
  // retour en arrière rendait non lus des articles lus à la main depuis.
  cancelMarkAllUndo: () => { undoSnapshot = null; },

  // Mark all as read
  markAllAsRead: async () => {
    // L'écran montre un tirage, l'écriture viderait la vue entière.
    if (get().randomView) return;
    const { selectedFeed, subscriptions } = get();
    // Home: the main stream, which FreshRSS bounds by feed visibility too —
    // a feed kept in its category is not marked read from "All feeds".
    const streamId = selectedFeed
      ? selectedFeed.id
      : homeStreamId(subscriptions);
    // Relevé AVANT l'appel : `mark-all-as-read` ne rend pas ce qu'il a touché,
    // et seuls les articles non lus à cet instant doivent pouvoir redevenir
    // non lus. Un échec ou un plafond atteint ne retient pas l'action — ils
    // retirent seulement la proposition de défaire (issue #17).
    const prepare = undoSnapshot;
    undoSnapshot = null;
    // Même garde que les marquages de plage : les identifiants de flux se
    // recouvrent d'un FreshRSS à l'autre, donc un changement de serveur (ou une
    // déconnexion) pendant le relevé aurait vidé `feed/12` sur un AUTRE
    // serveur, puis mis son compteur à zéro dans sa vue.
    const serveurDemande = String(useAuthStore.getState().activeServerId ?? '');
    const sessionDemandee = !!useAuthStore.getState().backendToken;
    const memeContexte = () => {
      const auth = useAuthStore.getState();
      return String(auth.activeServerId ?? '') === serveurDemande && !(sessionDemandee && !auth.backendToken);
    };
    // Et la VUE : ouvrir un autre flux du même serveur pendant le relevé ne
    // change rien au marquage demandé, mais la suite écrivait dans la vue
    // devenue active — liste vidée, article ouvert affiché lu sans l'être,
    // recherche refermée. Hors de la vue demandée, seuls ses compteurs et son
    // cache suivent.
    const filtreDemande = get().filter;
    const rechercheDemandee = get().searchQuery;
    const memeVue = () => {
      const st = get();
      return st.selectedFeed?.id === selectedFeed?.id && st.filter === filtreDemande && st.searchQuery === rechercheDemandee;
    };
    // Sans confirmation, le relevé se fait ICI, devant l'utilisateur : une
    // requête par millier d'articles, pendant lesquelles il ne se passait
    // rien à l'écran — « j'ai l'impression qu'il ne se passe parfois rien »
    // (2026-09-30). Le total n'est pas connu à cet instant : la barre dit
    // qu'on travaille, sans chiffrer ce qu'elle ignore.
    beginBulk();
    try {
      const avant = await (prepare?.streamId === streamId ? prepare.ids : snapshotUnread(streamId));
      if (!memeContexte()) return;
      await markAllAsRead(streamId);
      if (!memeContexte()) return;
      // Sous le filtre Non lus, la vue se vide : le ✓ retire déjà sa ligne
      // sous ce filtre (issue #10), et des lignes lues qui restent à l'écran
      // laissaient croire que rien ne s'était passé jusqu'au prochain
      // tirer-pour-rafraîchir (discussion #19). Le cache mémoire et la liste
      // hors-ligne de la vue suivent, sans quoi un retour sur la vue
      // repeindrait les lignes lues. Le retour en arrière recharge la liste.
      // Pendant une recherche, c'est la vue NUE qui a été marquée (le
      // périmètre ci-dessus ignore la requête) : la recherche se referme plus
      // bas et la vue nue est rechargée, vidée elle aussi sous Non lus.
      const filter = filtreDemande;
      const searching = !!rechercheDemandee;
      const emptied = filter === 'unread';
      const vueActive = memeVue();
      // Une page en vol partait du même flux, sans ce marquage : ses lignes, jamais
      // affichées, sont inconnues du registre, et sous Non lus la liste vidée les
      // aurait reçues, puis rangées.
      if (vueActive) listGeneration++;
      if (emptied) {
        const key = viewKey(selectedFeed, filter);
        memCache.delete(key);
        rebuiltViews.delete(key);
        listPut(key, [], null).catch(() => {});
      } else if (!vueActive) {
        // La liste lue de cette vue n'est plus à l'écran : un retour sur elle
        // la relira du serveur plutôt que de repeindre des lignes non lues.
        memCache.delete(viewKey(selectedFeed, filter));
      }
      // Les autres vues du flux, et celles de l'accueil : sans cela, basculer
      // de Non lus à Tous repeignait les lignes non lues jusqu'à la réponse.
      markStreamReadInViews(selectedFeed?.id ?? '', markedSources(selectedFeed, subscriptions), emptied ? viewKey(selectedFeed, filter) : null);
      // Une lecture encore en vol rapporte ces lignes comme non lues.
      if (vueActive) for (const a of get().articles) noteConfirmed(offlineScope(), a.id, 'read', true);
      // Update local state
      set((state) => {
        const newCounts = { ...state.unreadCounts };
        if (selectedFeed) {
          newCounts[selectedFeed.id] = 0;
        } else {
          // Only the feeds the home view shows: FreshRSS left a category-only
          // feed untouched, and zeroing its badge here claimed otherwise until
          // the next poll. Derived keys (labels, totals) are not zeroed either;
          // the poll reconciles them within the minute.
          for (const id of mainStreamFeedIds(subscriptions)) newCounts[id] = 0;
        }
        if (!vueActive) return { unreadCounts: newCounts };
        const updated = emptied ? [] : state.articles.map((a) => ({ ...a, read: true }));
        return {
          articles: updated,
          continuation: emptied ? null : state.continuation,
          unreadCounts: newCounts,
          selectedArticle: state.selectedArticle
            ? { ...state.selectedArticle, read: true }
            : null,
        };
      });
      bumpCountsEpoch(); // écriture locale — voir la garde en tête de fichier
      // Un « tout lu » touche trop d'articles pour être répercuté un par un ; le
      // corpus gardé deviendrait faux en bloc. Hors de la vue demandée, le
      // corpus et la recherche sont ceux de la nouvelle vue : on n'y touche pas
      // (le corps de la recherche tourne peut-être encore).
      if (vueActive) dropSearchCorpus();
      // Même fermeture que sur un changement de vue (C1, revue finale) :
      // sans elle, un balayage en cours voyait son corpus disparaître sous
      // lui (`stale()` dans `runScan` rend la main sans rien écrire) et
      // `searchScan.running` restait bloqué à vrai pour toujours.
      if (vueActive) closeSearch(set);
      if (vueActive && searching) {
        // La liste montrait encore les résultats, sous l'en-tête de la vue
        // nue, et `continuation` restait à `null` (la recherche l'avait
        // effacée) : plus de pagination. La vue nue repart de son cache
        // mémoire — lu, puisqu'on vient de tout marquer — puis du serveur.
        const cached = memGet(viewKey(selectedFeed, filter));
        set({
          articles: cached ? cached.articles.map((a) => ({ ...a, read: true })) : [],
          continuation: cached?.continuation ?? null,
        });
        void get().loadArticles();
      }
      // Le bandeau vit ICI et non dans la barre d'outils : c'est le store qui
      // sait combien d'articles étaient non lus (le relevé) et si le retour en
      // arrière est possible.
      const { default: i18n } = await import('../i18n');
      // L'identifiant est capturé pour que l'annulation écrive DANS ce
      // bandeau-là plutôt que d'en empiler un autre.
      let toastId = 0;
      toastId = useUiStore.getState().pushToast(
        avant ? i18n.t('toast.markedRead', { count: avant.length }) : i18n.t('toast.markedReadAll'),
                // `run` REND la promesse (la signature du toast l'autorise) : sans
        // cela, rien — ni un test, ni un appelant — ne peut attendre la fin de
        // la remise en non lus, qui se fait par lots successifs.
        avant ? { action: { label: i18n.t('toast.undo'), run: () => (memeContexte() ? restoreUnread(avant, toastId) : undefined) } } : undefined,
      );
    } catch { /* ignore */ } finally {
      endBulk();
    }
  },

  /**
   * Issue #15 : marquer lus tous les articles plus anciens (ou plus récents)
   * que l'article cliqué, JAMAIS lui-même.
   *
   * Le périmètre suit la vue exactement comme la recherche
   * (`resolveSearchStreamId`), et l'action se refuse depuis Favoris ou À lire
   * plus tard (C1, revue finale) : ce ne sont pas des flux qu'on vide, ce
   * sont des sélections transversales — `canMarkAllRead`
   * (`src/lib/markAllRead.ts`) le sait déjà pour le bouton « Tout lu ». Le
   * menu d'un article reste identique dans ces vues ; l'action s'y tait
   * plutôt que de marquer la mauvaise chose.
   *
   * La borne envoyée au serveur — et le critère qui décide localement quelles
   * lignes marquer — est l'identifiant d'entrée de l'article cliqué
   * (`src/lib/entryId.ts`), JAMAIS sa date de publication (C2) : FreshRSS
   * compare `ts` à l'`id` d'insertion de l'entrée, pas à `published`.
   *
   * Deux pièges corrigés après coup (revue de 85ac88f), tous deux dans le
   * retour en arrière :
   * - **C1** : `touchedIds` porte `Article.id` (forme greader hexadécimale),
   *   alors que `itemIdsNewerThanEntry` (« au-dessus ») rend le décimal nu de
   *   `stream/items/ids`. Comparer les deux littéralement laisse
   *   l'intersection toujours vide — un lot pourtant accepté par le serveur
   *   repasserait non lu. Les deux côtés passent donc par `entryIdUsec`
   *   avant toute comparaison.
   * - **C2** : le prédicat de plage ne regarde que l'ordre d'insertion,
   *   jamais `read` — une ligne déjà lue AVANT l'action ne doit jamais
   *   pouvoir redevenir non lue si le serveur refuse : ce refus ne parle que
   *   de ce que CETTE action a changé. `touchedIds` exclut donc dès le
   *   départ ce qui était déjà lu, et le corpus de recherche suit la même
   *   règle (I3) via `corpusModifie`.
   */
  markReadRelative: (article: Article, direction: 'above' | 'below') => {
    const { selectedFeed, filter, randomView } = get();
    // Dans un tirage, « au-dessus » et « en dessous » ne veulent plus rien dire.
    if (!canMarkAllRead(filter) || randomView) return Promise.resolve();
    const streamId = resolveSearchStreamId(selectedFeed, filter, get().subscriptions);
    const bound = { direction, articleId: article.id };
    const touche = (a: Article) => (direction === 'below'
      ? isOlderEntry(a.id, article.id)
      : isOlderEntry(article.id, a.id));

    // Borne serveur, côté « en dessous » seulement — « au-dessus » n'en envoie
    // aucune (`itemIdsNewerThanEntry` s'arrête d'elle-même à l'article
    // cliqué). Un identifiant illisible ne rend aucune borne fiable pour
    // « en dessous » : l'action ne part pas, rien n'est touché — ni le
    // réseau, ni l'écran. « Au-dessus » n'a pas cette garde : un identifiant
    // illisible n'empêche pas l'appel réseau, seul le marquage local ne
    // touche rien (`isOlderEntry` range tout identifiant illisible comme
    // « pas plus ancien »).
    const ts = direction === 'below' ? exclusiveOlderThanEntryId(article.id) : null;
    if (direction === 'below' && ts === null) return Promise.resolve();

    // La vue où l'utilisateur a cliqué. L'exécution peut attendre la fin d'un
    // marquage précédent : si la vue a changé entre-temps, `articles` n'est
    // plus l'écran sur lequel il a demandé — le serveur reçoit quand même
    // l'ordre (le périmètre, lui, est figé ci-dessus), mais aucune ligne
    // affichée n'est touchée.
    const vueDemandee = viewIdentity(get());
    // Le serveur et la session du clic. Le périmètre est figé, mais la requête
    // part vers le serveur ACTIF au moment de l'envoi (`api/client.ts`) : après
    // un changement de serveur ou une déconnexion pendant l'attente, elle
    // écrirait sur un autre FreshRSS — où un `feed/<id>` numérique peut
    // désigner un autre flux — sans retour en arrière possible. Même garde que
    // `syncCounts`.
    const serveurDemande = String(useAuthStore.getState().activeServerId ?? '');
    const sessionDemandee = !!useAuthStore.getState().backendToken;
    const memeContexte = () => {
      const auth = useAuthStore.getState();
      return String(auth.activeServerId ?? '') === serveurDemande && !(sessionDemandee && !auth.backendToken);
    };
    // Visible dès la demande, y compris pour un marquage qui attend son tour.
    beginBulk();

    const executer = async () => {
      // Le contexte a changé pendant l'attente : rien ne part, rien n'est touché.
      if (!memeContexte()) return;
      const { articles } = get();
      const memeVue = viewIdentity(get()) === vueDemandee;

      // Les lignes CHARGÉES que cette action fait passer lues, optimiste — le
      // serveur en connaît sans doute d'autres, non chargées, qu'aucun marquage
      // local ne peut anticiper. Seules les lignes ENCORE NON LUES entrent dans
      // la plage touchée (C2) : une ligne déjà lue avant l'action n'a rien à y
      // faire, sans quoi le rollback pourrait la repasser non lue à tort.
      const touchedRows = memeVue ? articles.filter((a) => touche(a) && !a.read) : [];
      const touchedIds = new Set(touchedRows.map((a) => a.id));
      const touchedSources = new Set(touchedRows.map((a) => a.sourceId));

      // Le rollback compare des identifiants confirmés par le serveur à
      // `touchedIds` : ces deux ensembles doivent vivre dans le MÊME espace
      // (C1) — `touchedIds` porte la forme greader d'`Article.id`,
      // `itemIdsNewerThanEntry` (« au-dessus ») le décimal nu de
      // `stream/items/ids`. `entryIdUsec` ramène les deux au même décimal.
      const versEspaceCommun = (id: string) => entryIdUsec(id) ?? id;

      // I3/C2 pour le corpus : quelles entrées, dans la plage, CETTE action
      // fait-elle passer de non lue à lue ? Capturé ICI, avant tout patch
      // optimiste — celui qui suit écrit `read: true` sur tout ce qu'il touche
      // et effacerait la distinction entre « déjà lu » et « lu par cette
      // action ».
      //
      // C'est ce jeu d'identifiants — et non la référence du corpus — qui dit au
      // retour en arrière ce qu'il a le droit de défaire. Une référence ne
      // tenait pas : `topUpSearch` (Rafraîchir pendant une recherche) et chaque
      // patch réaffectent `searchCorpus`, et le retour en arrière renonçait
      // alors, laissant les lignes lues dans le corpus jusqu'à cinq minutes.
      // Par identifiant, il défait ses lignes sur le corpus qui est là au
      // retour, quel qu'il soit, et ne touche à rien d'autre.
      //
      // Le corpus n'est le sien que s'il a le même périmètre et le même
      // serveur : pendant l'attente, la vue a pu changer et une autre
      // recherche poser son corpus, dont une plage d'identifiants d'entrée ne
      // dit rien.
      const corpusConcerne = () =>
        !!searchCorpus && searchCorpus.streamId === streamId && searchCorpus.serverId === serveurDemande;
      const corpusModifie = new Set(
        corpusConcerne()
          ? searchCorpus!.entries
            .filter((e) => touche(e.article) && !e.article.read)
            .map((e) => e.article.id)
          : []
      );

      if (touchedIds.size) {
        for (const id of touchedIds) noteWrite(id, 'read', true);
        set((s) => ({ articles: s.articles.map((a) => (touchedIds.has(a.id) ? { ...a, read: true } : a)) }));
        bumpCountsEpoch(); // écriture locale — voir la garde en tête de fichier
      }
      // I4 (régression de 85ac88f) : inconditionnel, contrairement au bloc
      // ci-dessus — la plage dépasse ce qui est chargé localement (un balayage
      // de recherche peut être allé plus loin qu'`articles`), donc
      // `touchedIds` vide ne dit rien de ce que le corpus a à patcher. Le
      // critère est un identifiant d'entrée, donc le corpus de recherche reste
      // JUSTE : pas besoin de le jeter comme le fait « tout marquer comme lu »,
      // ce qui refermerait la recherche en cours de l'utilisateur.
      if (corpusConcerne()) patchSearchCorpusByEntry(bound, { read: true });

      // I1 (revue finale du 25/09) : la vue affichée au lancement. b91a246
      // l'avait posée pour garder un refus de repeindre l'écran d'un autre
      // flux ; 85ac88f l'a perdue en remplaçant l'instantané de LISTE
      // (`avant`) par un recalcul sur `s.articles` — ce recalcul dit
      // correctement CE QUI a été touché, mais ne dit rien de SUR QUEL ÉCRAN on
      // le réécrit. Un identifiant peut réapparaître dans une autre vue,
      // légitimement déjà lu pour des raisons qui lui sont propres : sans cette
      // garde, le rollback d'une action périmée le repasserait non lu à tort.
      // Seul le corpus avait gardé la sienne (aujourd'hui `corpusModifie`).
      const vueALancement = viewIdentity(get());

      // I1 (revue finale) : le retour en arrière ne restaure JAMAIS un
      // instantané d'avant l'appel — il recalcule sur la liste TELLE QU'ELLE
      // EST au moment du retour. Un ✓ posé ailleurs pendant le vol, ou une page
      // arrivée depuis, ne doivent pas être défaits par cette action.
      //
      // I5 (revue finale) : seuls les identifiants qui n'ont PAS été confirmés
      // par le serveur reviennent — les lots déjà acceptés restent lus.
      const confirmed = new Set<string>();
      const rollbackUnconfirmed = () => {
        const unconfirmed = new Set([...touchedIds].filter((id) => !confirmed.has(versEspaceCommun(id))));
        // ⚠️ Pas de sortie anticipée sur `unconfirmed` : le patch d'ALLER du
        // corpus est inconditionnel (il porte sur une plage, pas sur la liste
        // chargée), donc son annulation doit l'être aussi. Sans quoi une plage
        // dont aucune ligne n'est à l'écran resterait marquée lue dans le corpus
        // après un refus, et la recherche suivante — même périmètre, aucun
        // réseau — ressortirait des articles lus que FreshRSS a en non-lus.
        // La garde de vue (I1, ci-dessus), elle, ne s'applique qu'aux LIGNES :
        // l'écran n'appartient plus à cette action si la vue a changé.
        for (const id of unconfirmed) localWrites.rollback(offlineScope(), id, 'read', false);
        for (const id of touchedIds) {
          if (!unconfirmed.has(id)) localWrites.touch(offlineScope(), id, 'read');
        }
        if (unconfirmed.size && viewIdentity(get()) === vueALancement) {
          set((s) => ({
            articles: s.articles.map((a) => (unconfirmed.has(a.id) && a.read ? { ...a, read: false } : a)),
          }));
        }
        // I3 : n'annule ni ce que le serveur a confirmé, ni ce que cette action
        // n'avait pas changé (déjà lu avant elle, ou arrivé depuis) — un simple
        // critère de plage ne sait distinguer aucun des deux.
        if (corpusConcerne()) {
          patchSearchCorpusByEntry(bound, { read: false }, (id) =>
            confirmed.has(versEspaceCommun(id)) || !corpusModifie.has(id));
        }
      };

      // I2 (revue finale) : posé AVANT l'appel réseau, levé dans le `finally`
      // qui suit — comme `toggleRead`. Sans lui, un relevé de compteurs lancé
      // pendant cette écriture ne la verrait pas et fabriquerait une fausse
      // pastille « nouveaux articles » (voir la garde en tête de fichier).
      readWritesInFlight++;
      try {
        try {
          if (direction === 'below') {
            await markAllAsRead(streamId, ts as string);
            touchedIds.forEach((id) => confirmed.add(versEspaceCommun(id)));
          } else {
            const ids = await itemIdsNewerThanEntry(streamId, article.id);
            // Le total n'est connu qu'ici : jusque-là la barre dit qu'on
            // travaille sans chiffrer ce qu'elle ignore.
            if (ids.length) set({ bulkWork: { done: 0, total: ids.length } });
            // Par lots : `editTag` accepte un tableau, mais un millier de `i=`
            // dans une URL ne passerait pas. Un lot refusé arrête les
            // suivants — pas la peine d'envoyer ce que le serveur vient de
            // refuser.
            for (let i = 0; i < ids.length; i += 100) {
              // Les lots restants ne partent pas vers un autre serveur ni une
              // session fermée ; rien à défaire, l'écran n'est plus le sien.
              if (!memeContexte()) return;
              const lot = ids.slice(i, i + 100);
              await markAsRead(lot);
              lot.forEach((id) => confirmed.add(versEspaceCommun(id)));
              set({ bulkWork: { done: i + lot.length, total: ids.length } });
            }
          }
        } finally {
          readWritesInFlight--;
          bumpCountsEpoch(); // règlement (succès ou échec) — voir la garde en tête de fichier
        }
        // Le vol est terminé : comme `settleAction` pour une ligne seule, une
        // lecture partie pendant lui a pu passer au serveur avant les lots.
        for (const id of touchedIds) localWrites.touch(offlineScope(), id, 'read');
        if (memeContexte() && touchedIds.size) {
          reportRangeRead(offlineScope(), touchedSources, touche);
          persistCurrentView(get);
        }
        // Combien d'articles le serveur a-t-il touché au-delà de ce qui est
        // chargé ? Nous n'en savons rien, et nous ne le devinons pas : le
        // relevé suivant rapporte le vrai compte. Une baisse n'est pas une
        // arrivée, la pastille n'y verra donc rien.
        await get().syncCounts();
      } catch (err) {
        // Un échec qui arrive après un changement de serveur ou de session ne
        // concerne plus l'écran ni le corpus : ni retour en arrière, ni message.
        if (!memeContexte()) return;
        rollbackUnconfirmed();
        // Un lot accepté par le serveur avant l'échec d'un lot suivant reste lu
        // côté serveur : seul un relevé fait foi, quoi qu'il soit arrivé aux
        // lots.
        await get().syncCounts();
        // I3 (revue finale) : même décision que `toggleRead` — un refus ne se
        // dit que si le serveur a répondu, le hors-ligne véritable reste muet.
        await notifyRangeFailure(err);
      }
    };

    // En file : le second marquage attend la fin du premier au lieu de le
    // croiser. Croisés, chacun patchait le corpus et l'écran pendant que
    // l'autre était en vol, puis un retour en arrière repassait non lues des
    // lignes que l'autre avait marquées — et le corpus restait optimiste.
    // `executer` ne rejette jamais : son `catch` interne peut lui-même échouer
    // (relevé de compteurs, message), et l'appelant fait `void markReadRelative(…)`
    // — un rejet y serait une promesse non gérée. La barre est levée dans
    // tous les cas.
    //
    // File vide : l'exécution part tout de suite, dans cet appel — le ✓
    // optimiste doit se voir au clic, pas un tour de boucle plus tard.
    const attente = rangeWaiting++ > 0;
    const sansRejet = () => executer().catch(() => {});
    const run = (attente ? rangeQueue.then(sansRejet) : sansRejet()).finally(() => {
      rangeWaiting--;
      endBulk();
    });
    rangeQueue = run.then(() => {}, () => {});
    return run;
  },

  // Labels / tags — exclude categories (which are used for feeds)
  loadLabels: async () => {
    const scope = offlineScope(); // la réponse d'un serveur quitté n'a rien à dire ici
    try {
      const tags = await getTagList();
      if (offlineScope() !== scope) return;
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
    const scope = offlineScope(); // la réponse d'un serveur quitté n'a rien à dire ici
    const counts: Record<string, number> = { ...get().labelCounts };
    const PARALLEL = 3;
    for (let i = 0; i < labels.length; i += PARALLEL) {
      await Promise.all(
        labels.slice(i, i + PARALLEL).map(async (l) => {
          try { counts[l.id] = await getStreamItemCount(l.id); } catch { /* skip this label */ }
        })
      );
      if (offlineScope() !== scope) return;
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
    noteWrite(article.id, labelField(READ_LATER_LABEL), !removing);
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
    // Le corpus gardé suit l'optimisme, comme sur `toggleRead` — calculé sur
    // l'entrée courante, comme le rollback ci-dessous.
    patchSearchCorpus(article.id, (a) => ({ labels: withLabel(a.labels, READ_LATER_LABEL, !removing) }));
    const g = gesture();
    try {
      await setArticleLabel(article.id, READ_LATER_LABEL, !hasLabel);
      await settleAction(set, g, article, 'readLater', !hasLabel).catch(() => {});
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
        await enqueueAction(set, g, article, 'readLater', !hasLabel);
        return;
      }
      // Rollback on failure
      localWrites.rollback(g.scope, article.id, labelField(READ_LATER_LABEL), !!removing);
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
      // Rollback : le corpus revient avec la ligne — seule CETTE étiquette est
      // annulée, sur l'état courant (une autre posée entre-temps reste).
      patchSearchCorpus(article.id, (a) => ({ labels: withLabel(a.labels, READ_LATER_LABEL, !!removing) }));
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
    noteWrite(article.id, labelField(labelId), !hasLabel);
    set((state) => ({
      articles: state.articles.map(updateLabels),
      selectedArticle: state.selectedArticle
        ? updateLabels(state.selectedArticle)
        : null,
    }));
    // Le corpus gardé suit l'optimisme, comme sur `toggleReadLater` : sans
    // ce relais, la recherche suivante ressortait l'article sans l'étiquette.
    patchSearchCorpus(article.id, (a) => ({ labels: withLabel(a.labels, labelId, !hasLabel) }));
    const g = gesture();
    try {
      await setArticleLabel(article.id, labelId, !hasLabel);
      await settleAction(set, g, article, 'label', !hasLabel, labelId).catch(() => {});
      // Refresh labels list in case a new label was created
      get().loadLabels();
    } catch (err) {
      // No network: keep the optimistic state and replay it later. Only a
      // server refusal is rolled back.
      if (isNetworkFailure(err)) {
        await enqueueAction(set, g, article, 'label', !hasLabel, labelId);
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
      localWrites.rollback(g.scope, article.id, labelField(labelId), !!hasLabel);
      set((state) => ({
        articles: state.articles.map(rollbackLabels),
        selectedArticle: state.selectedArticle
          ? rollbackLabels(state.selectedArticle)
          : null,
      }));
      // Rollback : seule CETTE étiquette est annulée, sur l'état courant de
      // l'entrée — comme `rollbackLabels` sur la liste. Restaurer l'instantané
      // d'avant le clic emportait une seconde étiquette posée entre-temps.
      patchSearchCorpus(article.id, (a) => ({ labels: withLabel(a.labels, labelId, !!hasLabel) }));
    }
  },

  // Label management (rename / delete)
  renameLabel: async (oldLabelId, newName) => {
    const newLabelId = `user/-/label/${newName}`;
    try {
      await renameTag(oldLabelId, newLabelId);
      useUiStore.getState().moveViewRandom(useAuthStore.getState().activeServerId, oldLabelId, newLabelId);
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
      useUiStore.getState().moveViewRandom(useAuthStore.getState().activeServerId, categoryId, `user/-/label/${name}`);
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
    // Relevés AVANT l'appel : après une bascule de serveur pendant l'attente,
    // `feed/12` désigne un autre flux, que le reste retirait de la barre
    // latérale du nouveau serveur et de son instantané.
    const scope = offlineScope();
    const subsKey = storedKey('subscriptions');
    const subsBefore = get().subscriptions;
    try {
      await unsubscribeFeed(feedId);
      // Le désabonnement a bien eu lieu sur l'ancien serveur : l'état affiché
      // (celui du nouveau) n'est pas touché, mais ce qui est gardé hors ligne
      // pour l'ANCIEN l'est, sous sa portée et sa clé — sans quoi, de retour
      // hors ligne sur lui, l'accueil réaffichait le flux.
      if (offlineScope() !== scope) {
        subsPut(subsKey, subsBefore.filter((s) => s.id !== feedId)).catch(() => {});
        listsWithoutSource(`${scope}|`, feedId).catch(() => {});
        return true;
      }
      const wasOpen = get().selectedFeed?.id === feedId;
      useUiStore.getState().setViewRandom(useAuthStore.getState().activeServerId, feedId, false);
      // Le flux part de partout, pas seulement de la barre latérale : ses
      // articles restaient affichés sous « Tous les flux », avec son compteur,
      // dans le cache mémoire et dans l'instantané gardé pour le hors ligne.
      set((state) => {
        const unreadCounts = { ...state.unreadCounts };
        delete unreadCounts[feedId];
        return {
          subscriptions: state.subscriptions.filter((s) => s.id !== feedId),
          selectedFeed: wasOpen ? null : state.selectedFeed,
          randomView: wasOpen ? !state.searchQuery && canRandomView(state.filter) && opensRandom(null) : state.randomView,
          selectedArticle: state.selectedArticle?.sourceId === feedId ? null : state.selectedArticle,
          articles: state.articles.filter((a) => a.sourceId !== feedId),
          unreadCounts,
        };
      });
      memCache.clear();
      subsPut(subsKey, get().subscriptions).catch(() => {});
      // Les listes gardées pour le hors ligne aussi : sans quoi l'accueil,
      // rechargé hors ligne, réaffichait les articles du flux retiré.
      listsWithoutSource(`${scope}|`, feedId).catch(() => {});
      if (wasOpen) void get().loadArticles();
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
    // Important 1 (deuxième re-revue) : un ✓/non-lu déjà en vol AU DÉMARRAGE
    // de ce relevé a déjà bougé `unreadCounts` et déjà bumpé l'epoch — cette
    // comparaison avant/après n'y verra donc AUCUN écart si l'écriture ne se
    // règle pas pendant l'attente ci-dessous. Seul `writeWasInFlight`, lu
    // ici, le sait encore.
    const reading = beginCountsReading();
    try {
      const counts = await getUnreadCounts();
      // Ce relevé appartient au serveur sur lequel il a démarré : un autre est
      // actif entre-temps, ses compteurs décriraient un monde différent.
      // Fix 3 (revue finale) — rien n'est touché, pas même `unreadCounts`. Les
      // deux drapeaux module-level sont vidés ici : ils décrivaient un état
      // (planchers zéro expirés, file changée) qui appartient lui aussi au
      // serveur qu'on vient de quitter — `resetAndReload` les videra encore
      // à l'arrivée sur le nouveau, mais rien ne doit rester d'ici là.
      if (String(useAuthStore.getState().activeServerId) !== String(reading.serverId)) {
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
      const { selectedFeed, filter, searchQuery, subscriptions, unreadCounts, refreshPhase } = get();
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
      // relevé précédent (`skipNextArrivals`, consommée ici). Ces gardes
      // vivent dans `arrivalsInView`, partagé avec `loadSubscriptions`.
      //
      // `pendingActions > 0` a été RETIRÉ : `replayQueue` ne tourne qu'au
      // montage de l'app et sur l'événement `online` (`App.tsx`), donc une
      // seule action mise en file (un 5xx transitoire, par exemple) aurait
      // masqué la pastille pour toute la session — bien après que ce relevé
      // ait déjà écrasé le compte local par celui du serveur. Seul LE relevé
      // qui suit la mise en file doit l'ignorer ; `skipNextArrivals` (posé
      // par `enqueueAction`) le fait déjà et se consomme en un seul coup.
      const arrived = arrivalsInView(reading, unreadCounts, next, feedIds, refreshPhase);
      set((s) => ({ unreadCounts: next, newInView: s.randomView ? 0 : s.newInView + arrived }));
      // Also refresh starred & read-later counts
      get().loadSpecialCounts();
    } catch { /* ignore */ }
  },

  // Full sync — refresh counters + reload current article list
  // Used when tab regains visibility (cross-device scenario)
  silentRefresh: async () => {
    await get().syncCounts();
    // Une recherche affiche sa propre liste (`searchResults` filtrés par le
    // balayage), sous un en-tête qui l'annonce toujours — `viewKey` l'ignore
    // (flux + filtre seulement). Un retour d'onglet ou un tirer-pour-
    // rafraîchir mobile déclenchent ce chemin PENDANT une recherche déjà
    // terminée aussi bien qu'au démarrage : le flux nu remplaçait alors les
    // résultats sous l'en-tête « Recherche : … » (I1, revue finale). Ce
    // chemin complète donc la recherche par le haut au lieu de recharger la
    // vue nue — il renonçait sans rien faire, et le tirer-pour-rafraîchir
    // tournait à vide. Revérifié après l'attente réseau : une recherche a pu
    // démarrer pendant le vol.
    if (get().searchQuery) {
      await topUpSearch();
      return;
    }
    // Un tirage ne se relit pas : la liste changerait sous les yeux, sans geste.
    if (get().randomView) return;
    // Silently reload current article list (no loading spinner)
    const { selectedFeed, filter } = get();
    // La vue affichée au moment de la requête — comme `loadArticles` avec
    // `sameView()`. Sans ce garde-fou (M2, revue finale), un résultat qui
    // arrive après un changement de vue écrirait `articles` et remettrait
    // `newInView` à zéro pour une vue qui n'est plus à l'écran.
    const key = viewKey(selectedFeed, filter);
    const since = localWrites.mark();
    try {
      const result = await fetchArticleStream(filter, selectedFeed, PAGE_SIZE, null);
      if (!result) return;
      if (viewKey(get().selectedFeed, get().filter) !== key || get().searchQuery || get().randomView) return;
      const newArticles = reconcile(result.items.map(normalizeArticle), filter, since);
      rebuiltViews.delete(key); // une vraie réponse : la liste affichée n'est plus construite
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
          // … et plus d'échec à afficher, même si elle revient vide.
          listFailed: false,
        };
      });
    } catch { /* ignore */ }
  },

  loadNewArticles: async () => {
    set({ newInView: 0 });
    await get().loadArticles();
  },

  dismissNewArticles: () => {
    set({ newInView: 0 });
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
      await get().loadSubscriptions({ countArrivals: false });
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
      await get().loadSubscriptions({ countArrivals: false });
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
      phase = nextPhase(status?.status, startedAt, Date.now(), !!status?.continuing);
      set({
        refreshPhase: phase,
        refreshResult: {
          ...computeRefreshDelta(before, get().unreadCounts),
          at: Date.now(),
        },
      });
    }

    // Final load once the job resolved, so the visible list matches the counters.
    await get().loadSubscriptions({ countArrivals: false });
    await get().loadArticles();
    if (!stillActive()) return;
    const { totalNew, newByFeed } = computeRefreshDelta(before, get().unreadCounts);
    set({ refreshResult: { totalNew, newByFeed, at: Date.now() }, refreshPhase: phase });
  },

  replayQueue: async () => {
    if (replayInFlight) return replayInFlight;
    const run = (async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    // Sans session (écran de connexion, session expirée), rien ne part : un
    // 401 jetait toute la file, sans qu'aucune action ait été tentée.
    const auth = useAuthStore.getState();
    if (!auth.backendToken || !auth.activeServerId) return;
    // Relevés AVANT toute attente, portée comprise : le contrôle compare
    // l'état d'entrée, pas celui d'après le chargement de la file. Relevée
    // après, la portée d'une session fermée pendant ce chargement valait
    // « @ », et les actions d'avant 1.8.0 y étaient adoptées pour toujours.
    const jeton = auth.backendToken;
    const serveur = String(auth.activeServerId);
    const generation = scopeGeneration;
    const scope = offlineScope();
    await loadQueue();
    // Revérifié avant CHAQUE action, comme `restoreUnread` : le rejeu peut
    // porter des dizaines d'écritures, et un changement de serveur en route
    // envoyait les suivantes au nouveau (le client lit le serveur actif au
    // moment de la requête), qui les acceptait sans effet — sorties de la
    // file, perdues pour le premier. Après une déconnexion, elles partaient
    // brutes, hors du proxy, recevaient un 404 et étaient jetées. La
    // génération ferme l'aller-retour 1 → 2 → 1 pendant un envoi : les deux
    // bouts voient le serveur 1, mais l'écriture, construite après l'attente
    // du jeton d'écriture, est partie au 2.
    const memeContexte = () => {
      const now = useAuthStore.getState();
      return now.backendToken === jeton && String(now.activeServerId ?? '') === serveur
        && offlineScope() === scope && scopeGeneration === generation;
    };
    // Plus la session d'entrée : le rejeu de la portée suivante s'en charge.
    if (!memeContexte()) return;

    // Seules les actions du compte et du serveur actifs partent ; les autres
    // attendent le leur. Une ancienne action, sans portée (avant 1.8.0),
    // adopte la portée active, comme avant 1.8.0 : le cas courant est un seul
    // compte, et les numéros d'article FreshRSS sont horodatés à la
    // microseconde — une collision d'un serveur à l'autre est très
    // improbable, alors que ne plus la rejouer la perdait sans un mot.
    await adoptUnscopedActions(scope);
    const mine = actionQueue.filter((a) => a.scope === scope);
    // Rien en attente ici : un avertissement « FreshRSS refuse » ne décrit
    // plus rien (`pendingPatch`).
    if (!mine.length) { if (memeContexte()) set(pendingPatch(scope)); return; }

    const remaining: QueuedAction[] = [];
    let failed = 0;
    let stopped = false;
    let delivered = false;
    let refused = false;
    for (const action of mine) {
      if (!stopped && !memeContexte()) stopped = true;
      // Arrêté : l'action et les suivantes restent, intactes, pour le retour
      // de leur portée (qui relance le rejeu, voir l'abonnement plus bas).
      if (stopped) { remaining.push(action); continue; }
      // Remplacée ou réglée par un geste direct depuis le début du rejeu :
      // l'envoyer écraserait ce geste.
      const current = actionQueue.find((a) => a.key === action.key);
      if (!current || current.at !== action.at) continue;
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
        // La bascule a eu lieu PENDANT l'envoi : rien ne dit quel serveur
        // l'a reçue. Gardée — renvoyer le même état est sans danger.
        if (!memeContexte()) { stopped = true; remaining.push(action); }
        else {
          delivered = true;
          // La file se videra en fin de rejeu, et une lecture partie avant cet envoi
          // n'en saura rien : le registre prend le relais d'`applyQueued`.
          noteConfirmed(scope, action.articleId, writeFieldOf(action.type, action.labelId), action.value);
          // Le rejeu règle lui aussi les gestes plus anciens encore en vol :
          // sans cela, un « lu » resté bloqué tombait en délai dépassé après
          // l'envoi du « non lu » suivant, entrait en file, et le rejeu
          // d'après écrasait la dernière intention.
          if (action.seq && (settledGestures.get(action.key) ?? 0) < action.seq) {
            settledGestures.set(action.key, action.seq);
          }
        }
      } catch (err) {
        // Le contexte a changé pendant l'envoi (déconnexion, autre serveur),
        // ou notre propre session est refusée : ni l'un ni l'autre n'est la
        // faute de l'action. Elle et les suivantes restent.
        if (!memeContexte() || isBackendAuthFailure(err)) {
          stopped = true;
          remaining.push(action);
          continue;
        }
        // Un 401 relayé de FreshRSS (mot de passe d'API changé, jeton
        // périmé côté FriRSS) ne déconnecte pas FriRSS, et chaque action
        // suivante recevrait le même : traité comme un refus, il jetait
        // TOUTE la file en un rejeu. On s'arrête, on garde tout sans compter
        // de tentative, et le bandeau le dit (`replayRefusedByServer`).
        if ((err as { response?: { status?: number } })?.response?.status === 401) {
          stopped = true;
          refused = true;
          remaining.push(action);
          continue;
        }
        const attempts = action.attempts + 1;
        // A refusal will never succeed; only keep what is worth retrying.
        if (isNetworkFailure(err) && shouldRetry(attempts)) remaining.push({ ...action, attempts });
        else {
          failed++;
          // Le geste était sur les listes gardées, et le serveur ne l'aura pas.
          // Pas s'il a été remplacé entre-temps : les listes portent le suivant.
          if (actionQueue.find((a) => a.key === action.key)?.at === action.at) {
            reportOnLists(scope, action.sourceId, action.articleId, writeFieldOf(action.type, action.labelId), action.before ?? !action.value);
          }
        }
      }
    }

    // Une action abandonnée — refusée par le serveur OU rejetée après trop
    // d'échecs, les deux tombent dans `failed` ci-dessus — laisse un ✓ local
    // sans correspondant côté serveur : le prochain relevé de compteurs le
    // lirait comme une arrivée qui ne s'efface jamais.
    if (failed > 0) skipNextArrivals = true;
    // Fusion avec la file ACTUELLE : une action mise en file pendant le rejeu
    // (réseau instable) était écrasée par `remaining`. Une action rejouée
    // sort de la file (ou y reste pour un nouvel essai) seulement si elle n'a
    // pas été remplacée entre-temps par un geste plus récent sur le même
    // article.
    const replayed = new Map(mine.map((a) => [a.key, a]));
    const retry = new Map(remaining.map((a) => [a.key, a]));
    actionQueue = actionQueue.flatMap((a) => {
      const sent = replayed.get(a.key);
      if (!sent || sent.at !== a.at) return [a];
      const again = retry.get(a.key);
      return again ? [again] : [];
    });
    await queuePut(actionQueue);
    set({
      ...pendingPatch(),
      failedActions: failed,
      // Refusé : l'avertissement reste jusqu'à un rejeu qui fait passer une
      // action, ou jusqu'à ce que la portée n'ait plus rien en attente. Posé
      // seulement si la session d'entrée est encore là : après une bascule
      // pendant l'écriture ci-dessus, le refus du serveur quitté s'affichait
      // sur le suivant, dont le rejeu n'avait rien à dire.
      ...(refused
        ? (memeContexte() ? { replayRefusedByServer: true } : {})
        : delivered ? { replayRefusedByServer: false } : {}),
    });
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
    set({ randomView: false });
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
      listFailed: false,
      // A refresh in flight belongs to the server we are leaving; its loop
      // abandons itself. Clear its state here so the banner doesn't stay
      // pinned on the new server and the re-entrancy guard doesn't wedge the
      // Refresh button shut.
      refreshPhase: 'idle',
      refreshResult: null,
    });
    const subscriptions = get().loadSubscriptions();
    // Le nouveau serveur a ses propres choix.
    set({ randomView: viewOpensRandom(get()) });
    if (!get().randomView) {
      get().loadArticles();
      return;
    }
    // Un tirage de l'accueil lit le flux que les abonnements désignent.
    const view = viewIdentity(get());
    const draw = () => {
      if (viewIdentity(get()) === view && get().randomView) get().loadArticles();
    };
    void subscriptions.then(draw, draw);
  },
}));

/**
 * La file des marquages de plage (« lu au-dessus / en dessous »).
 *
 * Chaînée plutôt que verrouillée : chaque demande se range derrière la
 * précédente et son exécution part dès que celle-ci est réglée, réussie ou
 * non. Voir `markReadRelative`.
 */
let rangeQueue: Promise<void> = Promise.resolve();
/** Marquages de plage demandés et pas encore réglés : zéro = la file est vide, on part sans attendre. */
let rangeWaiting = 0;

/**
 * Combien d'écritures de masse sont demandées ou en cours (marquages de
 * plage, « tout lu »). `bulkWork` est UN seul champ que toutes se partagent :
 * sans compte, la première à finir éteignait la barre de celles qui
 * tournaient encore.
 */
let bulkPending = 0;

/** Le champ `bulkWork` tel qu'il doit être quand rien ne le précise : allumé tant qu'une écriture est attendue. */
function refreshBulkDisplay(): void {
  useFeedStore.setState({ bulkWork: bulkPending > 0 ? { done: 0, total: null } : null });
}

/** Une écriture de masse est demandée : la barre s'allume tout de suite, indéterminée. */
function beginBulk(): void {
  bulkPending++;
  // Ne pas écraser l'avancement chiffré d'une écriture déjà en cours.
  if (!useFeedStore.getState().bulkWork) refreshBulkDisplay();
}

/** Elle est réglée. La barre ne s'éteint que s'il n'en reste aucune ; sinon elle repart indéterminée. */
function endBulk(): void {
  bulkPending = Math.max(0, bulkPending - 1);
  refreshBulkDisplay();
}

/**
 * Combien d'identifiants par écriture de retour en arrière.
 *
 * 100, la taille qu'emploie déjà le marquage de plage sans jamais avoir posé
 * de problème. Un premier essai à 500 a été retiré : mesuré sur l'instance de
 * dev le 2026-09-30, un lot de 500 a expiré au bout de 30 s
 * (`POST /api/proxy 504`) et a bloqué FreshRSS pendant ce temps — la lecture
 * suivante a expiré aussi. Ce n'est pas la taille de la requête qui coince
 * (dix kilo-octets), c'est le travail demandé à la base d'un coup.
 */
const UNDO_BATCH = 100;

/**
 * Le relevé lancé pendant que la question est à l'écran, s'il y en a un.
 *
 * Il porte SON périmètre : annuler la boîte, changer de flux puis marquer
 * ailleurs consommerait sinon le relevé de la vue précédente, et le retour en
 * arrière rendrait non lus des articles qu'on n'a pas marqués.
 */
let undoSnapshot: { streamId: string; ids: Promise<string[] | null> } | null = null;

/**
 * Les non-lus du flux avant un « tout lu », ou `null` quand rien ne peut être
 * promis — relevé impossible, ou interrompu par la borne de pages.
 */
async function snapshotUnread(streamId: string): Promise<string[] | null> {
  try {
    const { ids, complete } = await getUnreadItemIds(streamId);
    return complete && ids.length ? ids : null;
  } catch {
    return null;
  }
}

/**
 * Rendre non lus les articles relevés.
 *
 * La vue est rechargée depuis le serveur plutôt que rapiécée sur place : les
 * identifiants relevés sont la forme DÉCIMALE de `stream/items/ids`, quand les
 * lignes à l'écran portent la forme hexadécimale d'`Article.id`. Les rapprocher
 * demanderait `entryIdUsec` sur chaque ligne, pour un résultat qu'une relecture
 * donne exactement.
 */
async function restoreUnread(ids: readonly string[], toastId: number): Promise<void> {
  const total = ids.length;
  const scope = offlineScope();
  let rendus = 0;
  // Vérifié avant CHAQUE lot, pas seulement au clic : un changement de
  // serveur (ou une déconnexion) en route enverrait les lots suivants au
  // nouveau, où les mêmes numéros désignent d'autres articles.
  const serveur = String(useAuthStore.getState().activeServerId ?? '');
  const jeton = useAuthStore.getState().backendToken;
  const memeContexte = () => {
    const auth = useAuthStore.getState();
    return String(auth.activeServerId ?? '') === serveur && auth.backendToken === jeton;
  };
  const { default: i18n } = await import('../i18n');
  const ui = useUiStore.getState();
  // Le bandeau qu'on vient de cliquer DEVIENT l'avancement : c'est là que le
  // regard est resté, pas en haut de la fenêtre. L'action disparaît — il n'y a
  // plus rien à décider tant que ça tourne.
  ui.updateToast(toastId, {
    message: i18n.t('toast.undoing', { done: 0, total }),
    action: undefined,
    progress: { done: 0, total },
  });
  // Dans le compteur comme toute écriture de masse : sans quoi un marquage de
  // plage qui se règle pendant la restauration éteindrait sa barre.
  beginBulk();
  useFeedStore.setState({ bulkWork: { done: 0, total } });
  try {
    for (let i = 0; i < total; i += UNDO_BATCH) {
      if (!memeContexte()) break;
      const lot = ids.slice(i, i + UNDO_BATCH) as string[];
      try {
        await markAsUnread(lot);
      } catch {
        // Une seule reprise, comme les écritures d'article : un 504 vient
        // d'une base occupée, pas d'une demande invalide — elle passe souvent
        // au second essai.
        try {
          await markAsUnread(lot);
        } catch {
          // Ce lot est perdu, les suivants ne le sont pas : s'arrêter ici
          // laisserait la liste à moitié rendue SANS le dire, ce qui est
          // exactement ce qui est arrivé le 2026-09-30.
          continue;
        }
      }
      rendus += lot.length;
      useFeedStore.setState({ bulkWork: { done: rendus, total } });
      ui.updateToast(toastId, {
        message: i18n.t('toast.undoing', { done: rendus, total }),
        progress: { done: rendus, total },
      });
    }
  } finally {
    // Pas `bulkWork: null` en dur : une autre écriture de masse peut tourner encore.
    endBulk();
  }

  bumpCountsEpoch();
  // Les vues sœurs ont suivi le « Tout lu » (`markStreamReadInViews`) et ne savent
  // rien de ce retour : elles se relisent plutôt que de repeindre des lignes lues.
  // Le disque reste comme il est, faute de savoir quoi rendre sans relire chaque
  // liste. La vue affichée garde sa peinture : elle est relue juste en dessous, et
  // sans elle la liste passait au squelette.
  const shownKey = viewKey(useFeedStore.getState().selectedFeed, useFeedStore.getState().filter);
  for (const key of [...memCache.keys()]) {
    if (key !== shownKey && parseViewKey(key)?.scope === scope) memCache.delete(key);
  }
  // La vue est relue DANS TOUS LES CAS, même partielle : l'ancien code
  // renonçait dès le premier échec, et l'écran restait sur un état que le
  // serveur n'avait plus.
  try {
    await useFeedStore.getState().syncCounts();
    await useFeedStore.getState().loadArticles();
  } catch { /* la relecture peut échouer : les articles, eux, sont rendus */ }

  // Le même bandeau porte le résultat : retirer l'avancement lui rend son
  // minuteur d'effacement.
  ui.updateToast(toastId, {
    message: rendus === total
      ? i18n.t('toast.undoDone', { count: rendus })
      : i18n.t('toast.undoPartial', { count: rendus, total }),
    tone: rendus === total ? undefined : 'error',
    progress: undefined,
  });
}

/** Une entrée de corpus : l'article et son texte cherchable, calculé une fois. */
function toCorpusEntry(item: GReaderItem): CorpusEntry {
  const article = normalizeArticle(item);
  return { article, haystack: articleHaystack(article) };
}

/**
 * Balaye le périmètre page par page et filtre au passage.
 *
 * Séquentiel par nature : chaque page porte la continuation de la suivante. Les
 * résultats sont poussés à chaque tranche — une recherche qui n'a rien trouvé et
 * une recherche qui n'a pas fini se ressemblent trop pour attendre la fin.
 *
 * Seule la tranche NOUVELLE est filtrée (`matchPage`) et ses correspondances
 * s'ajoutent à celles de l'état : refiltrer tout le corpus à chaque page
 * coûtait 1 000 + 2 000 + … + 10 000 tests pour un flux de 10 000 articles.
 * Accumuler sur `searchResults` plutôt que sur une copie locale garde aussi
 * ce qu'on a fait entre deux pages (une coche, une étiquette).
 *
 * `view` est l'identité de la vue (`viewIdentity`) retenue à l'entrée. Les
 * changements de vue passent par `closeSearch`, qui avance `scanToken` ; la
 * garde de vue reste en second filet, pour tout chemin qui changerait de flux
 * ou de filtre sans passer par là — une page arrivée après coup écrirait
 * sinon les articles de l'ancien flux dans la nouvelle vue. Revérifiée après
 * CHAQUE `await`, comme dans `loadMore`.
 */
async function runScan(token: number, streamId: string, view: string): Promise<void> {
  const stale = () =>
    token !== scanToken || !searchCorpus || viewIdentity(useFeedStore.getState()) !== view;
  try {
    for (;;) {
      if (stale()) return;
      const result = await fetchStreamPage(streamId, SCAN_PAGE, searchCorpus!.continuation);
      if (stale()) return;
      const before = searchCorpus!.entries.length;
      searchCorpus = addPage(searchCorpus!, result.items.map(toCorpusEntry), result.continuation, Date.now());
      // `addPage` ajoute en queue, doublons écartés : la tranche nouvelle est
      // exactement ce qui dépasse l'ancienne longueur.
      const found = matchPage(searchCorpus.entries.slice(before), scanTerms);
      const complete = searchCorpus.complete;
      const scanned = searchCorpus.entries.length;
      useFeedStore.setState((s) => {
        // Les nouvelles lignes n'entrent à l'écran que dans la place encore
        // libre de la tranche visible ; le reste attend « Afficher plus ».
        const room = Math.max(0, s.searchVisible - s.searchResults.length);
        return {
          searchResults: found.length ? [...s.searchResults, ...found] : s.searchResults,
          articles: room && found.length ? [...s.articles, ...found.slice(0, room)] : s.articles,
          searchScan: { running: !complete, scanned, done: complete, stopped: false, error: null },
        };
      });
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

/**
 * Au-delà, le haut du flux a trop bougé pour être recousu au corpus : mieux
 * vaut ne rien ajouter qu'ajouter des articles en laissant un trou entre eux
 * et le balayage. Le corpus est alors jeté (la recherche suivante rebalaye).
 * 20 pages de `PAGE_SIZE`, soit un millier d'arrivées.
 */
const TOP_UP_MAX_PAGES = 20;

/** Cette vue s'ouvre en aléatoire. Hors ligne, elle s'ouvre normalement : un tirage demande le réseau. */
function opensRandom(feed: Subscription | null): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  const key = randomViewKey(useAuthStore.getState().activeServerId, feed?.id ?? '');
  return useUiStore.getState().randomViews[key] === true;
}

const viewOpensRandom = (s: Pick<FeedState, 'filter' | 'selectedFeed'>) =>
  canRandomView(s.filter) && opensRandom(s.selectedFeed);

/** Le dernier tirage lancé : lui seul a le droit d'écrire la liste. */
let randomDrawToken = 0;

/**
 * Un nouveau tirage dans la vue affichée, à la place de la liste. Rien ne le range :
 * ni `memSet`, ni `listPut`, et `persistCurrentView` s'abstient dans ce mode. Pas de
 * `warmExtracts` non plus, le tirage suivant rendrait ce travail inutile.
 */
async function drawRandomList(): Promise<void> {
  const before = useFeedStore.getState();
  const { selectedFeed, filter, subscriptions } = before;
  const token = ++randomDrawToken;
  const view = viewIdentity(before);
  const since = localWrites.mark();
  const stale = () => {
    const now = useFeedStore.getState();
    const gone = token !== randomDrawToken || !now.randomView || viewIdentity(now) !== view;
    // Une recherche a pris la main : personne d'autre ne relèvera ce drapeau,
    // comme dans `loadArticles`.
    if (gone && token === randomDrawToken && now.searchQuery) useFeedStore.setState({ revalidating: false });
    return gone;
  };
  useFeedStore.setState({ articles: [], continuation: null, loading: true, revalidating: true, newInView: 0, listFailed: false });
  const { randomCount, randomWindowAmount, randomWindowUnit } = useUiStore.getState();
  try {
    const ids = await getStreamIdsSince(resolveSearchStreamId(selectedFeed, filter, subscriptions), {
      excludeRead: filter === 'unread',
      cutoffUsec: randomCutoffUsec(randomWindowAmount, randomWindowUnit, Date.now()),
      max: RANDOM_MAX_IDS,
    });
    const drawn = drawIds(ids, randomCount);
    const items = await getItemsByIds(drawn);
    await ensureQueue();
    if (stale()) return;
    const articles = reconcile(inDrawOrder(items, drawn).map(normalizeArticle), filter, since);
    useFeedStore.setState((s) => ({
      articles, continuation: null, loading: false, revalidating: false, randomDraw: s.randomDraw + 1,
    }));
  } catch (err) {
    if (stale()) return;
    console.error('[FriRSS] drawRandomList error:', err);
    // Sans réponse du serveur, `navigator.onLine` peut rester vrai (NAS arrêté, VPN
    // coupé) : la vue normale prend le relais, avec sa liste gardée. Le réglage reste.
    // Un 500 ou un refus est une réponse : il se dit, avec « Réessayer ».
    const status = (err as { response?: { status?: number } } | null)?.response?.status;
    if (status === undefined || [502, 503, 504].includes(status)) {
      showRandomView(false);
      return;
    }
    useFeedStore.setState({ loading: false, revalidating: false, listFailed: true });
  }
}

/**
 * Entre dans un tirage ou en sort, liste comprise. Une page en vol appartient à la
 * liste qui s'en va : `loadMore` la jette sur `listGeneration`.
 */
function showRandomView(on: boolean): void {
  const { selectedFeed, filter, loadArticles } = useFeedStore.getState();
  listGeneration++;
  const c = on ? undefined : memGet(viewKey(selectedFeed, filter));
  useFeedStore.setState({ randomView: on, articles: c?.articles || [], continuation: c?.continuation || null, loading: !c });
  void loadArticles();
}

/**
 * Rafraîchir pendant une recherche : la compléter par le haut.
 *
 * Seules les entrées plus récentes que la plus récente du corpus sont lues
 * (`newerEntries`) — des pages de `PAGE_SIZE` depuis le haut du flux jusqu'au
 * premier article connu, en pratique une seule requête —, jamais un
 * rebalayage complet (~10 s sur un gros flux). Celles qui correspondent
 * entrent en tête des résultats et de la liste, et la tranche visible
 * s'élargit d'autant : rien de ce qui était affiché ne disparaît.
 *
 * Ne fait rien sans corpus du périmètre courant, pendant un balayage (il lit
 * déjà le flux), hors ligne ou après une recherche faite hors ligne, ou sur
 * un corpus vide et incomplet (le balayage a échoué d'emblée : il n'y a rien
 * à compléter, « Réessayer » s'en charge).
 * Une erreur réseau est muette : la recherche reste ce qu'elle était.
 */
async function topUpSearch(): Promise<void> {
  const s = useFeedStore.getState();
  if (!s.searchQuery || s.searchScan.running || !searchCorpus) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  // Une recherche faite hors ligne n'est pas adossée au corpus : elle a
  // fouillé la liste en mémoire et la barre d'état le dit. La compléter
  // depuis un corpus resté en mémoire, et réécrire `scanned` à sa taille,
  // ferait mentir cette barre. Une nouvelle recherche, en ligne, rebalaye.
  if (s.searchScan.error === 'offline') return;
  const streamId = resolveSearchStreamId(s.selectedFeed, s.filter, s.subscriptions);
  const serverId = String(useAuthStore.getState().activeServerId ?? '');
  if (searchCorpus.streamId !== streamId || searchCorpus.serverId !== serverId) return;
  if (!searchCorpus.entries.length && !searchCorpus.complete) return;

  const token = scanToken;
  const view = viewIdentity(s);
  const stale = () =>
    token !== scanToken || !searchCorpus || viewIdentity(useFeedStore.getState()) !== view;
  const fresh: CorpusEntry[] = [];
  let continuation: string | null = null;
  try {
    for (let pages = 0; ; pages++) {
      if (pages === TOP_UP_MAX_PAGES) {
        // Le corpus ne se recoud plus : le jeter, sans quoi chaque Rafraîchir
        // ou retour d'onglet refaisait ces vingt requêtes pour rien. Les
        // résultats affichés restent ; la recherche suivante rebalaye.
        dropSearchCorpus();
        return;
      }
      const result = await fetchStreamPage(streamId, PAGE_SIZE, continuation);
      if (stale()) return;
      const { fresh: newer, reachedKnown } = newerEntries(searchCorpus!, result.items.map(toCorpusEntry));
      fresh.push(...newer);
      if (reachedKnown || !result.continuation) break;
      continuation = result.continuation;
    }
  } catch {
    return;
  }
  if (stale() || !fresh.length) return;

  const before = searchCorpus!.entries.length;
  searchCorpus = prependEntries(searchCorpus!, fresh);
  const found = matchPage(searchCorpus.entries.slice(0, searchCorpus.entries.length - before), scanTerms);
  const scanned = searchCorpus.entries.length;
  useFeedStore.setState((st) => ({
    searchResults: found.length ? [...found, ...st.searchResults] : st.searchResults,
    articles: found.length ? [...found, ...st.articles] : st.articles,
    searchVisible: st.searchVisible + found.length,
    searchScan: { ...st.searchScan, scanned },
  }));
}

/**
 * La session FriRSS se ferme (déconnexion, ou jeton refusé — les deux
 * passent par `logoutBackend`) : le corpus balayé et les résultats affichés
 * appartenaient à ce compte. Gardés en mémoire, ils resteraient lisibles par
 * le compte suivant ouvert dans le même navigateur.
 *
 * Un abonnement plutôt qu'un appel depuis `authStore` : ce module importe
 * déjà `authStore`, l'inverse fermerait un cycle d'imports.
 */
useAuthStore.subscribe((state, prev) => {
  if (!prev.backendToken || state.backendToken) return;
  dropSearchCorpus();
  closeSearch(useFeedStore.setState);
  // Le compte suivant sur ce navigateur ne voit rien de celui-ci (listes et
  // barre latérale gardées pour le hors ligne ; la file d'actions, rangée par
  // compte, reste pour son retour).
  memCache.clear();
  // Les vues de CE compte seulement, tous serveurs confondus (`7@…|`) : la
  // base est commune à tous les onglets, et un onglet resté sur un ancien
  // compte effaçait, en se déconnectant, celles du compte ouvert à côté.
  void clearOfflineViews(`${accountOf(prev)}@`);
  void dropUnscopedActions();
});

/**
 * Les actions mises en file avant 1.8.0 ne portent pas de compte : le
 * premier rejeu sous une session les adopte (`adoptUnscopedActions`). Celles
 * qu'aucune portée n'a encore prises (hors ligne de bout en bout) partent à
 * la déconnexion : le compte suivant n'a aucune raison de les recevoir.
 */
async function dropUnscopedActions(): Promise<void> {
  await loadQueue();
  if (!actionQueue.some((a) => !a.scope)) return;
  actionQueue = actionQueue.filter((a) => a.scope);
  await queuePut(actionQueue);
  useFeedStore.setState(pendingPatch());
}

/**
 * La portée change (connexion, retour SSO, changement de serveur) : le
 * compteur du bandeau suit, et les actions qui attendaient CETTE portée
 * partent. Sans ce relais, elles n'étaient rejouées qu'au prochain
 * rechargement ou retour du réseau — et écrasaient entre-temps les gestes
 * faits en ligne sur les mêmes articles. Un rejeu en cours pour l'ancienne
 * portée s'arrête de lui-même (`memeContexte`) : on l'attend, puis on relance.
 */
useAuthStore.subscribe((state, prev) => {
  const scope = scopeOf(state);
  if (scope === scopeOf(prev)) return;
  scopeGeneration++;
  // Le refus de FreshRSS appartenait à l'autre portée : le rejeu de celle-ci
  // le reposera s'il a lieu ici aussi.
  useFeedStore.setState({ replayRefusedByServer: false, randomView: false });
  if (queueLoaded) useFeedStore.setState(pendingPatch(scope));
  if (!state.backendToken || !state.activeServerId) return;
  void (replayInFlight ?? Promise.resolve())
    .catch(() => {})
    .then(() => useFeedStore.getState().replayQueue())
    .catch(() => {});
});

/**
 * Un article greader vers l'article de l'app. Titres et nom du flux : rendus
 * en ASCII (`fromFreshrssTitle`). Un article sans titre garde `title: ''` : le
 * libellé traduit se pose au rendu (`src/lib/articleTitle.ts`). Calculé ici, il
 * restait figé dans le cache mémoire et la liste hors ligne après un changement
 * de langue, et la recherche l'indexait.
 */
export function normalizeArticle(item: GReaderItem): Article {
  return {
    id: item.id,
    title: fromFreshrssTitle(item.title),
    summary:
      item.summary?.content?.replace(/<[^<>]*>/g, '').slice(0, 200) || '',
    content: item.content?.content || item.summary?.content || '',
    author: item.author || '',
    url: item.canonical?.[0]?.href || item.alternate?.[0]?.href || '',
    source: fromFreshrssName(item.origin?.title),
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
