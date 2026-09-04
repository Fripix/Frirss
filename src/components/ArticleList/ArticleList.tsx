import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type FormEvent, type MouseEvent as ReactMouseEvent, type DragEvent as ReactDragEvent } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useFeedStore, READ_LATER_LABEL, isCategoryStreamId } from '../../stores/feedStore';
import { useUiStore } from '../../stores/uiStore';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { groupByDate } from '../../utils/dates';
import { markAllReadAction, canMarkAllRead } from '../../lib/markAllRead';
import { effectiveLayout } from '../../lib/effectiveLayout';
import { shouldLoadMore, listBodyState, canLoadMore } from '../../lib/listPagination';
import { listOverflows, publishListCanScroll, resetListCanScroll } from '../../lib/listOverflow';
import { extractImageFromContent } from '../../lib/articleThumbnail';
import { openArticleAtSource } from '../../lib/openArticleAtSource';
import type { RowActionSettings } from '../../lib/rowActions';
import { timeAgo } from '../../lib/timeAgo';
import ViewModeSwitcher from './ViewModeSwitcher';
import SwipeableArticleRow from './SwipeableArticleRow';
import { ArticleRowActions } from './ArticleActions';
import ArticleCard from './ArticleCard';
import FeedFavicon from '../FeedFavicon';
import BottomSheet from '../BottomSheet';
import { useAuthStore } from '../../stores/authStore';
import { loadSearchHistory, rememberSearch, forgetSearch } from '../../lib/searchHistory';
import { scrolledPastTop, shouldMark, MARK_READ_DELAY_MS } from '../../lib/markReadOnScroll';
import { canMorph, withMorph } from '../../lib/viewTransition';
import { noFocusOnPointer } from '../../lib/pointerFocus';
import { prefersReducedMotion } from '../../lib/reducedMotion';
import { staggerIndexes, rememberStagger } from '../../lib/rowStagger';
import type { Article, Filter } from '../../types';

// Per-view scroll position, kept across remounts (e.g. returning from an
// article in 2-panel desktop, or any re-mount of the list).
const listScrollMem = new Map<string, number>();

interface PullState {
  startY?: number;
  atTop?: boolean;
  pulling?: boolean;
  dist?: number;
}

