import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties, type ReactNode, type MouseEvent as ReactMouseEvent, type DragEvent as ReactDragEvent } from 'react';
import { flushSync } from 'react-dom';
import { focusSidebar } from '../../lib/focusSidebar';
import { useTranslation } from 'react-i18next';
import { useFeedStore, READ_LATER_LABEL, isCategoryStreamId } from '../../stores/feedStore';
import { useUiStore } from '../../stores/uiStore';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { groupByDate } from '../../utils/dates';
import { markAllReadAction, canMarkAllRead, UNDO_CAP } from '../../lib/markAllRead';
import { showEndOfListMarkAll } from '../../lib/endOfList';
import { canRandomView } from '../../lib/randomDraw';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useToolbarFold } from '../../hooks/useToolbarFold';
import { useToolbarShown } from '../../hooks/useToolbarShown';
import { separatorsBefore } from '../../lib/toolbarItems';
import { useToolbarCommands, type ToolbarOffer } from '../../lib/toolbarCommands';
import { feedOverride } from '../../lib/feedOverride';
import { effectiveLayout } from '../../lib/effectiveLayout';
import { effectiveOrder, entryDirection } from '../../lib/effectiveOrder';
import { viewUnreadCount } from '../../lib/mainStream';
import { shouldLoadMore, listBodyState, canLoadMore, searchAwareHasContinuation } from '../../lib/listPagination';
import { listOverflows, publishListCanScroll, resetListCanScroll } from '../../lib/listOverflow';
import { ROW_SLICE, mountedRows, nextRowLimit } from '../../lib/listWindow';
import { revealScrollTop, listAnchor, anchoredScrollTop, type ListAnchor } from '../../lib/listScroll';
import { extractImageFromContent } from '../../lib/articleThumbnail';
import { openArticleAtSource } from '../../lib/openArticleAtSource';
import { markReadOnBackgroundOpen } from '../../lib/titleLink';
import type { RowActionSettings } from '../../lib/rowActions';
import { timeAgo } from '../../lib/timeAgo';
import ViewModeSwitcher from './ViewModeSwitcher';
import SwipeableArticleRow from './SwipeableArticleRow';
import { ArticleRowActions } from './ArticleActions';
import TitleLink from './TitleLink';
import ArticleCard from './ArticleCard';
import FeedFavicon from '../FeedFavicon';
import BottomSheet from '../BottomSheet';
import ArticleContextMenu from './ArticleContextMenu';
import NewArticlesBanner from './NewArticlesBanner';
import { newArticlesOffsetStyle } from '../../lib/newArticles';
import SearchScanBar from './SearchScanBar';
import SearchBar from './SearchBar';
import ConfirmDialog from '../ConfirmDialog';
import Highlighted from './Highlighted';
import { resultSummary } from '../../lib/searchHighlight';
import { articleTitle } from '../../lib/articleTitle';
import { parseQuery } from '../../lib/searchMatch';
import { useArticleMenuGestures } from '../../hooks/useArticleMenuGestures';
import { RowPressContext, createRowPressRegistry } from '../../hooks/rowPress';
import { copyLink } from '../../lib/copyLink';
import { useAuthStore } from '../../stores/authStore';
import { loadSearchHistory, rememberSearch, forgetSearch, focusAfterForget } from '../../lib/searchHistory';
import { scrolledPastTop, shouldMark, MARK_READ_DELAY_MS } from '../../lib/markReadOnScroll';
import { canMorph, withMorph } from '../../lib/viewTransition';
import { noFocusOnPointer } from '../../lib/pointerFocus';
import { prefersReducedMotion } from '../../lib/reducedMotion';
import { staggerIndexes, rememberStagger } from '../../lib/rowStagger';
import type { Article, Filter } from '../../types';
import { gridCardStyle, gridClassName } from '../../lib/gridCards';

// Per-view scroll position, kept across remounts (e.g. returning from an
// article in 2-panel desktop, or any re-mount of the list).
const listScrollMem = new Map<string, number>();
// Lignes montées par vue, pour la même raison : une position de défilement ne se
// restaure que dans une liste qui a la même hauteur.
const listLimitMem = new Map<string, number>();
/** Sélecteur d'une ligne (ou carte) de la liste par l'id de son article. */
const rowSelector = (id: string) =>
  `[data-article-id="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id}"]`;

interface PullState {
  startY?: number;
  atTop?: boolean;
  pulling?: boolean;
  dist?: number;
}

/**
 * Séparateur de jour (« Aujourd'hui  12 »), collé en haut de la liste en
 * défilant — en liste comme en grille. Ces bandeaux sont les seuls repères de
 * progression d'un scroll infini. Ils étaient à 10 px dans le gris le plus
 * clair de la palette : plus décoratifs qu'utiles. Le compte du jour en fait
 * un vrai repère. `.date-separator` (`index.css`) porte son `top` : il descend
 * sous le bandeau « nouveaux articles » tant que celui-ci s'affiche, au lieu
 * d'être recouvert (z-index 10 sous 15).
 */
export function DateSeparator({ label, count }: { label: string | null; count: number }) {
  return (
    <div
      className="date-separator px-4 py-1.5 text-[11px] font-semibold uppercase tracking-widest sticky z-10 flex items-center gap-2"
      style={{
        color: 'var(--list-summary)',
        background: 'var(--panel-header-bg)',
        borderBottom: '1px solid var(--panel-border)',
      }}
    >
      <span className="truncate">{label}</span>
      <span
        className="tabular-nums font-normal"
        style={{ color: 'var(--list-time)' }}
      >
        {count}
      </span>
    </div>
  );
}

export default function ArticleList() {
  const { t } = useTranslation();
  const online = useOnlineStatus();
  const {
    articles,
    loading,
    loadingMore,
    revalidating,
    selectedArticle,
    selectedFeed,
    randomView,
    randomDraw,
    filter,
    searchQuery,
    searchResults,
    searchVisible,
    searchScan,
    stopSearch,
    retrySearch,
    selectArticle,
    toggleStar,
    toggleRead,
    loadMore,
    continuation,
    search,
    clearSearch,
    markAllAsRead,
    markReadRelative,
    toggleReadLater,
    silentRefresh,
  } = useFeedStore();
  const viewMode = useUiStore((s) => s.viewMode);
  const panelLayout = useUiStore((s) => s.panelLayout);
  const sidebarVisible = useUiStore((s) => s.sidebarVisible);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const showSourceInFeed = useUiStore((s) => s.showSourceInFeed);
  const showListFavicons = useUiStore((s) => s.showListFavicons);
  const rowActions = useUiStore((s) => s.rowActions);
  const toggleShowListFavicons = useUiStore((s) => s.toggleShowListFavicons);
  const subscriptions = useFeedStore((s) => s.subscriptions);
  const unreadCounts = useFeedStore((s) => s.unreadCounts);
  const pushToast = useUiStore((s) => s.pushToast);
  const showNewArticlesPill = useUiStore((s) => s.showNewArticlesPill);
  const newInView = useFeedStore((s) => s.newInView);
  const listFailed = useFeedStore((s) => s.listFailed);
  const loadNewArticles = useFeedStore((s) => s.loadNewArticles);
  const dismissNewArticles = useFeedStore((s) => s.dismissNewArticles);
  // Une recherche est en cours : le bandeau de la vue qu'elle recouvre ne doit
  // pas rester visible au-dessus des résultats (Fix 1, revue finale) —
  // `search()` a déjà remis `newInView` à zéro, mais rien ne la remet tant
  // qu'on reste DANS la recherche.
  const newArticlesBannerCount = searchQuery ? 0 : newInView;
  const newArticlesBannerShown = showNewArticlesPill && newArticlesBannerCount > 0;
  const markReadOnScroll = useUiStore((s) => s.markReadOnScroll);
  const showSourceInAll = useUiStore((s) => s.showSourceInAll);
  const toggleShowSourceInFeed = useUiStore((s) => s.toggleShowSourceInFeed);
  const toggleShowSourceInAll = useUiStore((s) => s.toggleShowSourceInAll);
  const feedSettings = useUiStore((s) => s.feedSettings);
  const articleOrder = useUiStore((s) => s.articleOrder);
  const showDateSeparators = useUiStore((s) => s.showDateSeparators);
  const toggleDateSeparators = useUiStore((s) => s.toggleDateSeparators);
  const gridDateSeparators = useUiStore((s) => s.gridDateSeparators);
  const gridCardWidth = useUiStore((s) => s.gridCardWidth);
  const gridImageRatio = useUiStore((s) => s.gridImageRatio);
  const gridCardFill = useUiStore((s) => s.gridCardFill);
  const gridStyle = useMemo(
    () => gridCardStyle(gridCardWidth, gridImageRatio) as CSSProperties,
    [gridCardWidth, gridImageRatio],
  );
  const toggleGridDateSeparators = useUiStore((s) => s.toggleGridDateSeparators);
  const confirmMarkAllRead = useUiStore((s) => s.confirmMarkAllRead);
  const topbarVisible = useUiStore((s) => s.topbarVisible);
  const toggleTopbar = useUiStore((s) => s.toggleTopbar);
  const breakpoint = useBreakpoint();
  const isDesktop = breakpoint === 'desktop';
  const isMobile = breakpoint === 'mobile';
  // A feed can override the global layout (set from its sidebar context menu).
  const activeServerId = useAuthStore((s) => s.activeServerId);
  const layout = effectiveLayout(panelLayout, feedSettings, selectedFeed?.id, activeServerId);
  // « Au-dessus / en dessous » sont des positions ; le marquage de plage
  // raisonne en entrées plus récentes / plus anciennes. L'ordre de la vue
  // fait la traduction — sans elle, la liste inversée marquerait l'autre moitié.
  const order = effectiveOrder(articleOrder, feedSettings, selectedFeed?.id, activeServerId);
  const feedLayoutOverride = !!(selectedFeed && feedOverride(feedSettings, activeServerId, selectedFeed.id).layout);
  // Grid is a full-width layout: like 2-panel, the list body spans the whole
  // width and the reading pane replaces it on selection.
  const gridLayout = layout === 'grid';
  const is2Panel = layout === '2' || gridLayout || !isDesktop;
  // La liste cède-t-elle la place au volet ? (2 panneaux et grille, desktop)
  const panelLayoutReplacesList = layout === '2' || gridLayout;
  // Date grouping: the grid has its own (off-by-default) toggle; the list views
  // use the shared one.
  const dateSepActive = gridLayout ? gridDateSeparators : showDateSeparators;
  const toggleDateSep = gridLayout ? toggleGridDateSeparators : toggleDateSeparators;

  // Determine if source name should be shown. A category view aggregates many
  // feeds, so it behaves like the multi-source "all feeds" view, not a single
  // feed (where the source would be redundant).
  const isInFeed = !!selectedFeed && !isCategoryStreamId(selectedFeed.id);
  const showSource = isInFeed ? showSourceInFeed : showSourceInAll;

  // Les mots de la recherche en cours, pour que chaque ligne puisse montrer
  // POURQUOI elle est un résultat. Découpés ici, une fois par requête, plutôt
  // que dans chaque ligne : la liste monte à plusieurs centaines d'entrées.
  const searchTerms = useMemo(
    () => (searchQuery ? parseQuery(searchQuery) : undefined),
    [searchQuery],
  );

  const renderCard = (article: Article) => (
    <ArticleCard
      key={article.id}
      article={article}
      showSource={showSource}
      rowActions={rowActions}
      searchTerms={searchTerms}
      active={selectedArticle?.id === article.id}
      onSelect={() => openArticle(article)}
      onToggleStar={(e) => { e.stopPropagation(); toggleStar(article); }}
      onToggleRead={(e) => { e.stopPropagation(); toggleRead(article); }}
      onToggleReadLater={(e) => { e.stopPropagation(); toggleReadLater(article); }}
      onOpenSource={(e) => {
        e.stopPropagation();
        // `stopPropagation` puis sélection explicite : la carte arrête déjà la
        // propagation sur son conteneur d'actions, laisser le clic remonter ne
        // sélectionnerait donc rien ici et sélectionnerait ailleurs.
        openArticleAtSource(article, selectArticleAtSource);
      }}
      onOpenMenu={(point) => setArticleMenu({ articleId: article.id, view: currentView, ...point })}
      onOpenedInBackground={() => markReadOnBackgroundOpen(article, toggleRead)}
    />
  );

  // Icône par flux, pour la ligne d'article. La source y était un mot en
  // majuscules de 10 px : dans une vue Tous les flux, repérer un flux
  // demandait de lire au lieu de reconnaître. Une carte plutôt qu'un
  // `find()` par ligne — la liste va jusqu'à plusieurs centaines d'entrées.
  const iconByFeedId = useMemo(() => {
    const map = new Map<string, string | undefined>();
    for (const sub of subscriptions) map.set(sub.id, sub.iconUrl);
    return map;
  }, [subscriptions]);

  // Non-lus de la vue courante, affichés à côté du titre. En scroll infini,
  // rien ne disait s'il restait dix articles ou deux cents. Seulement pour un
  // flux et pour la vue « tous les flux » : les sélections transversales
  // (favoris, à lire plus tard, étiquettes) ne sont pas des flux qu'on vide,
  // et un compte y voudrait dire autre chose.
  // Sur l'accueil, seuls les flux du flux principal comptent (visibilité
  // FreshRSS) : le même total que le badge de la barre latérale.
  const headerUnread = useMemo(
    () => viewUnreadCount({ selectedFeed, filter }, unreadCounts, subscriptions),
    [filter, selectedFeed, subscriptions, unreadCounts],
  );

  const listRef = useRef<HTMLDivElement>(null);

  // ── Ouverture d'un article, avec morphing du titre ────────────────
  // Le titre de la ligne et celui du volet portent le même
  // `view-transition-name` le temps de la transition : le navigateur anime le
  // passage de l'un à l'autre.
  //
  // Seulement là où la liste est REMPLACÉE par le volet — 2 panneaux et grille
  // sur desktop. En 3 panneaux les deux titres coexistent et se disputeraient
  // le nom ; sur mobile, `MobileStack` garde la liste montée derrière ET anime
  // déjà la navigation. Sans support navigateur, il ne se passe rien.
  const openArticle = useCallback((article: Article) => {
    const enabled = canMorph({
      listIsReplaced: isDesktop && (panelLayoutReplacesList),
      reducedMotion: prefersReducedMotion(),
    });
    let titleEl: HTMLElement | null = null;
    if (enabled && listRef.current) {
      const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(article.id) : article.id;
      titleEl = listRef.current.querySelector<HTMLElement>(`[data-article-id="${escaped}"] .article-title`);
      if (titleEl) titleEl.style.viewTransitionName = 'frirss-article-title';
    }
    // `flushSync` : le navigateur doit voir le nouveau DOM dans le même tour,
    // sinon il photographie deux fois l'ancien état.
    withMorph(() => flushSync(() => selectArticle(article)), enabled);
    // La ligne est démontée avec la liste dans ce mode ; le nettoyage ne sert
    // que si le rendu la garde pour une raison quelconque.
    if (titleEl) titleEl.style.viewTransitionName = '';
  }, [isDesktop, panelLayoutReplacesList, selectArticle]);

  // La sélection déclenchée par « ouvrir à la source » (`openArticleAtSource`,
  // `src/lib/openArticleAtSource.ts`) passe par `openArticle` plutôt que par
  // `selectArticle` directement, pour la même raison qu'un clic sur la ligne :
  // sans le morph, le passage liste → volet en 2 panneaux et en grille se
  // ferait d'un coup, alors que toute autre sélection l'anime.
  const selectArticleAtSource = useCallback((article: Article | null) => {
    if (article) openArticle(article);
  }, [openArticle]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  // Recherches récentes du serveur actif. Rechargées à chaque ouverture du
  // champ plutôt que gardées en état : elles changent à la soumission.
  const [history, setHistory] = useState<string[]>([]);
  // La question posée, s'il y en a une : le vidage complet de la vue, ou un
  // marquage de plage venu du menu d'article. Les deux passent par la MÊME
  // boîte (demande du propriétaire, 2026-09-30) — le menu ne confirme plus
  // sur place, où un double-clic validait tout seul.
  const [ask, setAsk] = useState<
    | { kind: 'all' }
    | { kind: 'above' | 'below'; article: Article }
    | null
  >(null);
  const [optionsOpen, setOptionsOpen] = useState(false); // mobile view-options sheet
  // Menu contextuel d'un article (clic droit, touche Menu, appui long) — voir
  // `ArticleContextMenu`. On garde l'id et la vue, pas l'objet : le menu relit
  // l'article courant, et disparaît si l'article quitte la liste ou si la vue
  // change.
  const [articleMenu, setArticleMenu] = useState<{ articleId: string; view: string; x: number; y: number } | null>(null);
  const closeArticleMenu = useCallback(() => setArticleMenu(null), []);
  const currentView = `${selectedFeed?.id ?? ''}:${filter}`;
  const menuArticle = articleMenu && articleMenu.view === currentView
    ? articles.find((a) => a.id === articleMenu.articleId) ?? null
    : null;
  // Le menu ne doit pas juste rester masqué : s'il perd son article (marqué lu
  // et retiré de « Non lus », par exemple) ou sa vue, il se ferme pour de bon.
  useEffect(() => {
    if (articleMenu && !menuArticle) setArticleMenu(null);
  }, [articleMenu, menuArticle]);
  const copyArticleLink = useCallback(async (url: string) => {
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard ?? null : null;
    if (await copyLink(url, clipboard) === 'copied') pushToast(t('toast.linkCopied'));
    else pushToast(t('toast.copyFailed'), { tone: 'error' });
  }, [pushToast, t]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Pull-to-refresh (touch)
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pullRef = useRef<PullState>({});
  const refreshingRef = useRef(false);
  const PULL_TRIGGER = 56;

  // Scroll memory — key the saved position by the current view
  // Un tirage est une autre liste : sa position ne vaut pour aucune autre.
  const scrollKey = `${selectedFeed?.id || ''}:${filter}:${searchQuery || ''}${randomView ? `:random${randomDraw}` : ''}`;
  const scrollKeyRef = useRef(scrollKey);
  scrollKeyRef.current = scrollKey;
  // `scrollKey` ne remonte rien : le navigateur gardait la position, et le tirage
  // s'affichait par sa fin. En sortant, la position de la liste normale revient :
  // sa mémoire n'est relue qu'au montage.
  const wasRandomRef = useRef(randomView);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && randomView) el.scrollTop = 0;
    else if (el && wasRandomRef.current) el.scrollTop = listScrollMem.get(scrollKeyRef.current) ?? 0;
    wasRandomRef.current = randomView;
  }, [randomView, randomDraw]);
  // La vue dont la position a été restaurée. Tant qu'elle n'est pas la vue
  // affichée, le défilement n'écrit rien dans `listScrollMem` : la position
  // héritée de la vue précédente se serait rangée sous la nouvelle.
  const restoredKeyRef = useRef<string | null>(null);
  // Un bouton qui disparaît avec son clic laisserait le focus sur `<body>`.
  const focusList = useCallback(() => listRef.current?.focus({ preventScroll: true }), []);

  // `search()` remet `continuation` (celle du flux nu) à `null` et rien ne la
  // fait jamais redevenir non nulle pendant qu'on cherche : la lire brute
  // pendant une recherche couperait le scroll infini, le bouton « charger la
  // suite » et l'état vide dès la 51ᵉ correspondance. Pendant une recherche,
  // c'est la pagination locale (`searchVisible` face à `searchResults`) qui
  // porte la réponse — voir `searchAwareHasContinuation`.
  const hasContinuation = searchAwareHasContinuation({
    searching: !!searchQuery,
    continuation,
    searchVisible,
    searchResultsCount: searchResults.length,
  });

  // ── Tranche locale ───────────────────────────────────────────────
  // `src/lib/listWindow.ts`. Le store garde toute la liste ; seul ce qui est
  // monté se limite. La limite ne redescend pas tant qu'on reste dans la vue.
  const [rowWindow, setRowWindow] = useState({ key: scrollKey, limit: listLimitMem.get(scrollKey) ?? ROW_SLICE });
  const rowLimit = rowWindow.key === scrollKey ? rowWindow.limit : listLimitMem.get(scrollKey) ?? ROW_SLICE;
  const [listHeight, setListHeight] = useState(0);
  const raiseRowLimit = useCallback((limit: number) => {
    listLimitMem.set(scrollKeyRef.current, limit);
    setRowWindow({ key: scrollKeyRef.current, limit });
  }, []);
  const selectedIndex = useMemo(
    () => (selectedArticle ? articles.findIndex((a) => a.id === selectedArticle.id) : -1),
    [articles, selectedArticle],
  );
  const mounted = mountedRows({ limit: rowLimit, total: articles.length, selectedIndex, searching: !!searchQuery });
  const hiddenRows = articles.length - mounted;
  const shownArticles = useMemo(
    () => (mounted === articles.length ? articles : articles.slice(0, mounted)),
    [articles, mounted],
  );
  // L'article ouvert au clavier a monté les lignes jusqu'à lui : elles restent
  // quand il se referme, sinon la liste rétrécirait sous le lecteur.
  useLayoutEffect(() => {
    if (!searchQuery && mounted > rowLimit) raiseRowLimit(mounted);
  }, [mounted, rowLimit, searchQuery, raiseRowLimit]);

  // ── Apparition échelonnée ────────────────────────────────────────
  // Le décalage d'entrée se décidait sur la seule position : la ligne
  // remontée d'un cran par un retrait franchissait le seuil et rejouait
  // l'animation, en clignotant. `staggerIndexes` ne le donne qu'aux lignes
  // JAMAIS RENDUES dans la vue courante (`src/lib/rowStagger.ts`).
  //
  // Le suivi vit dans une ref, mise à jour dans un effet et jamais pendant le
  // rendu : un double rendu (StrictMode) verrait sinon toutes les lignes déjà
  // vues dès la première peinture, et plus rien ne s'animerait. La clé de vue
  // le remet à zéro — entrer dans un flux ou changer de filtre anime bien ses
  // lignes, y compris celles déjà croisées ailleurs.
  const articleIds = useMemo(() => shownArticles.map((a) => a.id), [shownArticles]);
  const seenRowsRef = useRef<{ key: string; memo: Map<string, number | null> }>({
    key: scrollKey,
    memo: new Map(),
  });
  const staggerById = useMemo(() => {
    const mem = seenRowsRef.current;
    return staggerIndexes(articleIds, mem.key === scrollKey ? mem.memo : new Map());
  }, [articleIds, scrollKey]);
  useEffect(() => {
    const mem = seenRowsRef.current;
    if (mem.key !== scrollKey) seenRowsRef.current = { key: scrollKey, memo: new Map() };
    rememberStagger(seenRowsRef.current.memo, articleIds, staggerById);
  }, [articleIds, scrollKey, staggerById]);

  // ── Mesure du débordement ────────────────────────────────────────
  // Le store décide s'il faut une page de rattrapage après un ✓, mais il n'a
  // pas de DOM : seule la liste sait si elle a encore quelque chose à faire
  // défiler. Elle publie donc ce fait dans un canal hors React
  // (`src/lib/listOverflow.ts`), que `toggleRead` LIT au moment du retrait.
  //
  // Publier n'est pas décider : rien ici n'appelle `loadMore`, ne pose d'état
  // React ni ne re-rend quoi que ce soit. C'est ce qui interdit la boucle du
  // `useAutoLoadMore` retiré le 2026-09-01 — la mesure ne se rappelle jamais
  // elle-même.
  const measureOverflow = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    publishListCanScroll(
      listOverflows({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight })
    );
  }, []);

  // Après CHAQUE rendu : c'est le rendu qui retire la ligne, donc le seul
  // moment où la liste vient peut-être de cesser de déborder.
  useEffect(() => {
    measureOverflow();
  });

  // Le conteneur peut changer de taille sans qu'aucune ligne ne bouge —
  // fenêtre agrandie, barre latérale repliée, clavier virtuel — et une liste
  // qui débordait cesse alors de déborder. `ResizeObserver` couvre les trois ;
  // le repli sur `resize` sert les environnements qui ne l'ont pas.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    // La hauteur nourrit aussi le remplissage de la tranche : une fenêtre
    // agrandie retire la barre de défilement, donc tout `scroll`. La mesure ne
    // décide toujours rien : c'est l'effet de remplissage qui décide.
    const onResize = () => { measureOverflow(); setListHeight(el.clientHeight); };
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(onResize);
      ro.observe(el);
    } else {
      window.addEventListener('resize', onResize);
    }
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', onResize);
      // Plus aucune liste à l'écran (onglet mobile, volet de lecture plein
      // écran) : la dernière mesure serait figée et un ✓ depuis le volet de
      // lecture demanderait une page par geste, sans que personne ne la voie.
      resetListCanScroll();
    };
  }, [measureOverflow]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    if (restoredKeyRef.current === scrollKeyRef.current) listScrollMem.set(scrollKeyRef.current, el.scrollTop);
    // Les images qui finissent de charger changent `scrollHeight` sans aucun
    // rendu React : le défilement est la meilleure occasion de se remettre à
    // jour, et les hauteurs sont déjà lues juste en dessous.
    publishListCanScroll(
      listOverflows({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight })
    );
    const metrics = { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
    // Ce qui est déjà en mémoire passe avant le réseau.
    if (hiddenRows > 0) {
      if (shouldLoadMore({ hasContinuation: true, loading, loadingMore: false, ...metrics })) raiseRowLimit(nextRowLimit(mounted));
      return;
    }
    if (shouldLoadMore({ hasContinuation, loading, loadingMore, ...metrics })) {
      // La page demandée par le défilement s'affiche à son arrivée : la tranche la
      // devance, sinon le lecteur, déjà en bas, n'émettrait plus aucun `scroll`.
      if (!searchQuery) raiseRowLimit(nextRowLimit(articles.length));
      loadMore();
    }
  }, [hasContinuation, loading, loadingMore, loadMore, hiddenRows, mounted, articles.length, searchQuery, raiseRowLimit]);

  // Une tranche qui ne remplit pas la fenêtre (grille sur un grand écran) n'émet
  // aucun `scroll`. Pas de hauteur, pas de décision : sur mobile, la liste reste
  // montée derrière le volet, et tout y serait monté pour rien. S'arrête seul :
  // la limite ne fait que monter.
  useEffect(() => {
    const el = listRef.current;
    if (!el || !hiddenRows || !el.clientHeight) return;
    if (shouldLoadMore({
      hasContinuation: true,
      loading,
      loadingMore: false,
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    })) raiseRowLimit(nextRowLimit(mounted));
  }, [hiddenRows, mounted, loading, listHeight, raiseRowLimit]);

  // Restore the saved scroll position once PER VIEW, after the list has
  // content (covers remounts; on mobile the list stays mounted). Le conteneur
  // survit au changement de vue : restaurée une seule fois par montage, la
  // position du flux précédent restait, et un flux s'ouvrait à la carte 240
  // d'un autre, ou en bas de sa première page (L-09, 1.9.0). Une vue jamais
  // vue s'ouvre en haut. Une vue sans rien à restaurer (vide, en chargement,
  // en échec) oublie aussitôt la précédente : gardée, elle faisait sauter la
  // restauration au retour sur elle, et le défilement suivant y écrivait 0.
  useLayoutEffect(() => {
    if (restoredKeyRef.current === scrollKey) return;
    const el = listRef.current;
    if (!el || loading || articles.length === 0) {
      restoredKeyRef.current = null;
      return;
    }
    el.scrollTop = listScrollMem.get(scrollKey) ?? 0;
    restoredKeyRef.current = scrollKey;
  }, [loading, articles.length, scrollKey]);

  // La relecture d'une vue vient de finir : si la liste est en bas, la suite se
  // charge. Seul un `scroll` le décidait, et `loadMore` le refuse en silence
  // pendant `revalidating` : une position restaurée ou ramenée en bas pendant la
  // relecture laissait la liste bloquée sur sa première page (L-09). Une fois
  // par relecture, sur le passage de `revalidating` à faux, et jamais sur
  // `loadingMore` ni sur une page reçue : ni un échec ni une page sans ligne ne
  // la relancent (voir `src/lib/listTopUp.ts` pour les emballements d'un effet
  // qui observe la liste). Une vue sans contenu affiché garde son bouton.
  //
  // Une relecture qui finit pendant qu'une page suivante est en vol (retour
  // sur l'onglet au milieu d'un chargement) : la vérification attend que
  // `loadingMore` retombe. Sinon `handleScroll` la refusait, puis `loadMore`
  // jetait sa page — la relecture avait remplacé la suite — sans rien
  // relancer : liste bloquée en bas de sa première page (N-1). Toujours une
  // seule vérification par relecture : la marque est consommée avant l'appel,
  // donc la page que celui-ci demande ne la réarme pas.
  const wasRevalidatingRef = useRef(revalidating);
  const settleCheckRef = useRef(false);
  useEffect(() => {
    const settled = wasRevalidatingRef.current && !revalidating;
    wasRevalidatingRef.current = revalidating;
    if (settled) settleCheckRef.current = true;
    if (!settleCheckRef.current || loadingMore) return;
    settleCheckRef.current = false;
    if (!revalidating && !loading && restoredKeyRef.current === scrollKeyRef.current) handleScroll();
  }, [revalidating, loading, loadingMore, handleScroll]);

  // ↓/↑ (et toute sélection venue d'ailleurs : palette, balayage, volet) font
  // défiler la liste jusqu'à la ligne choisie, au plus juste. L'article ouvert
  // est toujours monté (`mountedRows`), donc trouvé ici même au-delà de la
  // tranche. Le défilement est posé sur la liste seule : `scrollIntoView`
  // ferait défiler aussi la pile mobile ou la page (L-15).
  const selectedId = selectedArticle?.id ?? null;
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || !selectedId) return;
    const row = el.querySelector<HTMLElement>(rowSelector(selectedId));
    if (!row) return;
    const view = el.getBoundingClientRect();
    const box = row.getBoundingClientRect();
    const next = revealScrollTop({
      scrollTop: el.scrollTop,
      viewTop: view.top,
      viewBottom: view.top + el.clientHeight,
      rowTop: box.top,
      rowBottom: box.bottom,
      // Une bande de date colle en haut et recouvrirait la ligne.
      topInset: el.querySelector<HTMLElement>('.date-separator')?.offsetHeight ?? 0,
    });
    if (next !== null) el.scrollTop = next;
  }, [selectedId]);

  // Changer de disposition (liste ↔ grille, 2 ↔ 3 colonnes) change toutes les
  // hauteurs : garder le décalage en pixels faisait passer de l'article 47 au
  // 80. L'article du haut est relevé AVANT le rendu de la nouvelle disposition
  // (l'abonnement au store est appelé dans `set`, le DOM est encore l'ancien),
  // puis remis au même décalage une fois la nouvelle disposition montée.
  const anchorRef = useRef<ListAnchor | null>(null);
  useEffect(() => useUiStore.subscribe((now, before) => {
    const feedId = useFeedStore.getState().selectedFeed?.id;
    const serverId = useAuthStore.getState().activeServerId;
    const layoutOf = (u: typeof now) => effectiveLayout(u.panelLayout, u.feedSettings, feedId, serverId);
    if (layoutOf(now) === layoutOf(before)) return;
    const el = listRef.current;
    if (!el) return;
    const rowEls = el.querySelectorAll<HTMLElement>('[data-article-id]');
    const boxes = Array.from(rowEls, (row) => {
      const b = row.getBoundingClientRect();
      return { id: row.dataset.articleId ?? '', top: b.top, bottom: b.bottom };
    });
    anchorRef.current = listAnchor(boxes, el.getBoundingClientRect().top);
  }), []);
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    anchorRef.current = null;
    const el = listRef.current;
    if (!anchor || !el) return;
    const row = el.querySelector<HTMLElement>(rowSelector(anchor.id));
    if (!row) return;
    el.scrollTop = anchoredScrollTop({
      scrollTop: el.scrollTop,
      viewTop: el.getBoundingClientRect().top,
      rowTop: row.getBoundingClientRect().top,
      offset: anchor.offset,
    });
  }, [layout]);

  // Pull-to-refresh — custom gesture (mobile/tablet). Native touchmove with
  // passive:false so we can preventDefault while pulling at the top.
  useEffect(() => {
    if (isDesktop) return;
    const el = listRef.current;
    if (!el) return;
    const st = pullRef.current;

    function onStart(e: TouchEvent) {
      st.startY = e.touches[0].clientY;
      st.atTop = el!.scrollTop <= 0;
      st.pulling = false;
      st.dist = 0;
    }
    function onMove(e: TouchEvent) {
      if (refreshingRef.current) return;
      const y = e.touches[0].clientY;
      if (!st.atTop) {
        if (el!.scrollTop <= 0) { st.atTop = true; st.startY = y; } else return;
      }
      const dy = y - (st.startY ?? 0);
      if (dy <= 0) {
        if (st.pulling) { st.pulling = false; st.dist = 0; setPull(0); }
        return;
      }
      st.pulling = true;
      e.preventDefault();
      st.dist = Math.min(90, dy * 0.5);
      setPull(st.dist);
    }
    function onEnd() {
      if (!st.pulling) return;
      st.pulling = false;
      if ((st.dist ?? 0) >= PULL_TRIGGER) {
        refreshingRef.current = true;
        setRefreshing(true);
        setPull(PULL_TRIGGER);
        // Tirer est un geste : un tirage se refait, là où `silentRefresh` le laisse.
        const { randomView: drawing, syncCounts, loadArticles: redraw } = useFeedStore.getState();
        Promise.resolve(drawing ? syncCounts().then(redraw) : silentRefresh()).finally(() => {
          refreshingRef.current = false;
          setRefreshing(false);
          setPull(0);
        });
      } else {
        setPull(0);
      }
      st.dist = 0;
    }

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
    };
  }, [isDesktop, silentRefresh]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // ── Marquer lu au défilement (optionnel) ──────────────────────────
  // Éteint par défaut. Jamais pendant une recherche : on parcourt alors des
  // résultats, on ne dépile pas une file.
  //
  // `seenRef` retient les lignes qui ont été visibles au moins une fois. Sans
  // lui, le premier appel de l'observateur — qui rapporte l'état de TOUTES les
  // lignes observées — marquerait lu tout ce qui se trouve au-dessus d'une
  // position de défilement restaurée.
  //
  // L'écriture passe par `toggleRead`, l'un des cinq sites d'écriture
  // existants : ce n'est pas un sixième, et le repli en cas d'échec ainsi que
  // `persistCurrentView()` s'appliquent donc déjà.
  const observerRef = useRef<IntersectionObserver | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const root = listRef.current;
    const timers = timersRef.current;
    const seen = seenRef.current;
    const active = markReadOnScroll && !searchQuery;
    if (!active || !root || typeof IntersectionObserver === 'undefined') {
      observerRef.current?.disconnect();
      observerRef.current = null;
      timers.forEach(clearTimeout);
      timers.clear();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.articleId;
          if (!id) continue;

          if (entry.isIntersecting) {
            seen.add(id);
            // Revenue à l'écran : on annule, l'utilisateur est remonté.
            const pending = timers.get(id);
            if (pending) { clearTimeout(pending); timers.delete(id); }
            continue;
          }

          const pastTop = scrolledPastTop(entry.boundingClientRect, entry.rootBounds);
          const article = useFeedStore.getState().articles.find((a) => a.id === id);
          if (!article || !shouldMark(article, pastTop, seen)) continue;
          if (timers.has(id)) continue;

          timers.set(id, setTimeout(() => {
            timers.delete(id);
            // Relire l'article : il a pu être ouvert — donc marqué lu — entre
            // la programmation et l'échéance.
            const fresh = useFeedStore.getState().articles.find((a) => a.id === id);
            // Implicite : c'est le défilement qui décide, pas l'utilisateur.
            // Sans ce drapeau, la liste s'effondrerait sous lui pendant qu'il
            // fait défiler.
            if (fresh && !fresh.read) useFeedStore.getState().toggleRead(fresh, { implicit: true });
          }, MARK_READ_DELAY_MS));
        }
      },
      { root, threshold: 0 }
    );
    observerRef.current = observer;

    root.querySelectorAll('[data-article-id]').forEach((node) => observer.observe(node));

    return () => {
      observer.disconnect();
      observerRef.current = null;
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, [markReadOnScroll, searchQuery, articles.length, mounted]);

  // Changer de vue repart d'une page blanche : les lignes de la vue
  // précédente ne doivent pas compter comme « déjà vues ».
  useEffect(() => {
    seenRef.current.clear();
  }, [scrollKey]);

  // Focus search input when opened
  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
    if (searchOpen) setHistory(loadSearchHistory(activeServerId));
  }, [searchOpen, activeServerId]);

  // « Oublier cette recherche » démonte le bouton qui avait le focus : une
  // fois la liste des puces rendue, le focus va où `focusAfterForget` le dit.
  const recentSearchesRef = useRef<HTMLDivElement>(null);
  const forgetFocus = useRef<number | 'input' | null>(null);
  useEffect(() => {
    const target = forgetFocus.current;
    if (target === null) return;
    forgetFocus.current = null;
    if (target === 'input') searchInputRef.current?.focus();
    else recentSearchesRef.current?.querySelectorAll<HTMLElement>('[data-forget-search]')[target]?.focus();
  }, [history]);

  // Le store referme la recherche dès que la vue change (`closeSearch`) : la
  // boîte doit suivre, sinon elle reste remplie au-dessus d'une liste qui
  // n'est plus filtrée — vu sur l'instance de dev, la requête « debian »
  // flottait au-dessus de « Tous les flux » entier. Clé sur la vue, pas sur
  // `searchQuery` : celui-ci est vide aussi pendant qu'on tape, et effacer
  // alors reviendrait à manger la frappe.
  const viewSignature = `${selectedFeed?.id ?? ''}:${filter}`;
  const lastViewSignature = useRef(viewSignature);
  useEffect(() => {
    if (lastViewSignature.current === viewSignature) return;
    lastViewSignature.current = viewSignature;
    setSearchValue('');
    setSearchOpen(false);
  }, [viewSignature]);

  // Keyboard shortcut asks for the search: open it — the effect above then
  // focuses the input once it exists.
  useEffect(() => {
    const open = () => setSearchOpen(true);
    window.addEventListener('frirss:open-search', open);
    return () => window.removeEventListener('frirss:open-search', open);
  }, []);

  function runSearch(query: string) {
    const value = query.trim();
    if (!value) return;
    search(value);
    rememberSearch(activeServerId, value);
    setHistory(loadSearchHistory(activeServerId));
  }

  function handleClearSearch() {
    setSearchValue('');
    setSearchOpen(false);
    clearSearch();
  }

  /**
   * Le clic ouvre une BOÎTE quand la confirmation est demandée (réglage
   * `confirmMarkAllRead`), au lieu de poser un « Confirmer ? » à la place du
   * bouton — issue #17 : ce second état tombait sous le curseur, donc le
   * second clic d'un double-clic le validait. Une boîte a son bouton
   * ailleurs, et elle annonce ce qui va être marqué.
   *
   * Le compte vient du compteur de non-lus de la vue, pas des articles
   * chargés : le serveur vide TOUT le flux, pas seulement la page affichée.
   * Le retour en arrière, lui, vit dans le store (`markAllAsRead` relève les
   * non-lus avant d'appeler) et s'offre par un bandeau.
   */
  function handleMarkAllRead() {
    // Hors ligne, pas de question pour une action qui ne peut pas avoir lieu :
    // le store refuse et le dit (L-23 — la boîte s'ouvrait, et sa validation
    // ne faisait rien, sans un mot).
    if (!online) {
      void markAllAsRead();
      return;
    }
    if (markAllReadAction(confirmMarkAllRead, false) === 'ask') {
      // Le relevé des non-lus part MAINTENANT, pendant que la question est
      // lue : il coûte une requête par millier d'articles, et ce temps ne doit
      // pas s'ajouter après la validation. Annuler l'abandonne, il n'a rien
      // écrit.
      useFeedStore.getState().prepareMarkAllUndo();
      setAsk({ kind: 'all' });
      return;
    }
    markAllAsRead();
  }

  const feedName = selectedFeed ? selectedFeed.title : t('articleList.allFeeds');
  // The view a search is scoped to — shown in the search placeholder.
  const searchScope = selectedFeed
    ? selectedFeed.title
    : filter === 'readlater'
      ? t('sidebar.readLater')
      : filter === 'starred'
        ? t('sidebar.starred')
        : filter === 'unread'
          ? t('sidebar.unread')
          : t('articleList.allFeeds');
  // No "— Favoris/Non lus" suffix: the active filter is already shown by the
  // highlighted toolbar button. "À lire plus tard" keeps its name (no toolbar
  // toggle for it). Otherwise just the feed name / "Tous les flux".
  const title = !selectedFeed && filter === 'readlater'
    ? t('articleList.readLaterSuffix')
    : feedName;
  // Écrasé par la barre d'outils quand le panneau de lecture est ouvert, le
  // titre se réduit à « To… » : l'infobulle le rend lisible en entier.
  // Le nom (« Recherche : … »), pas le verbe du bouton (« Rechercher : … »).
  // Pendant une recherche, la pastille des non-lus de la vue se tait : à côté
  // de « 471 résultats », son 4 973 ne parlait pas de ce qu'on voit.
  const heading = searchQuery ? t('app.labelValue', { label: t('articleList.searchHeading'), value: searchQuery }) : title;

  // Dans un tirage, les dates se suivent au hasard : une seule suite, sans bande,
  // sinon « Aujourd'hui » et « Hier » alterneraient à chaque ligne.
  const groups = randomView ? [{ key: 'random', label: '', articles: shownArticles }] : groupByDate(shownArticles);
  const canMarkAll = canMarkAllRead(filter) && !randomView;
  const randomButton = canRandomView(filter) && !searchQuery ? {
    icon: <ShuffleIcon />,
    label: t(online || randomView ? 'articleList.random' : 'articleList.randomOffline'),
    // La phrase hors ligne n'a sa place que dans l'infobulle : affichée, elle
    // sortait les boutons voisins de la barre.
    text: t('articleList.random'),
    active: randomView,
    pressed: randomView,
    disabled: !online && !randomView,
    onClick: () => useFeedStore.getState().setRandomView(!randomView),
  } : null;
  // Tout ce qui change le contenu de la ligne : elle se mesure sur ce qu'elle porte,
  // et sans ceci, un bouton revenu après une recherche la ferait déborder.
  const actionRowRef = useRef<HTMLDivElement>(null);

  // Barre personnalisable (Préférences → Mise en page), desktop seulement :
  // `shown` rend toujours vrai ailleurs. Masquer RETIRE ; les séparateurs
  // suivent les groupes réellement affichés (`separatorsBefore`).
  const shown = useToolbarShown();
  const listBarShown = shown('listBar');
  // ☰ de secours (L-10) : voir son rendu, au-dessus du corps de la liste.
  const sidebarRescue = isDesktop && !listBarShown && !sidebarVisible;
  const showSearchBtn = shown('search');
  const showUnreadBtn = shown('unreadFilter');
  const showRandomBtn = !!randomButton && shown('random');
  const showStarredBtn = shown('starredFilter');
  const showMarkAllBtn = canMarkAll && shown('markAllRead');
  const optShown = {
    source: shown('optSource'), favicons: shown('optFavicons'),
    dateSep: shown('optDateSeparators'), serverBar: shown('optServerBar'),
  };
  const anyOption = optShown.source || optShown.favicons || optShown.dateSep || optShown.serverBar;
  const showDensity = shown('density');
  const showLayout = shown('layout');
  const anyFilter = showUnreadBtn || showRandomBtn || showStarredBtn;
  const anyAction = showSearchBtn || anyFilter || showMarkAllBtn;
  const [, sep3Filters, sep3MarkAll] = separatorsBefore([showSearchBtn, anyFilter, showMarkAllBtn]);
  const [, sep2MarkAll] = separatorsBefore([showSearchBtn || anyFilter, showMarkAllBtn]);

  const toggleUnreadFilter = () => useFeedStore.getState().setUnreadFilter(filter !== 'unread');
  const toggleStarredFilter = () => useFeedStore.getState().setFilter(filter === 'starred' ? 'all' : 'starred');
  const toggleSource = isInFeed ? toggleShowSourceInFeed : toggleShowSourceInAll;

  // Chaque bouton de la barre, masqué ou non, a sa commande dans la palette
  // (`toolbarCommands.ts`) : mêmes conditions que le bouton, même gestionnaire.
  const optionLabel = (key: string) => t('app.labelValue', { label: t('articleList.viewOptions'), value: t(key) });
  const densityModes: Array<[string, string]> = [['preview', 'viewMode.preview'], ['simple', 'viewMode.standard'], ['compact', 'viewMode.compact']];
  useToolbarCommands(() => {
    const offers: ToolbarOffer[] = [
      // Pas « Non lus » / « Favoris » : ce sont aussi les noms des vues, et un
      // filtre masqué ne montre son état nulle part ailleurs.
      { command: 'unreadFilter', item: 'unreadFilter', label: t(filter === 'unread' ? 'palette.filterUnreadOff' : 'palette.filterUnreadOn') },
      { command: 'starredFilter', item: 'starredFilter', label: t(filter === 'starred' ? 'palette.filterStarredOff' : 'palette.filterStarredOn') },
      { command: 'optSource', item: 'optSource', label: optionLabel('articleList.feedSource') },
      { command: 'optFavicons', item: 'optFavicons', label: optionLabel('articleList.listFavicons') },
      { command: 'optDateSeparators', item: 'optDateSeparators', label: optionLabel('articleList.dateSeparators') },
      { command: 'optServerBar', item: 'optServerBar', label: optionLabel('articleList.serverBar') },
    ];
    // Comme les filtres : le libellé dit l'effet. « Aléatoire » tout court, une
    // fois dans le tirage, en faisait sortir sans le dire.
    if (randomButton && !randomButton.disabled) offers.push({ command: 'random', item: 'random', label: t(randomView ? 'palette.randomOff' : 'palette.randomOn') });
    if (canMarkAll) offers.push({ command: 'markAllRead', item: 'markAllRead', label: t('articleList.markAllRead') });
    if (!gridLayout) {
      // Pas la densité déjà active : la proposer ne ferait rien.
      for (const [mode, key] of densityModes) {
        if (mode !== viewMode) offers.push({ command: `density:${mode}`, item: 'density', label: t('app.labelValue', { label: t('articleList.displayMode'), value: t(key) }) });
      }
    }
    return offers;
  }, (command) => {
    if (command === 'unreadFilter') toggleUnreadFilter();
    else if (command === 'starredFilter') toggleStarredFilter();
    else if (command === 'random') randomButton?.onClick();
    else if (command === 'markAllRead') handleMarkAllRead();
    else if (command === 'optSource') toggleSource();
    else if (command === 'optFavicons') toggleShowListFavicons();
    else if (command === 'optDateSeparators') toggleDateSep();
    else if (command === 'optServerBar') toggleTopbar();
    else if (command.startsWith('density:')) useUiStore.getState().setViewMode(command.slice('density:'.length));
  });

  // `randomView` : en 2 colonnes, la pastille du tirage (`RandomChip`) partage la ligne.
  // Le titre et le compte de non-lus aussi : un autre titre déplace le passage
  // à la ligne sans changer la taille de la barre, et les traits orphelins
  // restaient marqués selon l'ancien (relecture 1.9.0).
  useToolbarFold(actionRowRef, [t('articleList.search'), t('articleList.random'), !!randomButton, canMarkAll, is2Panel, layout, shown, randomView, heading, headerUnread, !!searchQuery]);
  // Une bande dit combien d'articles porte sa date, pas combien sont montés.
  const groupTotals = useMemo(
    () => new Map(groupByDate(articles).map((g) => [g.key, g.articles.length])),
    [articles],
  );

  // Une liste vide ne veut dire « il n'y a plus rien » que si le flux est
  // épuisé. Vidée alors que `continuation` promet une page suivante, elle
  // affichait « tout est lu » — en vert, en grand, comme une réussite —
  // au-dessus d'articles qui attendaient encore sur le serveur.
  //
  // ⚠️ La première correction rendait le squelette dans ce cas : un squelette
  // que RIEN ne pouvait terminer (voir `listBodyState`). L'état neutre
  // `empty-more` le remplace : il ne prétend rien et propose la page suivante.
  const bodyState = listBodyState({
    loading,
    articleCount: articles.length,
    hasContinuation,
    searching: !!searchQuery,
    scanning: searchScan.running,
    failed: listFailed,
  });
  // Le bouton « charger la suite » de l'état vide neutre reste inactif tant
  // qu'un clic ne peut pas agir sans risque — page déjà en vol, ou vue encore
  // en cours de revalidation depuis un hit du cache mémoire (voir
  // `canLoadMore` : cliquer dans cette fenêtre perdrait la course contre
  // `loadArticles` et jetterait le travail du clic).
  const loadMoreBusy = !canLoadMore({ hasContinuation, loadingMore, revalidating });
  const endOfListMarkAll = showEndOfListMarkAll({
    hasContinuation: hasContinuation || hiddenRows > 0,
    loading,
    loadingMore,
    searchQuery,
    filter,
    articles,
  });

  return (
    <div className="article-list h-full flex flex-col overflow-x-hidden" style={{ background: 'var(--panel-bg)' }}>
      {menuArticle && articleMenu && (
        <ArticleContextMenu
          article={menuArticle}
          isReadLater={!!menuArticle.labels?.includes(READ_LATER_LABEL)}
          canMarkRange={canMarkAll}
          x={articleMenu.x}
          y={articleMenu.y}
          sheet={isMobile}
          onClose={closeArticleMenu}
          onOpenSource={() => openArticleAtSource(menuArticle, selectArticleAtSource)}
          onToggleRead={() => { void toggleRead(menuArticle); }}
          onMarkRange={(direction) => {
            // Le menu se ferme derrière ce clic : l'article est capturé ici,
            // il ne sera plus atteignable par `menuArticle` ensuite.
            if (markAllReadAction(confirmMarkAllRead, false) === 'ask') {
              setAsk({ kind: direction, article: menuArticle });
              return;
            }
            void markReadRelative(menuArticle, entryDirection(direction, order));
          }}
          onToggleStar={() => { void toggleStar(menuArticle); }}
          onToggleReadLater={() => { void toggleReadLater(menuArticle); }}
          onCopyLink={() => { void copyArticleLink(menuArticle.url); }}
        />
      )}
      {/* Header — barre entière masquée (desktop), il ne reste que la zone de
          recherche, et seulement quand une recherche est ouverte ou active. */}
      {(listBarShown || searchOpen || !!searchQuery) && (
      <div
        className="article-list-header flex-shrink-0"
        style={{
          background: 'var(--panel-header-bg)',
          borderBottom: '1px solid var(--panel-border)',
        }}
      >
        {isMobile ? (
          /* ── Mobile: single row — title + icons spread across free space ── */
          <div className="relative px-2 py-1.5 flex items-center gap-1">
            {!sidebarVisible && (
              <button
                onClick={toggleSidebar}
                className="p-1.5 -ml-1 rounded transition-colors hover-tint flex-shrink-0"
                style={{ color: 'var(--list-summary)' }}
                title={t('sidebar.showSidebar')}
                aria-label={t('sidebar.showSidebar')}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
                </svg>
              </button>
            )}
            <h2 className="text-[15px] font-bold truncate min-w-0" title={heading} style={{ color: 'var(--list-title)' }}>
              {heading}
            </h2>
            {!searchQuery && <HeaderUnread count={headerUnread} />}
            <div className="flex-1 flex items-center">
              <ToolbarBtn flex1 iconOnly icon={<SearchIcon />} label={t('articleList.search')} onClick={() => setSearchOpen(true)} />
              <ToolbarBtn flex1 iconOnly icon={<MarkUnreadIcon />} label={t('articleList.unread')} active={filter === 'unread'} pressed={filter === 'unread'}
                onClick={() => useFeedStore.getState().setUnreadFilter(filter !== 'unread')} />
              {randomButton && <ToolbarBtn flex1 iconOnly {...randomButton} />}
              <ToolbarBtn flex1 iconOnly icon={<StarIcon filled={filter === 'starred'} />} label={t('articleList.starred')} active={filter === 'starred'} pressed={filter === 'starred'}
                onClick={() => useFeedStore.getState().setFilter(filter === 'starred' ? 'all' : 'starred')} />
              {canMarkAll && (
                <ToolbarBtn flex1 iconOnly icon={<MarkAllReadIcon />} label={t('articleList.markAllRead')} onClick={handleMarkAllRead} />
              )}
              <ToolbarBtn flex1 iconOnly icon={<OptionsIcon />} label={t('articleList.viewOptions')} active={optionsOpen}
                onClick={() => setOptionsOpen((o) => !o)} />
            </div>

            {/* Feuille du bas plutôt que menu ancré : ancré, il s'ouvrait en
                haut de l'écran, hors de portée du pouce. */}
            <BottomSheet
              open={optionsOpen}
              onClose={() => setOptionsOpen(false)}
              title={t('articleList.viewOptions')}
            >
              <SheetRow icon={<SourceGlyph />} label={t('articleList.feedSource')} active={showSource}
                onClick={isInFeed ? toggleShowSourceInFeed : toggleShowSourceInAll} />
              <SheetRow icon={<FaviconGlyph />} label={t('articleList.listFavicons')} active={showListFavicons}
                onClick={toggleShowListFavicons} />
              <SheetRow icon={<DateGlyph />} label={t('articleList.dateSeparators')} active={dateSepActive}
                onClick={toggleDateSep} />
              <SheetRow icon={<TopbarGlyph on={topbarVisible} />} label={t('articleList.serverBar')} active={topbarVisible}
                onClick={toggleTopbar} />

              {!gridLayout && (
                <>
                  <SheetDivider />
                  <div className="px-4 py-3 flex items-center justify-between gap-2">
                    <span className="text-[15px] font-medium" style={{ color: 'var(--list-title)' }}>{t('articleList.displayMode')}</span>
                    <ViewModeSwitcher />
                  </div>
                </>
              )}
            </BottomSheet>
          </div>
        ) : !listBarShown ? null : is2Panel ? (
          /* ── 2-panel: single unified toolbar ── */
          <div ref={actionRowRef} className="list-actions px-3 py-2 flex items-center gap-2 min-h-[48px]">
            {!sidebarVisible && (
              <button
                onClick={toggleSidebar}
                className="p-1.5 rounded transition-colors hover-tint flex-shrink-0"
                style={{ color: 'var(--list-summary)' }}
                title={t('sidebar.showSidebar')}
                aria-label={t('sidebar.showSidebar')}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
                </svg>
              </button>
            )}

            {/* 6rem : le titre ne se réduit pas à rien avant que la ligne déborde. */}
            <div className="min-w-[6rem] flex items-center gap-2">
              <h2 className="text-[16px] font-bold truncate min-w-0" title={heading} style={{ color: 'var(--list-title)' }}>
                {heading}
              </h2>
              {!searchQuery && <HeaderUnread count={headerUnread} />}
              {randomView && !showRandomBtn && <RandomChip onExit={focusList} />}
            </div>

            {anyAction && (
              <>
                <div data-toolbar-sep="" className="w-px h-4 mx-1 flex-shrink-0" style={{ background: 'var(--panel-border)' }} />

                {/* Inline toolbar actions */}
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  {showSearchBtn && <ToolbarBtn cede={1} icon={<SearchIcon />} label={t('articleList.search')} shortcut="F" onClick={() => setSearchOpen(true)} />}
                  {showUnreadBtn && <ToolbarBtn icon={<MarkUnreadIcon />} label={t('articleList.unread')} active={filter === 'unread'} pressed={filter === 'unread'}
                    onClick={toggleUnreadFilter} />}
                  {showRandomBtn && randomButton && <ToolbarBtn cede={2} {...randomButton} />}
                  {showStarredBtn && <ToolbarBtn icon={<StarIcon filled={filter === 'starred'} />} label={t('articleList.starred')} active={filter === 'starred'} pressed={filter === 'starred'}
                    onClick={toggleStarredFilter} />}
                  {sep2MarkAll && <ToolbarSep />}
                  {showMarkAllBtn && <ToolbarBtn icon={<MarkAllReadIcon />} label={t('articleList.markAllRead')} onClick={handleMarkAllRead} />}
                </div>
              </>
            )}

            <div className="flex-1" />

            <div className="flex items-center gap-1.5 flex-shrink-0">
              {/* Les quatre bascules d'affichage forment un groupe, comme la
                  densité et la disposition en ont déjà un. Vide, la piste
                  n'est pas rendue : son fond resterait seul à l'écran. */}
              {anyOption && (
                <div className="option-track">
                  {optShown.source && (
                    <SourceToggle
                      active={showSource}
                      onClick={toggleSource}
                      tooltip={isInFeed ? t('articleList.sourceToggleFeed') : t('articleList.sourceToggleAll')}
                    />
                  )}
                  {optShown.favicons && <FaviconToggle />}
                  {optShown.dateSep && <DateSepToggle active={dateSepActive} onClick={toggleDateSep} />}
                  {optShown.serverBar && <TopbarToggle />}
                </div>
              )}
              {!gridLayout && showDensity && <ViewModeSwitcher />}
              {isDesktop && showLayout && <LayoutToggle overridden={feedLayoutOverride} />}
            </div>
          </div>
        ) : (
          /* ── 3-panel: compact two-row layout (title row + actions row) ── */
          <>
            {/* Le titre garde 8rem : dans une colonne de liste étroite (~340 px
                à 1 280 px de large), les dix bascules prenaient toute la place
                et « BleepingComputer » devenait « B ». Les bascules passent
                alors sur une seconde ligne, alignées à droite. */}
            <div className="px-3 py-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
              {!sidebarVisible && (
                <button
                  onClick={toggleSidebar}
                  className="p-1.5 rounded transition-colors hover-tint flex-shrink-0"
                  style={{ color: 'var(--list-summary)' }}
                  title={t('sidebar.showSidebar')}
                  aria-label={t('sidebar.showSidebar')}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
                  </svg>
                </button>
              )}

              <div className="min-w-[8rem] flex-1 flex items-center gap-2">
                <h2 className="text-[16px] font-bold truncate" title={heading} style={{ color: 'var(--list-title)' }}>
                  {heading}
                </h2>
                {!searchQuery && <HeaderUnread count={headerUnread} />}
                {randomView && !showRandomBtn && <RandomChip onExit={focusList} />}
              </div>

              {(anyOption || showDensity || showLayout) && (
                <div className="flex items-center gap-1.5 flex-shrink-0 ml-auto">
                  {anyOption && (
                    <div className="option-track">
                      {optShown.source && (
                        <SourceToggle
                          active={showSource}
                          onClick={toggleSource}
                          tooltip={isInFeed ? t('articleList.sourceToggleFeed') : t('articleList.sourceToggleAll')}
                        />
                      )}
                      {optShown.favicons && <FaviconToggle />}
                      {optShown.dateSep && <DateSepToggle active={showDateSeparators} onClick={toggleDateSeparators} />}
                      {optShown.serverBar && <TopbarToggle />}
                    </div>
                  )}
                  {showDensity && <ViewModeSwitcher />}
                  {showLayout && <LayoutToggle overridden={feedLayoutOverride} />}
                </div>
              )}
            </div>

            {/* À la ligne si la place manque : à 340 px, largeur par défaut de la
                colonne, « Tout lu » sortait de la barre dans six langues, et rien
                ne le remplace. */}
            {/* Sans aucun bouton, la rangée n'est pas rendue : son filet du
                haut resterait seul, une bande vide sous le titre. */}
            {anyAction && (
            <div ref={actionRowRef} className="list-actions pl-2 pr-0.5 py-1 flex items-center gap-0.5" style={{ borderTop: '1px solid var(--panel-border)' }}>
              {/* Rechercher cède son mot d'abord, Aléatoire ensuite, et seulement si
                  la ligne déborde (`useToolbarFold`) : à 340 px, largeur par défaut,
                  ils en faisaient sortir « Tout lu ». */}
              {showSearchBtn && <ToolbarBtn cede={1} icon={<SearchIcon />} label={t('articleList.search')} shortcut="F" onClick={() => setSearchOpen(true)} />}
              {sep3Filters && <ToolbarSep />}
              {showUnreadBtn && <ToolbarBtn icon={<MarkUnreadIcon />} label={t('articleList.unread')} active={filter === 'unread'} pressed={filter === 'unread'}
                onClick={toggleUnreadFilter} />}
              {showRandomBtn && randomButton && <ToolbarBtn cede={2} {...randomButton} />}
              {showStarredBtn && <ToolbarBtn icon={<StarIcon filled={filter === 'starred'} />} label={t('articleList.starred')} active={filter === 'starred'} pressed={filter === 'starred'}
                onClick={toggleStarredFilter} />}
              {sep3MarkAll && <ToolbarSep />}
              {showMarkAllBtn && <ToolbarBtn icon={<MarkAllReadIcon />} label={t('articleList.markAllRead')} onClick={handleMarkAllRead} />}
            </div>
            )}
          </>
        )}

        {/* Search bar (expandable) */}
        {searchOpen && (
          <SearchBar
            ref={searchInputRef}
            value={searchValue}
            scope={searchScope}
            mobile={isMobile}
            topRule={listBarShown}
            onChange={setSearchValue}
            onSubmit={() => runSearch(searchValue)}
            onClose={handleClearSearch}
          />
        )}

        {/* Recherches récentes — seulement quand le champ est vide, sinon elles
            recouvriraient ce que l'utilisateur est en train de taper. */}
        {searchOpen && !searchValue.trim() && history.length > 0 && (
          <div
            ref={recentSearchesRef}
            className="px-3 pb-2 pt-2 flex flex-wrap items-center gap-1.5"
            style={{ borderTop: '1px solid var(--panel-border)' }}
          >
            <span
              className="text-[10px] font-semibold uppercase tracking-wider mr-0.5"
              style={{ color: 'var(--list-time)' }}
            >
              {t('articleList.recentSearches')}
            </span>
            {history.map((q) => (
              <span
                key={q}
                className="inline-flex items-center rounded-full text-[11px]"
                style={{ background: 'var(--list-active)', color: 'var(--list-title)' }}
              >
                <button
                  type="button"
                  onClick={() => { setSearchValue(q); runSearch(q); }}
                  className="pl-2.5 pr-1 py-1 rounded-l-full"
                >
                  {q}
                </button>
                <button
                  type="button"
                  data-forget-search
                  onClick={() => {
                    const index = history.indexOf(q);
                    forgetSearch(activeServerId, q);
                    const remaining = loadSearchHistory(activeServerId);
                    forgetFocus.current = focusAfterForget(index, remaining.length);
                    setHistory(remaining);
                  }}
                  className="pr-2 pl-0.5 py-1 rounded-r-full opacity-50 hover:opacity-100 transition-opacity"
                  aria-label={t('app.labelValue', { label: t('articleList.forgetSearch'), value: q })}
                  title={t('articleList.forgetSearch')}
                >
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Search indicator */}
        {searchQuery && !searchOpen && (
          <div
            className="px-3 py-1 flex items-center gap-2"
            style={{ ...(listBarShown ? { borderTop: '1px solid var(--panel-border)' } : {}), background: 'var(--accent-glow)' }}
          >
            <svg className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <span className="text-[11px] flex-1 truncate" style={{ color: 'var(--accent)' }}>
              {searchQuery}
            </span>
            <button
              onClick={handleClearSearch}
              aria-label={t('articleList.clearSearch')}
              title={t('articleList.clearSearch')}
              className="p-0.5 rounded transition-colors hover-tint"
              style={{ color: 'var(--accent)' }}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>
      )}

      {/* La question, quand le réglage la demande. Le titre porte le COMPTE et
          le périmètre : c'est ce qui distingue une action d'un filtre au
          moment précis où la confusion se produit (issue #17). */}
      <ConfirmDialog
        open={!!ask}
        title={
          ask?.kind === 'above' ? t('dialog.markAboveTitle')
            : ask?.kind === 'below' ? t('dialog.markBelowTitle')
              : headerUnread ? t('dialog.markAllTitle', { count: headerUnread })
                : t('dialog.markAllTitleAll')
        }
        message={title}
        // L'avertissement ne vaut que pour le vidage complet : une plage est
        // annulable par `markReadRelative`, qui connaît ses identifiants.
        warning={ask?.kind === 'all' && (headerUnread ?? 0) >= UNDO_CAP
          ? t('dialog.markAllNoUndo', { count: UNDO_CAP })
          : undefined}
        confirmLabel={t('dialog.markAllConfirm')}
        // La boîte reste tant que l'action tourne — elle montre alors qu'elle
        // travaille — et se ferme quand c'est fait.
        onConfirm={async () => {
          if (ask?.kind === 'above' || ask?.kind === 'below') {
            await markReadRelative(ask.article, entryDirection(ask.kind, order));
          } else {
            await markAllAsRead();
          }
          setAsk(null);
        }}
        onCancel={() => {
          if (ask?.kind === 'all') useFeedStore.getState().cancelMarkAllUndo();
          setAsk(null);
        }}
      />

      <SearchScanBar
        scan={searchScan}
        results={searchResults.length}
        includesRead={filter === 'unread'}
        onStop={stopSearch}
        onRetry={retrySearch}
      />

      {/* ☰ de secours (L-10, 1.9.0). Sur desktop, masquer la barre de la liste
          emporte son ☰ ; si la barre latérale est fermée elle aussi, plus rien
          ne la rouvre sans clavier (`b`, palette) — un iPad en paysage est un
          desktop. Seulement dans ce cas. Ancre de hauteur nulle : la liste
          commence toujours tout en haut, le bouton se pose dans le rail que
          le corps de la liste lui réserve à gauche (`.list-body--rail`, A-3 :
          posé sur la première ligne, il en recouvrait la pastille « non lu »),
          sous la zone de recherche si elle est ouverte. */}
      {sidebarRescue && (
        <div className="list-sidebar-reveal-anchor">
          <button
            type="button"
            // Le bouton disparaît avec le clic : le focus passe dans la barre
            // latérale qu'il ouvre, sinon il retombe sur `<body>`.
            onClick={() => { flushSync(toggleSidebar); focusSidebar(); }}
            className="list-sidebar-reveal list-sidebar-reveal--rail"
            title={t('sidebar.showSidebar')}
            aria-label={t('sidebar.showSidebar')}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
            </svg>
          </button>
        </div>
      )}

      {/* List */}
      <div
        ref={listRef}
        data-article-scroll
        tabIndex={-1}
        className={`flex-1 overflow-y-auto overflow-x-hidden nice-scroll relative outline-none${sidebarRescue ? ' list-body--rail' : ''}`}
        // Les séparateurs de date descendent sous le bandeau tant qu'il
        // s'affiche, au lieu d'être recouverts (`newArticlesOffsetStyle`).
        style={newArticlesOffsetStyle(newArticlesBannerShown)}
      >
        <NewArticlesBanner
          enabled={showNewArticlesPill}
          count={newArticlesBannerCount}
          onClick={() => {
            void loadNewArticles();
            // Le bouton disparaît avec le clic : sans ce focus, le clavier
            // retombe sur `<body>` (M1, revue finale). `preventScroll` — le
            // `scrollTo` juste après fait déjà remonter la liste.
            listRef.current?.focus({ preventScroll: true });
            listRef.current?.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
          }}
          onDismiss={dismissNewArticles}
        />
        {/* Pull-to-refresh spinner */}
        {(pull > 0 || refreshing) && (
          <div className="absolute left-0 right-0 top-0 z-20 flex justify-center pointer-events-none">
            <div
              className="mt-1.5 w-7 h-7 rounded-full flex items-center justify-center"
              style={{
                transform: `translateY(${Math.max(0, pull - 30)}px)`,
                opacity: refreshing ? 1 : Math.min(1, pull / PULL_TRIGGER),
                transition: (pull > 0 && !refreshing) ? 'none' : 'all 0.25s ease',
              }}
            >
              <svg
                className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`}
                style={{ color: 'var(--accent)', transform: refreshing ? undefined : `rotate(${pull * 4}deg)` }}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
          </div>
        )}
        <div style={{ transform: pull ? `translateY(${pull}px)` : undefined, transition: (pull > 0 && !refreshing) ? 'none' : 'transform 0.25s ease' }}>
        {bodyState === 'skeleton' ? (
          <div className="py-2">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="flex gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--panel-border)' }}>
                <div className="skeleton w-20 h-16 rounded flex-shrink-0" />
                <div className="flex-1 space-y-2 py-1">
                  <div className="skeleton h-3 w-24" />
                  <div className="skeleton h-4 w-full" />
                  <div className="skeleton h-3 w-3/4" />
                </div>
              </div>
            ))}
          </div>
        ) : bodyState === 'empty' || bodyState === 'empty-more' || bodyState === 'failed' ? (
          <EmptyState
            filter={filter}
            searchQuery={searchQuery}
            failed={bodyState === 'failed'}
            onRetry={() => {
              // « Nouveau tirage » et « Réessayer » disparaissent sous le
              // squelette : le focus passe à la liste, comme au pied du tirage.
              listRef.current?.focus({ preventScroll: true });
              void useFeedStore.getState().loadArticles();
            }}
            awaitingPage={bodyState === 'empty-more'}
            loadMoreBusy={loadMoreBusy}
            onLoadMore={loadMore}
            random={randomView}
          />
        ) : gridLayout && !gridDateSeparators ? (
          /* Grid, default: one continuous gallery, no date bands. */
          <div className={gridClassName(gridCardFill)} style={gridStyle}>
            {shownArticles.map(renderCard)}
          </div>
        ) : (
          /* La clé vient du groupe, jamais de sa position : `${label}-${index}`
             changeait la clé de toutes les bandes suivantes dès qu'une bande se
             vidait, et React remontait leurs sous-arbres entiers — les lignes
             remontées rejouant leur animation d'entrée (voir `DateGroup.key`). */
          groups.map((group) => (
            <div key={group.key}>
              {dateSepActive && !randomView && (
                <DateSeparator label={group.label} count={groupTotals.get(group.key) ?? group.articles.length} />
              )}
              {gridLayout ? (
                <div className={gridClassName(gridCardFill)} style={gridStyle}>
                  {group.articles.map(renderCard)}
                </div>
              ) : (
                group.articles.map((article) => {
                  const row = (
                    <ArticleRow
                      article={article}
                      viewMode={viewMode}
                      showSource={showSource}
                      rowActions={rowActions}
                      favicon={showListFavicons ? iconByFeedId.get(article.sourceId) ?? null : undefined}
                      staggerIndex={staggerById.get(article.id)}
                      active={selectedArticle?.id === article.id}
                      searchTerms={searchTerms}
                      onSelect={() => openArticle(article)}
                      onToggleStar={(e) => {
                        e.stopPropagation();
                        toggleStar(article);
                      }}
                      onToggleRead={(e) => {
                        e.stopPropagation();
                        toggleRead(article);
                      }}
                      onToggleReadLater={(e) => {
                        e.stopPropagation();
                        toggleReadLater(article);
                      }}
                      onOpenSource={(e) => {
                        e.stopPropagation();
                        // Sélection explicite, pas un clic qu'on laisse
                        // remonter jusqu'à la ligne : voir `renderCard`.
                        openArticleAtSource(article, selectArticleAtSource);
                      }}
                      onOpenMenu={(point) => setArticleMenu({ articleId: article.id, view: currentView, ...point })}
                      // Titre ouvert en arrière-plan : marqué lu, PAS sélectionné
                      // — le volet garde l'article en cours (`titleLink.ts`).
                      onOpenedInBackground={() => markReadOnBackgroundOpen(article, toggleRead)}
                    />
                  );

                  if (!isDesktop) {
                    const isReadLater = article.labels?.includes(READ_LATER_LABEL);
                    return (
                      <MobileArticleRow
                        key={article.id}
                        onSwipeLeft={() => toggleRead(article)}
                        onSwipeRight={() => toggleReadLater(article)}
                        swipeLeftLabel={article.read ? t('swipe.unread') : t('swipe.read')}
                        // Libellé lisible sur sa couleur : blanc sur #10b981 faisait ~2,5:1.
                        swipeLeftColor={article.read ? '#2563eb' : 'var(--accent)'}
                        swipeLeftInk={article.read ? '#ffffff' : 'var(--on-accent)'}
                        swipeRightLabel={isReadLater ? t('swipe.removeReadLater') : t('swipe.readLater')}
                        swipeRightColor="var(--readlater-color)"
                        swipeRightInk="var(--on-readlater)"
                      >
                        {row}
                      </MobileArticleRow>
                    );
                  }

                  return <div key={article.id}>{row}</div>;
                })
              )}
            </div>
          ))
        )}
        {loadingMore && (
          <div className="p-3 text-center text-xs" style={{ color: 'var(--list-summary)' }}>
            {t('articleList.loading')}
          </div>
        )}
        {bodyState === 'rows' && randomView && (
          <div
            className="px-6 py-8 text-center"
            style={{ borderTop: '1px solid var(--panel-border)' }}
          >
            <button
              onClick={() => {
                // Le squelette remplace la liste et ce bouton avec elle : sans
                // ce focus, le clavier retombe sur `<body>`. Le tirage repart
                // du haut de lui-même (`randomDraw`).
                listRef.current?.focus({ preventScroll: true });
                void useFeedStore.getState().loadArticles();
              }}
              className="px-3.5 py-2 rounded-full text-xs font-semibold transition-colors"
              style={{
                color: 'var(--accent)',
                background: 'var(--accent-glow)',
                border: '1.5px solid color-mix(in srgb, var(--accent) 30%, transparent)',
              }}
            >
              {t('articleList.randomAgain')}
            </button>
          </div>
        )}
        {bodyState === 'rows' && endOfListMarkAll && !randomView && (
          /* « Marquer lu au défilement » ne marque qu'à la sortie par le haut :
             les derniers articles ne sortent jamais. Ce pied leur donne une
             issue, la même action que la barre d'outils (boîte de confirmation
             et Annuler compris). Voir `showEndOfListMarkAll`. */
          <div
            className="px-6 py-8 text-center flex flex-col items-center gap-3"
            style={{ borderTop: '1px solid var(--panel-border)' }}
          >
            <p className="text-xs" style={{ color: 'var(--list-summary)' }}>
              {t('articleList.endOfList')}
            </p>
            <button
              onClick={handleMarkAllRead}
              className="px-3.5 py-2 rounded-full text-xs font-semibold transition-colors"
              style={{
                color: 'var(--accent)',
                background: 'var(--accent-glow)',
                border: '1.5px solid color-mix(in srgb, var(--accent) 30%, transparent)',
              }}
            >
              {t('articleList.endOfListMarkRead')}
            </button>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

/* ── Toolbar components ─────────────────────────────────────────── */

/**
 * Compte de non-lus de la vue, à côté du titre. `null` = vue sans compte qui
 * ait un sens ; `0` = vue à jour, on n'affiche rien plutôt qu'un zéro.
 */
function HeaderUnread({ count }: { count: number | null }) {
  const { t } = useTranslation();
  if (!count) return null;
  return (
    <span
      className="unread-badge flex-shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold tabular-nums"
      style={{ color: 'var(--accent)', background: 'var(--badge-bg)' }}
      title={t('articleList.unread')}
    >
      {count}
    </span>
  );
}

/**
 * Le tirage aléatoire en cours, quand son bouton est masqué (Préférences →
 * Mise en page) : rien d'autre ne disait pourquoi la liste n'était plus dans
 * l'ordre. Le toucher fait sortir du tirage — le seul chemin restant hors de
 * la palette, qui n'existe qu'au clavier. Le bouton visible, il se tait : le
 * bouton enfoncé le dit déjà. Le téléphone et la tablette montrent toujours
 * le bouton.
 */
function RandomChip({ onExit }: { onExit: () => void }) {
  const { t } = useTranslation();
  // Le nom accessible commence par le mot affiché (WCAG 2.5.3) : un
  // `aria-label` « Quitter le tirage » l'aurait remplacé, et « Zufällig »
  // n'est pas dans « Zufallsauswahl verlassen ».
  return (
    <button
      type="button"
      className="random-chip"
      // La pastille disparaît avec le clic : le focus passe à la liste, comme
      // au pied du tirage, sinon il retombe sur `<body>`.
      onClick={() => { useFeedStore.getState().setRandomView(false); onExit(); }}
      title={t('palette.randomOff')}
    >
      <ShuffleIcon />
      <span>{t('articleList.random')}</span>
      <span className="sr-only">{t('palette.randomOff')}</span>
      <svg className="random-chip__close" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}

/** `data-toolbar-sep` : repéré par `useToolbarFold`, masqué s'il reste seul au bout d'une ligne repliée. */
function ToolbarSep() {
  return <div data-toolbar-sep="" className="w-px h-4 mx-0.5" style={{ background: 'var(--panel-border)' }} />;
}

interface ToolbarBtnProps {
  icon: ReactNode;
  label: string;
  /** Le mot affiché, s'il diffère du nom complet. */
  text?: string;
  shortcut?: string;
  onClick?: () => void;
  active?: boolean;
  /** Une bascule : en icône seule, son état ne passerait que par la couleur. */
  pressed?: boolean;
  disabled?: boolean;
  iconOnly?: boolean;
  /** Son rang pour céder son mot quand `.list-actions` manque de place. */
  cede?: 1 | 2;
  flex1?: boolean;
}

function ToolbarBtn({ icon, label, text, shortcut, onClick, active, pressed, disabled, iconOnly, cede, flex1 }: ToolbarBtnProps) {
  return (
    <button
      onClick={onClick}
      aria-pressed={pressed}
      disabled={disabled}
      className={`flex items-center justify-center gap-1 ${flex1 ? 'flex-1 py-2 [&_svg]:w-[19px] [&_svg]:h-[19px]' : iconOnly ? 'p-1.5' : 'px-2 py-1'} rounded-md text-[11px] transition-colors whitespace-nowrap disabled:opacity-40 ${
        active
          ? ''
          : 'hover-tint'
      }`}
      style={{
        color: active ? 'var(--on-accent)' : 'var(--list-summary)',
        background: active ? 'var(--accent)' : undefined,
      }}
      title={shortcut ? `${label} (${shortcut})` : label}
      // The label is hidden by `iconOnly`, and by CSS on mobile — without this
      // the button has no accessible name at all in those cases.
      aria-label={label}
    >
      {icon}
      {!iconOnly && <span data-cede={cede}>{text ?? label}</span>}
    </button>
  );
}

function SearchIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  );
}

function ShuffleIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h3.5c1.6 0 3 .8 3.9 2.1l3.2 5.8c.9 1.3 2.3 2.1 3.9 2.1H21M3 17h3.5c1.3 0 2.5-.6 3.4-1.5M13.1 8.5c.9-.9 2.1-1.5 3.4-1.5H21M18 4l3 3-3 3M18 14l3 3-3 3" />
    </svg>
  );
}

function MarkUnreadIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
    </svg>
  );
}

function MarkAllReadIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function StarIcon({ filled }: { filled?: boolean }) {
  return (
    <svg
      className="w-3.5 h-3.5"
      fill={filled ? 'currentColor' : 'none'}
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
      />
    </svg>
  );
}

/* ── Mobile view-options sheet (icons + rows) ───────────────────── */

function OptionsIcon() {
  // Sliders / adjustments — clearer "display options" affordance.
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7h11M18 7h3M3 17h3M10 17h11" />
      <circle cx="16" cy="7" r="2.2" />
      <circle cx="8" cy="17" r="2.2" />
    </svg>
  );
}

function SourceGlyph() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
    </svg>
  );
}

function FaviconGlyph() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  );
}

function DateGlyph() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
    </svg>
  );
}

function TopbarGlyph({ on }: { on?: boolean }) {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      {on && <path d="M5 4h14a2 2 0 0 1 2 2v2.5H3V6a2 2 0 0 1 2-2z" fill="currentColor" stroke="none" />}
      <path d="M3 8.5h18" />
    </svg>
  );
}

function SheetDivider() {
  return <div className="my-1 h-px mx-2" style={{ background: 'var(--panel-border)' }} />;
}

interface SheetRowProps {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}

function SheetRow({ icon, label, active, onClick }: SheetRowProps) {
  return (
    <button
      onClick={onClick}
      aria-pressed={!!active}
      className="sheet-row w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover-tint"
      style={{ color: active ? 'var(--accent)' : 'var(--list-title)' }}
    >
      <span className="flex-shrink-0">{icon}</span>
      <span className="flex-1 font-medium">{label}</span>
      {active && (
        <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}
    </button>
  );
}

/* ── Empty state ────────────────────────────────────────────────── */

interface EmptyStateProps {
  filter: Filter;
  searchQuery: string;
  /** Liste vide parce que le chargement a échoué — voir `listBodyState`. */
  failed: boolean;
  onRetry: () => void;
  /** Tirage vide : voir `drawRandomList`. */
  random?: boolean;
  /** Liste vide alors qu'une page reste promise — voir `listBodyState`. */
  awaitingPage: boolean;
  /** Le bouton « charger la suite » doit-il s'afficher occupé/inactif ?
   *  Vrai pendant le chargement ET pendant la revalidation d'arrière-plan
   *  d'une vue déjà peinte par le cache — voir `canLoadMore`. */
  loadMoreBusy: boolean;
  onLoadMore: () => void;
}

function EmptyState({ filter, searchQuery, failed, onRetry, awaitingPage, loadMoreBusy, onLoadMore, random }: EmptyStateProps) {
  const { t } = useTranslation();
  let icon: ReactNode;
  let title: string;
  let subtitle: string;

  if (failed) {
    // Le chargement a échoué et rien ne le remplace : ne surtout pas dire
    // « Tout est lu ! » (c'était le cas), mais l'échec, et l'action qui le lève.
    icon = (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
      </svg>
    );
    title = t('emptyState.loadFailed');
    subtitle = t('emptyState.loadFailedHint');
  } else if (awaitingPage) {
    // État neutre : la liste n'a plus de ligne à montrer mais le flux n'est
    // pas épuisé. Il n'affirme donc RIEN — ni « tout est lu », ni « aucun
    // favori » — et donne la seule action qui avance : charger la suite.
    // C'est ce qui remplace le squelette sans fin de la première correction.
    icon = (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 5.25l-7.5 7.5-7.5-7.5m15 6l-7.5 7.5-7.5-7.5" />
      </svg>
    );
    title = t('emptyState.morePages');
    subtitle = t('emptyState.morePagesHint');
  } else if (searchQuery) {
    icon = (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
      </svg>
    );
    title = t('emptyState.noResults');
    subtitle = t('emptyState.noResultsHint');
  } else if (random) {
    // « Tout est lu » serait faux : le tirage vient de se vider, ou l'ancienneté
    // réglée n'a rien ramené. Il peut rester des milliers d'articles.
    icon = <ShuffleIcon />;
    title = t('articleList.randomEmpty');
    subtitle = t('articleList.randomEmptyHint');
  } else if (filter === 'unread') {
    icon = (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
    title = t('emptyState.allRead');
    subtitle = t('emptyState.allReadHint');
  } else if (filter === 'starred') {
    icon = (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
      </svg>
    );
    title = t('emptyState.noStarred');
    subtitle = t('emptyState.noStarredHint');
  } else if (filter === 'readlater') {
    icon = (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
    title = t('emptyState.noReadLater');
    subtitle = t('emptyState.noReadLaterHint');
  } else {
    icon = (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z" />
      </svg>
    );
    title = t('emptyState.noArticles');
    subtitle = t('emptyState.noArticlesHint');
  }

  const isSuccess = filter === 'unread' && !searchQuery && !awaitingPage && !failed && !random;

  // Six états vides partagent un gabarit alors qu'ils ne disent pas la même
  // chose. « Tout est lu » est une réussite — le moment où l'application a fini
  // son travail — et « aucun résultat » est une impasse, qui doit proposer la
  // sortie. Un écran vide est une invitation à agir, pas un constat : celui-là
  // ne doit JAMAIS être une impasse (c'est ce qu'était le squelette sans fin).
  let action: { label: string; run: () => void; busy?: boolean } | null = null;
  if (failed) {
    action = { label: t('emptyState.loadFailedAction'), run: onRetry };
  } else if (awaitingPage) {
    action = {
      label: loadMoreBusy ? t('articleList.loading') : t('emptyState.morePagesAction'),
      run: onLoadMore,
      busy: loadMoreBusy,
    };
  } else if (searchQuery) {
    action = {
      label: t('emptyState.noResultsAction'),
      run: () => {
        const store = useFeedStore.getState();
        store.selectView(null, 'all');
        store.search(searchQuery);
      },
    };
  } else if (random) {
    action = { label: t('articleList.randomAgain'), run: onRetry };
  } else if (isSuccess) {
    action = {
      label: t('emptyState.allReadAction'),
      run: () => useFeedStore.getState().setUnreadFilter(false),
    };
  }

  return (
    <div className="px-8 py-12 text-center flex flex-col items-center gap-3">
      <div
        className="rounded-full flex items-center justify-center"
        style={{
          width: isSuccess ? 72 : 56,
          height: isSuccess ? 72 : 56,
          background: isSuccess ? 'var(--accent-glow)' : 'color-mix(in srgb, var(--panel-border) 40%, transparent)',
          color: isSuccess ? 'var(--accent)' : 'var(--list-summary)',
          boxShadow: isSuccess ? '0 0 0 8px color-mix(in srgb, var(--accent) 7%, transparent)' : undefined,
        }}
      >
        {icon}
      </div>
      <p
        className="font-semibold"
        style={{
          color: isSuccess ? 'var(--accent)' : 'var(--list-title)',
          fontSize: isSuccess ? '17px' : '14px',
        }}
      >
        {title}
      </p>
      <p className="text-xs max-w-[36ch]" style={{ color: 'var(--list-summary)' }}>{subtitle}</p>
      {action && (
        <button
          onClick={action.run}
          disabled={action.busy}
          className="mt-1 px-3.5 py-2 rounded-full text-xs font-semibold transition-colors"
          style={{
            color: 'var(--accent)',
            background: 'var(--accent-glow)',
            border: '1.5px solid color-mix(in srgb, var(--accent) 30%, transparent)',
            opacity: action.busy ? 0.6 : undefined,
            cursor: action.busy ? 'default' : undefined,
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/* ── Article row ─────────────────────────────────────────────────── */

type MobileArticleRowProps = Omit<ComponentProps<typeof SwipeableArticleRow>, 'onSwipeDecided' | 'swipeBlocked'>;

/**
 * Une ligne d'article au doigt : le balayage enveloppe la ligne, et les deux
 * gestes s'excluent. La direction décidée annule l'appui long (un balayage
 * n'ouvre jamais le menu) ; un appui long abouti bloque le balayage du même
 * contact (le glisser qui suit un menu ouvert ne bascule rien). « L'appui
 * long », ce sont TOUS ceux de la ligne : le sien (menu) et ceux de ses
 * boutons Favori / À lire plus tard (classement), inscrits dans le registre
 * fourni ici (`rowPress.ts`).
 */
export function MobileArticleRow({ children, ...swipe }: MobileArticleRowProps) {
  const [presses] = useState(createRowPressRegistry);
  return (
    <RowPressContext.Provider value={presses}>
      <SwipeableArticleRow
        {...swipe}
        onSwipeDecided={presses.cancelAll}
        swipeBlocked={presses.firedThisContact}
      >
        {children}
      </SwipeableArticleRow>
    </RowPressContext.Provider>
  );
}

interface ArticleRowProps {
  article: Article;
  viewMode: string;
  showSource: boolean;
  rowActions: RowActionSettings;
  /** URL de l'icône du flux ; `null` = pas d'icône connue mais on affiche le
   *  repli (pastille-lettre) ; `undefined` = favicons désactivés. */
  favicon?: string | null;
  /** Retard d'apparition, ou `undefined` pour ne pas animer. Décidé par
   *  `staggerIndexes` : seule une PREMIÈRE apparition dans la vue s'anime. */
  staggerIndex?: number;
  active: boolean;
  /** Les termes de la recherche en cours, à marquer dans le titre et le résumé. */
  searchTerms?: readonly string[];
  onSelect: () => void;
  onToggleStar: (e: ReactMouseEvent) => void;
  onToggleRead: (e: ReactMouseEvent) => void;
  onToggleReadLater: (e: ReactMouseEvent) => void;
  onOpenSource: (e: ReactMouseEvent) => void;
  /** Clic droit, touche Menu ou appui long : ouvre le menu de l'article. Absent, le navigateur garde son menu. */
  onOpenMenu?: (point: { x: number; y: number }) => void;
  /** Le titre-lien a été ouvert par le navigateur (clic molette, ⌘/Ctrl-clic) : marquer lu sans sélectionner. Voir `TitleLink`. */
  onOpenedInBackground?: () => void;
}

/**
 * Exporté pour les tests (`ArticleRow.compact.test.tsx`) : la ligne compacte
 * est le mode le plus retouché des trois et n'était couverte par rien : l'ordre
 * des icônes, l'emplacement réservé et « le clic n'ouvre pas l'article » ne
 * tenaient qu'à travers la carte de la vue grille. `ArticleList` reste
 * l'unique consommateur applicatif.
 */
export function ArticleRow({ article, viewMode, showSource, rowActions, favicon, staggerIndex, active, searchTerms, onSelect, onToggleStar, onToggleRead, onToggleReadLater, onOpenSource, onOpenMenu, onOpenedInBackground }: ArticleRowProps) {
  const { t } = useTranslation();
  // Les appuis longs de la ligne et de ses boutons : le registre du balayage
  // qui l'enveloppe sur mobile, sinon le sien — le drag natif de la ligne
  // (Chrome Android) doit les voir tous, quelle que soit la disposition.
  const outerPresses = useContext(RowPressContext);
  const [ownPresses] = useState(createRowPressRegistry);
  const presses = outerPresses ?? ownPresses;
  const gestures = useArticleMenuGestures(onOpenMenu, onOpenSource, { presses, onDragStart: handleDragStart });
  const provide = (node: ReactNode) => <RowPressContext.Provider value={presses}>{node}</RowPressContext.Provider>;
  const isReadLater = article.labels?.includes(READ_LATER_LABEL);
  const thumbnail = viewMode === 'preview' ? extractImageFromContent(article.content) : null;
  // Décalage d'apparition. Le seuil et le droit d'animer sont décidés en
  // amont (`staggerIndexes`) : une ligne déjà rendue n'en reçoit pas, sans
  // quoi elle rejouerait l'animation d'entrée en clignotant dès qu'un retrait
  // la fait remonter.
  const stagger = staggerIndex !== undefined
    ? { 'data-stagger': '', style: { animationDelay: `${staggerIndex * 25}ms` } }
    : null;

  function handleDragStart(e: ReactDragEvent<HTMLElement>) {
    e.dataTransfer.setData('application/frirss-article', article.id);
    e.dataTransfer.effectAllowed = 'link';
    e.dataTransfer.setData('application/frirss-article-json', JSON.stringify(article));

    // Custom lightweight drag image
    const ghost = document.createElement('div');
    ghost.textContent = articleTitle(article, t);
    Object.assign(ghost.style, {
      position: 'fixed', left: '-9999px', top: '0',
      maxWidth: '220px', padding: '6px 12px',
      borderRadius: '8px', fontSize: '11px', fontWeight: '600',
      background: 'var(--accent)', color: '#fff',
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    });
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 110, 16);
    requestAnimationFrame(() => ghost.remove());
  }

  if (viewMode === 'compact') {
    return provide(
      <div
        role="article"
        aria-label={articleTitle(article, t)}
        tabIndex={0}
        draggable
        {...gestures}
        onClick={onSelect}
        onKeyDown={(e) => e.key === 'Enter' && onSelect()}
        className={`article-row w-full text-left flex items-center gap-2 px-4 py-2 cursor-pointer ${
          active ? 'article-row-active bg-[var(--list-selected)]' : 'hover:bg-[var(--list-hover)]'
        }`}
        {...(stagger ? { 'data-stagger': '' } : {})}
        data-article-id={article.id}
        aria-current={active ? 'true' : undefined}
        style={{ borderBottom: '1px solid var(--panel-border)', ...(stagger?.style ?? {}) }}
      >
        {/* Always reserve space for the unread dot to avoid alignment shift */}
        <div
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: article.read ? 'transparent' : 'var(--list-unread-bar)' }}
        />
        {favicon !== undefined && (
          <FeedFavicon iconUrl={favicon ?? undefined} title={article.source} size={14} />
        )}
        {/* M-10 — la source et le titre se partagent ce que laissent le
            point, l'icône, l'heure et les boutons : un tiers au plus pour la
            source (jamais plus que son texte), le reste au titre. Avant, la
            source gardait 80 px et ne rétrécissait pas : à 320 px le titre
            tombait à 0 et la ligne débordait de l'écran avec le ✓. Rien ne
            se masque ici : masquer la source ou des boutons reste un réglage
            de l'utilisateur. Mesures : docs/FEATURES.md. */}
        {showSource && (
          <span
            className="font-medium uppercase truncate"
            data-theme="list-source"
            title={article.source}
            style={{
              color: 'var(--list-source)', fontSize: 'var(--fs-list-source)',
              flexGrow: 1, flexShrink: 1, flexBasis: '0px', minWidth: '0px', maxWidth: 'max-content',
            }}
          >
            {article.source}
          </span>
        )}
        <span
          dir="auto"
          className={`article-title truncate ${article.read ? 'font-normal' : 'font-medium'}`}
          data-theme={article.read ? 'list-title-read' : 'list-title'}
          style={{
            color: article.read ? 'var(--list-title-read)' : 'var(--list-title)', fontSize: 'var(--fs-list-title)',
            flexGrow: 2, flexShrink: 1, flexBasis: '0px', minWidth: '0px',
          }}
        >
          <TitleLink url={article.url} onOpenedInBackground={onOpenedInBackground}>
            <Highlighted text={articleTitle(article, t)} terms={searchTerms} />
          </TitleLink>
        </span>
        <span className="text-[10px] flex-shrink-0" data-theme="list-time" style={{ color: 'var(--list-time)' }}>
          {timeAgo(article.published, t)}
        </span>
        {/* `gap-2` (8 px), pas `gap-1` : quatre cibles de 22 px côte à côte —
            `.article-row button` est exempté du `min-height: 40px` tactile,
            juste en dessous du minimum WCAG 2.5.8 — et un doigt qui visait le
            ✓ tombait sur « ouvrir à la source », qui ouvre un onglet, marque
            lu ET sélectionne l'article. Huit pixels de largeur de ligne contre
            une méprise coûteuse. */}
        <ArticleRowActions
          article={article}
          isReadLater={isReadLater}
          settings={rowActions}
          className="flex items-center gap-2 flex-shrink-0"
          onToggleStar={onToggleStar}
          onToggleReadLater={onToggleReadLater}
          onOpenSource={onOpenSource}
          onToggleRead={onToggleRead}
        />
      </div>
    );
  }

  return provide(
    <div
      role="article"
      aria-label={articleTitle(article, t)}
      tabIndex={0}
      draggable
      {...gestures}
      onClick={onSelect}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
      /* Unread marker. The compact row has a dot; these rows had nothing but a
         bolder title in a darker grey — invisible on a matt screen, at an
         angle, or to an eye that separates greys poorly. The bar is drawn in
         CSS off this attribute, reusing the `inset 3px` idiom that already
         marks the selected row. */
      data-unread={article.read ? undefined : ''}
      className={`article-row w-full text-left flex gap-3 px-4 py-3 cursor-pointer ${
        active ? 'article-row-active bg-[var(--list-selected)]' : 'hover:bg-[var(--list-hover)]'
      }`}
      {...(stagger ? { 'data-stagger': '' } : {})}
      data-article-id={article.id}
      aria-current={active ? 'true' : undefined}
      style={{ borderBottom: '1px solid var(--panel-border)', ...(stagger?.style ?? {}) }}
    >
      {thumbnail && viewMode === 'preview' && (
        <div className="w-20 h-16 rounded overflow-hidden flex-shrink-0 bg-gray-100">
          <img
            src={thumbnail}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => { const p = e.currentTarget.parentElement; if (p) p.style.display = 'none'; }}
          />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          {favicon !== undefined && (
            <FeedFavicon iconUrl={favicon ?? undefined} title={article.source} size={16} />
          )}
          {showSource && (
            <span
              className="font-semibold uppercase tracking-wide"
              data-theme="list-source"
              style={{ color: 'var(--list-source)', fontSize: 'var(--fs-list-source)' }}
            >
              {article.source}
            </span>
          )}
          <span className="text-[10px]" data-theme="list-time" style={{ color: 'var(--list-time)' }}>
            {timeAgo(article.published, t)}
          </span>
        </div>

        <h3
          dir="auto"
          className={`article-title leading-snug mb-1 ${article.read ? 'font-normal' : 'font-semibold'}`}
          data-theme={article.read ? 'list-title-read' : 'list-title'}
          style={{ color: article.read ? 'var(--list-title-read)' : 'var(--list-title)', fontSize: 'var(--fs-list-title)' }}
        >
          <TitleLink url={article.url} onOpenedInBackground={onOpenedInBackground}>
            <Highlighted text={articleTitle(article, t)} terms={searchTerms} />
          </TitleLink>
        </h3>

        {viewMode !== 'compact' && (
          <p dir="auto" className="line-clamp-2 leading-relaxed" data-theme="list-summary" style={{ color: 'var(--list-summary)', fontSize: 'var(--fs-list-summary)' }}>
            <Highlighted text={resultSummary(article, searchTerms ?? [])} terms={searchTerms} />
          </p>
        )}
      </div>

      {/* Une COLONNE, et elle coûte de la hauteur — c'est assumé. Quatre
          boutons empilés mesurent 102 px, alors que le bloc de texte voisin
          (source + titre + résumé sur deux lignes) en fait 79,25 : la colonne
          devient donc ce qui dicte la hauteur de la ligne, qui passe de
          104,25 px à 127 px, soit +22,75 px (mesuré au navigateur sur ce
          balisage et la feuille de styles construite, panneau de 420 px).
          Une grille 2 × 2 rendait ces 22,75 px, et elle a été refusée : les
          quatre icônes doivent rester alignées comme les trois d'avant.
          Rétrécir les boutons n'est PAS l'échappatoire : ils font déjà
          22 × 22 px, sous le minimum de 24 px de WCAG 2.5.8, parce que
          `.article-row button` est exempté du `min-height: 40px` tactile.
          Les deux autres modes gardent leur disposition en ligne. */}
      <ArticleRowActions
        article={article}
        isReadLater={isReadLater}
        settings={rowActions}
        className="flex flex-col items-center gap-1 flex-shrink-0 pt-0.5"
        onToggleStar={onToggleStar}
        onToggleReadLater={onToggleReadLater}
        onOpenSource={onOpenSource}
        onToggleRead={onToggleRead}
      />
    </div>
  );
}

interface ToggleProps {
  active: boolean;
  onClick: () => void;
}

function DateSepToggle({ active, onClick }: ToggleProps) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onClick}
      title={active ? t('articleList.hideDateSep') : t('articleList.showDateSep')}
      aria-label={t('articleList.dateSeparators')}
      aria-pressed={active}
      {...noFocusOnPointer}
      className={`option-toggle ${active ? 'option-toggle--on' : ''}`}
    >
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
      </svg>
    </button>
  );
}

function TopbarToggle() {
  const { t } = useTranslation();
  const topbarVisible = useUiStore((s) => s.topbarVisible);
  const toggleTopbar = useUiStore((s) => s.toggleTopbar);
  return (
    <button
      onClick={toggleTopbar}
      title={topbarVisible ? t('articleList.hideTopbar') : t('articleList.showTopbar')}
      aria-label={t('articleList.serverBar')}
      aria-pressed={topbarVisible}
      {...noFocusOnPointer}
      className={`option-toggle ${topbarVisible ? 'option-toggle--on' : ''}`}
    >
      {/* Top-panel icon — window with a solid top bar (filled when shown) */}
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2.5" />
        {topbarVisible && (
          <path d="M5 4h14a2 2 0 0 1 2 2v2.5H3V6a2 2 0 0 1 2-2z" fill="currentColor" stroke="none" />
        )}
        <path d="M3 8.5h18" />
      </svg>
    </button>
  );
}

/** Favicons dans la liste — même groupe que « nom du flux » et « dates ». */
function FaviconToggle() {
  const { t } = useTranslation();
  const on = useUiStore((s) => s.showListFavicons);
  const toggle = useUiStore((s) => s.toggleShowListFavicons);
  const label = on ? t('articleList.hideListFavicons') : t('articleList.showListFavicons');
  return (
    <button
      onClick={toggle}
      title={label}
      aria-label={label}
      aria-pressed={on}
      {...noFocusOnPointer}
      className={`option-toggle ${on ? 'option-toggle--on' : ''}`}
    >
      {/* Carré arrondi + pastille : une icône de site, pas une image. */}
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
        <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
        <circle cx="12" cy="12" r="3.2" fill={on ? 'currentColor' : 'none'} />
      </svg>
    </button>
  );
}

interface SourceToggleProps {
  active: boolean;
  onClick: () => void;
  tooltip: string;
}

function SourceToggle({ active, onClick, tooltip }: SourceToggleProps) {
  return (
    <button
      onClick={onClick}
      title={tooltip}
      aria-label={tooltip}
      aria-pressed={active}
      {...noFocusOnPointer}
      className={`option-toggle ${active ? 'option-toggle--on' : ''}`}
    >
      {/* Source/feed name icon — tag with "Aa" */}
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
      </svg>
    </button>
  );
}

function LayoutToggle({ overridden }: { overridden?: boolean }) {
  const { t } = useTranslation();
  const { panelLayout, setPanelLayout } = useUiStore();

  // These buttons set the GLOBAL default; say so on every button (a tooltip on
  // the group alone would never show, the buttons cover it). When the current
  // feed overrides it, add why the view may not follow the click.
  const tip = (name: string) =>
    `${name} — ${t('articleList.layoutScopeAll')}` +
    (overridden ? ` · ${t('articleList.layoutOverridden')}` : '');

  return (
    <div
      data-theme="list-active"
      className="relative flex items-center gap-0.5 rounded-md p-0.5"
      style={{ background: 'var(--list-active)' }}
    >
      {/* This feed overrides the global layout — the buttons below still set
          the global default, so flag the discrepancy. */}
      {overridden && (
        <span
          className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full pointer-events-none"
          style={{ background: 'var(--accent)' }}
        />
      )}
      <button
        onClick={() => setPanelLayout('2')}
        title={tip(t('articleList.listOnly'))}
        aria-label={t('articleList.listOnly')}
        aria-pressed={panelLayout === '2'}
        {...noFocusOnPointer}
        className={`p-1 rounded transition-all ${
          panelLayout === '2'
            ? 'bg-[var(--panel-bg)] shadow-sm text-[var(--accent)]'
            : 'text-[var(--list-summary)] hover:text-[var(--list-title)]'
        }`}
      >
        {/* Single column icon — list only */}
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <rect x="3" y="4.5" width="18" height="15" rx="1.5" />
          <path strokeLinecap="round" d="M7 9h10M7 12h10M7 15h6" />
        </svg>
      </button>
      <button
        onClick={() => setPanelLayout('3')}
        title={tip(t('articleList.listAndReading'))}
        aria-label={t('articleList.listAndReading')}
        aria-pressed={panelLayout === '3'}
        {...noFocusOnPointer}
        className={`p-1 rounded transition-all ${
          panelLayout === '3'
            ? 'bg-[var(--panel-bg)] shadow-sm text-[var(--accent)]'
            : 'text-[var(--list-summary)] hover:text-[var(--list-title)]'
        }`}
      >
        {/* Two columns icon — list + reading pane */}
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <rect x="3" y="4.5" width="18" height="15" rx="1.5" />
          <line x1="11" y1="4.5" x2="11" y2="19.5" />
          <path strokeLinecap="round" d="M6 9h3M6 12h3M14 9h4M14 11.5h4M14 14h2.5" />
        </svg>
      </button>
      <button
        onClick={() => setPanelLayout('grid')}
        title={tip(t('articleList.gridLayout'))}
        aria-label={t('articleList.gridLayout')}
        aria-pressed={panelLayout === 'grid'}
        {...noFocusOnPointer}
        className={`p-1 rounded transition-all ${
          panelLayout === 'grid'
            ? 'bg-[var(--panel-bg)] shadow-sm text-[var(--accent)]'
            : 'text-[var(--list-summary)] hover:text-[var(--list-title)]'
        }`}
      >
        {/* Grid icon — full-width card gallery */}
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75h6.5v6.5h-6.5v-6.5zm10 0h6.5v6.5h-6.5v-6.5zm-10 10h6.5v6.5h-6.5v-6.5zm10 0h6.5v6.5h-6.5v-6.5z" />
        </svg>
      </button>
    </div>
  );
}