export default function ArticleList() {
  const { t } = useTranslation();
  const {
    articles,
    loading,
    loadingMore,
    revalidating,
    selectedArticle,
    selectedFeed,
    filter,
    searchQuery,
    selectArticle,
    toggleStar,
    toggleRead,
    loadMore,
    continuation,
    search,
    clearSearch,
    markAllAsRead,
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
  const markReadOnScroll = useUiStore((s) => s.markReadOnScroll);
  const showSourceInAll = useUiStore((s) => s.showSourceInAll);
  const toggleShowSourceInFeed = useUiStore((s) => s.toggleShowSourceInFeed);
  const toggleShowSourceInAll = useUiStore((s) => s.toggleShowSourceInAll);
  const feedSettings = useUiStore((s) => s.feedSettings);
  const showDateSeparators = useUiStore((s) => s.showDateSeparators);
  const toggleDateSeparators = useUiStore((s) => s.toggleDateSeparators);
  const gridDateSeparators = useUiStore((s) => s.gridDateSeparators);
  const toggleGridDateSeparators = useUiStore((s) => s.toggleGridDateSeparators);
  const confirmMarkAllRead = useUiStore((s) => s.confirmMarkAllRead);
  const topbarVisible = useUiStore((s) => s.topbarVisible);
  const toggleTopbar = useUiStore((s) => s.toggleTopbar);
  const breakpoint = useBreakpoint();
  const isDesktop = breakpoint === 'desktop';
  const isMobile = breakpoint === 'mobile';
  // A feed can override the global layout (set from its sidebar context menu).
  const layout = effectiveLayout(panelLayout, feedSettings, selectedFeed?.id);
  const feedLayoutOverride = !!(selectedFeed && feedSettings[selectedFeed.id]?.layout);
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

  const renderCard = (article: Article) => (
    <ArticleCard
      key={article.id}
      article={article}
      showSource={showSource}
      rowActions={rowActions}
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
        openArticleAtSource(article, selectArticle);
      }}
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
  const headerUnread = useMemo(() => {
    if (filter === 'starred' || filter === 'readlater') return null;
    if (selectedFeed) {
      if (isCategoryStreamId(selectedFeed.id)) return null;
      return unreadCounts[selectedFeed.id] || 0;
    }
    return subscriptions.reduce((sum, sub) => sum + (unreadCounts[sub.id] || 0), 0);
  }, [filter, selectedFeed, subscriptions, unreadCounts]);

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
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  // Recherches récentes du serveur actif. Rechargées à chaque ouverture du
  // champ plutôt que gardées en état : elles changent à la soumission.
  const activeServerId = useAuthStore((s) => s.activeServerId);
  const [history, setHistory] = useState<string[]>([]);
  const [markAllConfirm, setMarkAllConfirm] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false); // mobile view-options sheet
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Pull-to-refresh (touch)
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pullRef = useRef<PullState>({});
  const refreshingRef = useRef(false);
  const PULL_TRIGGER = 56;

  // Scroll memory — key the saved position by the current view
  const scrollKey = `${selectedFeed?.id || ''}:${filter}:${searchQuery || ''}`;
  const scrollKeyRef = useRef(scrollKey);
  scrollKeyRef.current = scrollKey;
  const didRestoreRef = useRef(false);

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
  const articleIds = useMemo(() => articles.map((a) => a.id), [articles]);
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
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measureOverflow);
      ro.observe(el);
    } else {
      window.addEventListener('resize', measureOverflow);
    }
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measureOverflow);
      // Plus aucune liste à l'écran (onglet mobile, volet de lecture plein
      // écran) : la dernière mesure serait figée et un ✓ depuis le volet de
      // lecture demanderait une page par geste, sans que personne ne la voie.
      resetListCanScroll();
    };
  }, [measureOverflow]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    listScrollMem.set(scrollKeyRef.current, el.scrollTop);
    // Les images qui finissent de charger changent `scrollHeight` sans aucun
    // rendu React : le défilement est la meilleure occasion de se remettre à
    // jour, et les hauteurs sont déjà lues juste en dessous.
    publishListCanScroll(
      listOverflows({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight })
    );
    if (
      shouldLoadMore({
        hasContinuation: !!continuation,
        loading,
        loadingMore,
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      })
    ) {
      loadMore();
    }
  }, [continuation, loading, loadingMore, loadMore]);

  // Restore the saved scroll position once, after the list has content
  // (covers remounts; on mobile the list stays mounted so position persists).
  useLayoutEffect(() => {
    if (didRestoreRef.current) return;
    const el = listRef.current;
    if (!el || loading || articles.length === 0) return;
    const saved = listScrollMem.get(scrollKey);
    if (saved) el.scrollTop = saved;
    didRestoreRef.current = true;
  }, [loading, articles.length, scrollKey]);

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
        Promise.resolve(silentRefresh()).finally(() => {
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
  }, [markReadOnScroll, searchQuery, articles.length]);

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

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    runSearch(searchValue);
  }

  function handleClearSearch() {
    setSearchValue('');
    setSearchOpen(false);
    clearSearch();
  }

  function handleMarkAllRead() {
    if (markAllReadAction(confirmMarkAllRead, markAllConfirm) === 'ask') {
      setMarkAllConfirm(true);
      setTimeout(() => setMarkAllConfirm(false), 3000);
      return;
    }
    // Le compte vient du compteur de non-lus de la vue, pas des articles
    // chargés : le serveur vide TOUT le flux, pas seulement la page affichée.
    // Il n'y a **pas** d'annulation, et il ne peut pas y en avoir d'honnête :
    // l'API marque le flux entier à une date donnée, sans jamais dire quels
    // articles étaient concernés. Restaurer les seuls articles en mémoire
    // rendrait une partie de la vue non lue et laisserait le reste lu, avec
    // des compteurs qui mentiraient. La confirmation avant reste donc le
    // garde-fou. Voir `markAllRead.ts`.
    const count = headerUnread;
    markAllAsRead();
    pushToast(count ? t('toast.markedRead', { count }) : t('toast.markedReadAll'));
    setMarkAllConfirm(false);
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

  const groups = groupByDate(articles);

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
    hasContinuation: !!continuation,
    searching: !!searchQuery,
  });
  // Le bouton « charger la suite » de l'état vide neutre reste inactif tant
  // qu'un clic ne peut pas agir sans risque — page déjà en vol, ou vue encore
  // en cours de revalidation depuis un hit du cache mémoire (voir
  // `canLoadMore` : cliquer dans cette fenêtre perdrait la course contre
  // `loadArticles` et jetterait le travail du clic).
  const loadMoreBusy = !canLoadMore({ hasContinuation: !!continuation, loadingMore, revalidating });

  return (
    <div className="article-list h-full flex flex-col overflow-x-hidden" style={{ background: 'var(--panel-bg)' }}>
      {/* Header */}
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
                className="p-1.5 -ml-1 rounded transition-colors hover:bg-black/5 flex-shrink-0"
                style={{ color: 'var(--list-summary)' }}
                title={t('sidebar.showSidebar')}
                aria-label={t('sidebar.showSidebar')}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
                </svg>
              </button>
            )}
            <h2 className="text-[15px] font-bold truncate min-w-0" style={{ color: 'var(--list-title)' }}>
              {searchQuery ? `${t('articleList.search')} : ${searchQuery}` : title}
            </h2>
            <HeaderUnread count={headerUnread} />
            <div className="flex-1 flex items-center">
              <ToolbarBtn flex1 iconOnly icon={<SearchIcon />} label={t('articleList.search')} onClick={() => setSearchOpen(true)} />
              <ToolbarBtn flex1 iconOnly icon={<MarkUnreadIcon />} label={t('articleList.unread')} active={filter === 'unread'}
                onClick={() => useFeedStore.getState().setUnreadFilter(filter !== 'unread')} />
              <ToolbarBtn flex1 iconOnly icon={<StarIcon filled={filter === 'starred'} />} label={t('articleList.starred')} active={filter === 'starred'}
                onClick={() => useFeedStore.getState().setFilter(filter === 'starred' ? 'all' : 'starred')} />
              {canMarkAllRead(filter) && (
                <ToolbarBtn flex1 iconOnly icon={<MarkAllReadIcon />} label={markAllConfirm ? t('articleList.confirm') : t('articleList.markAllRead')}
                  active={markAllConfirm} onClick={handleMarkAllRead} />
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
        ) : is2Panel ? (
          /* ── 2-panel: single unified toolbar ── */
          <div className="px-3 py-2 flex items-center gap-2 min-h-[48px]">
            {!sidebarVisible && (
              <button
                onClick={toggleSidebar}
                className="p-1.5 rounded transition-colors hover:bg-black/5 flex-shrink-0"
                style={{ color: 'var(--list-summary)' }}
                title={t('sidebar.showSidebar')}
                aria-label={t('sidebar.showSidebar')}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
                </svg>
              </button>
            )}

            <h2 className="text-[16px] font-bold truncate min-w-0" style={{ color: 'var(--list-title)' }}>
              {searchQuery ? `${t('articleList.search')} : ${searchQuery}` : title}
            </h2>
            <HeaderUnread count={headerUnread} />

            <div className="w-px h-4 mx-1 flex-shrink-0" style={{ background: 'var(--panel-border)' }} />

            {/* Inline toolbar actions */}
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <ToolbarBtn icon={<SearchIcon />} label={t('articleList.search')} shortcut="F" onClick={() => setSearchOpen(true)} />
              <ToolbarBtn icon={<MarkUnreadIcon />} label={t('articleList.unread')} active={filter === 'unread'}
                onClick={() => useFeedStore.getState().setUnreadFilter(filter !== 'unread')} />
              <ToolbarBtn icon={<StarIcon filled={filter === 'starred'} />} label={t('articleList.starred')} active={filter === 'starred'}
                onClick={() => useFeedStore.getState().setFilter(filter === 'starred' ? 'all' : 'starred')} />
              {canMarkAllRead(filter) && (
                <>
                  <ToolbarSep />
                  <ToolbarBtn icon={<MarkAllReadIcon />} label={markAllConfirm ? t('articleList.confirm') : t('articleList.markAllRead')}
                    active={markAllConfirm} onClick={handleMarkAllRead} />
                </>
              )}
            </div>

            <div className="flex-1" />

            <div className="flex items-center gap-1.5 flex-shrink-0">
              {/* Les quatre bascules d'affichage forment un groupe, comme la
                  densité et la disposition en ont déjà un. */}
              <div className="option-track">
                <SourceToggle
                  active={showSource}
                  onClick={isInFeed ? toggleShowSourceInFeed : toggleShowSourceInAll}
                  tooltip={isInFeed ? t('articleList.sourceToggleFeed') : t('articleList.sourceToggleAll')}
                />
                <FaviconToggle />
                <DateSepToggle active={dateSepActive} onClick={toggleDateSep} />
                <TopbarToggle />
              </div>
              {!gridLayout && <ViewModeSwitcher />}
              {isDesktop && <LayoutToggle overridden={feedLayoutOverride} />}
            </div>
          </div>
        ) : (
          /* ── 3-panel: compact two-row layout (title row + actions row) ── */
          <>
            <div className="px-3 py-2 flex items-center gap-2">
              {!sidebarVisible && (
                <button
                  onClick={toggleSidebar}
                  className="p-1.5 rounded transition-colors hover:bg-black/5 flex-shrink-0"
                  style={{ color: 'var(--list-summary)' }}
                  title={t('sidebar.showSidebar')}
                  aria-label={t('sidebar.showSidebar')}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
                  </svg>
                </button>
              )}

              <div className="min-w-0 flex-1 flex items-center gap-2">
                <h2 className="text-[16px] font-bold truncate" style={{ color: 'var(--list-title)' }}>
                  {searchQuery ? `${t('articleList.search')} : ${searchQuery}` : title}
                </h2>
                <HeaderUnread count={headerUnread} />
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0">
                <div className="option-track">
                  <SourceToggle
                    active={showSource}
                    onClick={isInFeed ? toggleShowSourceInFeed : toggleShowSourceInAll}
                    tooltip={isInFeed ? t('articleList.sourceToggleFeed') : t('articleList.sourceToggleAll')}
                  />
                  <FaviconToggle />
                  <DateSepToggle active={showDateSeparators} onClick={toggleDateSeparators} />
                  <TopbarToggle />
                </div>
                <ViewModeSwitcher />
                <LayoutToggle overridden={feedLayoutOverride} />
              </div>
            </div>

            <div className="px-2 py-1 flex items-center gap-0.5" style={{ borderTop: '1px solid var(--panel-border)' }}>
              <ToolbarBtn icon={<SearchIcon />} label={t('articleList.search')} shortcut="F" onClick={() => setSearchOpen(true)} />
              <ToolbarSep />
              <ToolbarBtn icon={<MarkUnreadIcon />} label={t('articleList.unread')} active={filter === 'unread'}
                onClick={() => useFeedStore.getState().setUnreadFilter(filter !== 'unread')} />
              <ToolbarBtn icon={<StarIcon filled={filter === 'starred'} />} label={t('articleList.starred')} active={filter === 'starred'}
                onClick={() => useFeedStore.getState().setFilter(filter === 'starred' ? 'all' : 'starred')} />
              {canMarkAllRead(filter) && (
                <>
                  <ToolbarSep />
                  <ToolbarBtn icon={<MarkAllReadIcon />} label={markAllConfirm ? t('articleList.confirm') : t('articleList.markAllRead')}
                    active={markAllConfirm} onClick={handleMarkAllRead} />
                </>
              )}
            </div>
          </>
        )}

        {/* Search bar (expandable) */}
        {searchOpen && (
          <form
            onSubmit={handleSearch}
            className="px-3 py-1.5 flex items-center gap-1.5"
            style={{ borderTop: '1px solid var(--panel-border)' }}
          >
            <div className="flex-1 relative">
              <svg
                className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
                style={{ color: 'var(--list-summary)' }}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <input
                ref={searchInputRef}
                data-search-input
                type="text"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder={t('articleList.searchIn', { scope: searchScope })}
                className="w-full text-xs pl-8 pr-3 py-1.5 rounded-lg border outline-none transition-colors"
                style={{
                  borderColor: 'var(--panel-border)',
                  color: 'var(--list-title)',
                  background: 'var(--panel-bg)',
                  // iOS zooms into inputs whose font is < 16px → force 16px on mobile.
                  fontSize: isMobile ? '16px' : undefined,
                }}
                onFocus={(e) => e.target.style.borderColor = 'var(--accent)'}
                onBlur={(e) => e.target.style.borderColor = 'var(--panel-border)'}
                onKeyDown={(e) => e.key === 'Escape' && handleClearSearch()}
              />
            </div>
            <button
              type="button"
              onClick={handleClearSearch}
              className="p-1.5 rounded-lg transition-colors hover:bg-black/5"
              style={{ color: 'var(--list-summary)' }}
              title={t('articleList.closeSearch')}
              aria-label={t('articleList.closeSearch')}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </form>
        )}

        {/* Recherches récentes — seulement quand le champ est vide, sinon elles
            recouvriraient ce que l'utilisateur est en train de taper. */}
        {searchOpen && !searchValue.trim() && history.length > 0 && (
          <div
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
                  onClick={() => { forgetSearch(activeServerId, q); setHistory(loadSearchHistory(activeServerId)); }}
                  className="pr-2 pl-0.5 py-1 rounded-r-full opacity-50 hover:opacity-100 transition-opacity"
                  aria-label={`${t('articleList.forgetSearch')} : ${q}`}
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
            style={{ borderTop: '1px solid var(--panel-border)', background: 'var(--accent-glow)' }}
          >
            <svg className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <span className="text-[11px] flex-1 truncate" style={{ color: 'var(--accent)' }}>
              {searchQuery}
            </span>
            <button
              onClick={handleClearSearch}
              className="p-0.5 rounded transition-colors hover:bg-black/5"
              style={{ color: 'var(--accent)' }}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* List */}
      <div ref={listRef} className="flex-1 overflow-y-auto overflow-x-hidden nice-scroll relative">
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
        ) : bodyState === 'empty' || bodyState === 'empty-more' ? (
          <EmptyState
            filter={filter}
            searchQuery={searchQuery}
            awaitingPage={bodyState === 'empty-more'}
            loadMoreBusy={loadMoreBusy}
            onLoadMore={loadMore}
          />
        ) : gridLayout && !gridDateSeparators ? (
          /* Grid, default: one continuous gallery, no date bands. */
          <div className="article-grid">
            {articles.map(renderCard)}
          </div>
        ) : (
          /* La clé vient du groupe, jamais de sa position : `${label}-${index}`
             changeait la clé de toutes les bandes suivantes dès qu'une bande se
             vidait, et React remontait leurs sous-arbres entiers — les lignes
             remontées rejouant leur animation d'entrée (voir `DateGroup.key`). */
          groups.map((group) => (
            <div key={group.key}>
              {dateSepActive && (
                /* Ces bandeaux sont les seuls repères de progression d'un
                   scroll infini. Ils étaient à 10 px dans le gris le plus
                   clair de la palette : plus décoratifs qu'utiles. Le compte
                   du jour en fait un vrai repère. */
                <div
                  className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-widest sticky top-0 z-10 flex items-center gap-2"
                  style={{
                    color: 'var(--list-summary)',
                    background: 'var(--panel-header-bg)',
                    borderBottom: '1px solid var(--panel-border)',
                  }}
                >
                  <span className="truncate">{group.label}</span>
                  <span
                    className="tabular-nums font-normal"
                    style={{ color: 'var(--list-time)' }}
                  >
                    {group.articles.length}
                  </span>
                </div>
              )}
              {gridLayout ? (
                <div className="article-grid">
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
                        openArticleAtSource(article, selectArticle);
                      }}
                    />
                  );

                  if (!isDesktop) {
                    const isReadLater = article.labels?.includes(READ_LATER_LABEL);
                    return (
                      <SwipeableArticleRow
                        key={article.id}
                        onSwipeLeft={() => toggleRead(article)}
                        onSwipeRight={() => toggleReadLater(article)}
                        swipeLeftLabel={article.read ? t('swipe.unread') : t('swipe.read')}
                        swipeLeftColor={article.read ? '#3b82f6' : '#10b981'}
                        swipeRightLabel={isReadLater ? t('swipe.removeReadLater') : t('swipe.readLater')}
                        swipeRightColor="var(--readlater-color)"
                      >
                        {row}
                      </SwipeableArticleRow>
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

function ToolbarSep() {
  return <div className="w-px h-4 mx-0.5" style={{ background: 'var(--panel-border)' }} />;
}

interface ToolbarBtnProps {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  onClick?: () => void;
  active?: boolean;
  iconOnly?: boolean;
  flex1?: boolean;
}

function ToolbarBtn({ icon, label, shortcut, onClick, active, iconOnly, flex1 }: ToolbarBtnProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center gap-1 ${flex1 ? 'flex-1 py-2 [&_svg]:w-[19px] [&_svg]:h-[19px]' : iconOnly ? 'p-1.5' : 'px-2 py-1'} rounded-md text-[11px] transition-colors whitespace-nowrap ${
        active
          ? ''
          : 'hover:bg-black/5'
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
      {!iconOnly && <span>{label}</span>}
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
      className="sheet-row w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-black/5"
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
  /** Liste vide alors qu'une page reste promise — voir `listBodyState`. */
  awaitingPage: boolean;
  /** Le bouton « charger la suite » doit-il s'afficher occupé/inactif ?
   *  Vrai pendant le chargement ET pendant la revalidation d'arrière-plan
   *  d'une vue déjà peinte par le cache — voir `canLoadMore`. */
  loadMoreBusy: boolean;
  onLoadMore: () => void;
}

function EmptyState({ filter, searchQuery, awaitingPage, loadMoreBusy, onLoadMore }: EmptyStateProps) {
  const { t } = useTranslation();
  let icon: ReactNode;
  let title: string;
  let subtitle: string;

  if (awaitingPage) {
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

  const isSuccess = filter === 'unread' && !searchQuery && !awaitingPage;

  // Six états vides partagent un gabarit alors qu'ils ne disent pas la même
  // chose. « Tout est lu » est une réussite — le moment où l'application a fini
  // son travail — et « aucun résultat » est une impasse, qui doit proposer la
  // sortie. Un écran vide est une invitation à agir, pas un constat : celui-là
  // ne doit JAMAIS être une impasse (c'est ce qu'était le squelette sans fin).
  let action: { label: string; run: () => void; busy?: boolean } | null = null;
  if (awaitingPage) {
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
  onSelect: () => void;
  onToggleStar: (e: ReactMouseEvent) => void;
  onToggleRead: (e: ReactMouseEvent) => void;
  onToggleReadLater: (e: ReactMouseEvent) => void;
  onOpenSource: (e: ReactMouseEvent) => void;
}

/**
 * Exporté pour les tests (`ArticleRow.compact.test.tsx`) : la ligne compacte
 * est le mode le plus retouché des trois et n'était couverte par rien : l'ordre
 * des icônes, l'emplacement réservé et « le clic n'ouvre pas l'article » ne
 * tenaient qu'à travers la carte de la vue grille. `ArticleList` reste
 * l'unique consommateur applicatif.
 */
export function ArticleRow({ article, viewMode, showSource, rowActions, favicon, staggerIndex, active, onSelect, onToggleStar, onToggleRead, onToggleReadLater, onOpenSource }: ArticleRowProps) {
  const { t } = useTranslation();
  const isReadLater = article.labels?.includes(READ_LATER_LABEL);
  const thumbnail = viewMode === 'preview' ? extractImageFromContent(article.content) : null;
  // Décalage d'apparition. Le seuil et le droit d'animer sont décidés en
  // amont (`staggerIndexes`) : une ligne déjà rendue n'en reçoit pas, sans
  // quoi elle rejouerait l'animation d'entrée en clignotant dès qu'un retrait
  // la fait remonter.
  const stagger = staggerIndex !== undefined
    ? { 'data-stagger': '', style: { animationDelay: `${staggerIndex * 25}ms` } }
    : null;

  function handleDragStart(e: ReactDragEvent<HTMLDivElement>) {
    e.dataTransfer.setData('application/frirss-article', article.id);
    e.dataTransfer.effectAllowed = 'link';
    e.dataTransfer.setData('application/frirss-article-json', JSON.stringify(article));

    // Custom lightweight drag image
    const ghost = document.createElement('div');
    ghost.textContent = article.title;
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
    return (
      <div
        role="button"
        tabIndex={0}
        draggable
        onDragStart={handleDragStart}
        onClick={onSelect}
        onKeyDown={(e) => e.key === 'Enter' && onSelect()}
        className={`article-row w-full text-left flex items-center gap-3 px-4 py-2 cursor-pointer ${
          active ? 'article-row-active bg-[var(--list-selected)]' : 'hover:bg-[var(--list-hover)]'
        }`}
        {...(stagger ? { 'data-stagger': '' } : {})}
        data-article-id={article.id}
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
        {showSource && (
          <span
            className="font-medium uppercase flex-shrink-0"
            data-theme="list-source"
            style={{ color: 'var(--list-source)', minWidth: '80px', fontSize: 'var(--fs-list-source)' }}
          >
            {article.source}
          </span>
        )}
        <span
          dir="auto"
          className={`article-title truncate flex-1 ${article.read ? 'font-normal' : 'font-medium'}`}
          data-theme={article.read ? 'list-title-read' : 'list-title'}
          style={{ color: article.read ? 'var(--list-title-read)' : 'var(--list-title)', fontSize: 'var(--fs-list-title)' }}
        >
          {article.title}
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

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={handleDragStart}
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
          {article.title}
        </h3>

        {viewMode !== 'compact' && (
          <p dir="auto" className="line-clamp-2 leading-relaxed" data-theme="list-summary" style={{ color: 'var(--list-summary)', fontSize: 'var(--fs-list-summary)' }}>
            {article.summary}
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
      aria-label={active ? t('articleList.hideDateSep') : t('articleList.showDateSep')}
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
