import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type FormEvent, type MouseEvent as ReactMouseEvent, type DragEvent as ReactDragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useFeedStore, READ_LATER_LABEL, isCategoryStreamId } from '../../stores/feedStore';
import { useUiStore } from '../../stores/uiStore';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { groupByDate } from '../../utils/dates';
import { markAllReadAction } from '../../lib/markAllRead';
import { effectiveLayout } from '../../lib/effectiveLayout';
import { extractImageFromContent } from '../../lib/articleThumbnail';
import { timeAgo } from '../../lib/timeAgo';
import ViewModeSwitcher from './ViewModeSwitcher';
import SwipeableArticleRow from './SwipeableArticleRow';
import { StarButton, ReadLaterButton, MarkReadButton } from './ArticleActions';
import ArticleCard from './ArticleCard';
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
      active={selectedArticle?.id === article.id}
      onSelect={() => selectArticle(article)}
      onToggleStar={(e) => { e.stopPropagation(); toggleStar(article); }}
      onToggleRead={(e) => { e.stopPropagation(); toggleRead(article); }}
      onToggleReadLater={(e) => { e.stopPropagation(); toggleReadLater(article); }}
    />
  );

  const listRef = useRef<HTMLDivElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
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

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    listScrollMem.set(scrollKeyRef.current, el.scrollTop);
    if (!continuation || loadingMore) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 300) {
      loadMore();
    }
  }, [continuation, loadingMore, loadMore]);

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

  // Focus search input when opened
  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchOpen]);

  // Handle data-search-input for keyboard shortcut
  useEffect(() => {
    const handler = () => {
      setSearchOpen(true);
    };
    const el = document.querySelector('[data-search-input]');
    if (el) el.addEventListener('focus', handler);
  }, []);

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (searchValue.trim()) {
      search(searchValue.trim());
    }
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
    markAllAsRead();
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
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
                </svg>
              </button>
            )}
            <h2 className="text-sm font-bold truncate min-w-0 mr-1" style={{ color: 'var(--list-title)' }}>
              {searchQuery ? `${t('articleList.search')} : ${searchQuery}` : title}
            </h2>
            <div className="flex-1 flex items-center">
              <ToolbarBtn flex1 iconOnly icon={<SearchIcon />} label={t('articleList.search')} onClick={() => setSearchOpen(true)} />
              <ToolbarBtn flex1 iconOnly icon={<MarkUnreadIcon />} label={t('articleList.unread')} active={filter === 'unread'}
                onClick={() => useFeedStore.getState().setUnreadFilter(filter !== 'unread')} />
              <ToolbarBtn flex1 iconOnly icon={<StarIcon filled={filter === 'starred'} />} label={t('articleList.starred')} active={filter === 'starred'}
                onClick={() => useFeedStore.getState().setFilter(filter === 'starred' ? 'all' : 'starred')} />
              <ToolbarBtn flex1 iconOnly icon={<MarkAllReadIcon />} label={markAllConfirm ? t('articleList.confirm') : t('articleList.markAllRead')}
                active={markAllConfirm} onClick={handleMarkAllRead} />
              <ToolbarBtn flex1 iconOnly icon={<OptionsIcon />} label={t('articleList.viewOptions')} active={optionsOpen}
                onClick={() => setOptionsOpen((o) => !o)} />
            </div>

            {optionsOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setOptionsOpen(false)} />
                <div
                  className="absolute right-1 top-full mt-1 z-30 rounded-xl overflow-hidden shadow-xl py-1 min-w-[224px]"
                  style={{ background: 'var(--panel-bg)', border: '1px solid var(--panel-border)' }}
                >
                  <SheetRow icon={<SourceGlyph />} label={t('articleList.feedSource')} active={showSource}
                    onClick={isInFeed ? toggleShowSourceInFeed : toggleShowSourceInAll} />
                  <SheetRow icon={<DateGlyph />} label={t('articleList.dateSeparators')} active={dateSepActive}
                    onClick={toggleDateSep} />
                  <SheetRow icon={<TopbarGlyph on={topbarVisible} />} label={t('articleList.serverBar')} active={topbarVisible}
                    onClick={toggleTopbar} />

                  <SheetDivider />

                  {!gridLayout && (
                    <div className="px-3 py-2 flex items-center justify-between gap-2">
                      <span className="text-[13px] font-medium" style={{ color: 'var(--list-title)' }}>{t('articleList.displayMode')}</span>
                      <ViewModeSwitcher />
                    </div>
                  )}
                </div>
              </>
            )}
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
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
                </svg>
              </button>
            )}

            <h2 className="text-sm font-bold truncate min-w-0" style={{ color: 'var(--list-title)' }}>
              {searchQuery ? `${t('articleList.search')} : ${searchQuery}` : title}
            </h2>

            <div className="w-px h-4 mx-1 flex-shrink-0" style={{ background: 'var(--panel-border)' }} />

            {/* Inline toolbar actions */}
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <ToolbarBtn icon={<SearchIcon />} label={t('articleList.search')} shortcut="F" onClick={() => setSearchOpen(true)} />
              <ToolbarBtn icon={<MarkUnreadIcon />} label={t('articleList.unread')} active={filter === 'unread'}
                onClick={() => useFeedStore.getState().setUnreadFilter(filter !== 'unread')} />
              <ToolbarBtn icon={<StarIcon filled={filter === 'starred'} />} label={t('articleList.starred')} active={filter === 'starred'}
                onClick={() => useFeedStore.getState().setFilter(filter === 'starred' ? 'all' : 'starred')} />
              <ToolbarSep />
              <ToolbarBtn icon={<MarkAllReadIcon />} label={markAllConfirm ? t('articleList.confirm') : t('articleList.markAllRead')}
                active={markAllConfirm} onClick={handleMarkAllRead} />
            </div>

            <div className="flex-1" />

            <div className="flex items-center gap-1 flex-shrink-0">
              <SourceToggle
                active={showSource}
                onClick={isInFeed ? toggleShowSourceInFeed : toggleShowSourceInAll}
                tooltip={isInFeed ? t('articleList.sourceToggleFeed') : t('articleList.sourceToggleAll')}
              />
              <DateSepToggle active={dateSepActive} onClick={toggleDateSep} />
              <TopbarToggle />
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
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
                  </svg>
                </button>
              )}

              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-bold truncate" style={{ color: 'var(--list-title)' }}>
                  {searchQuery ? `${t('articleList.search')} : ${searchQuery}` : title}
                </h2>
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                <SourceToggle
                  active={showSource}
                  onClick={isInFeed ? toggleShowSourceInFeed : toggleShowSourceInAll}
                  tooltip={isInFeed ? t('articleList.sourceToggleFeed') : t('articleList.sourceToggleAll')}
                />
                <DateSepToggle active={showDateSeparators} onClick={toggleDateSeparators} />
                <TopbarToggle />
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
              <ToolbarSep />
              <ToolbarBtn icon={<MarkAllReadIcon />} label={markAllConfirm ? t('articleList.confirm') : t('articleList.markAllRead')}
                active={markAllConfirm} onClick={handleMarkAllRead} />
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
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </form>
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
        {loading ? (
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
        ) : articles.length === 0 ? (
          <EmptyState filter={filter} searchQuery={searchQuery} />
        ) : gridLayout && !gridDateSeparators ? (
          /* Grid, default: one continuous gallery, no date bands. */
          <div className="article-grid">
            {articles.map(renderCard)}
          </div>
        ) : (
          groups.map((group, groupIdx) => (
            <div key={`${group.label}-${groupIdx}`}>
              {dateSepActive && (
                <div
                  className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest sticky top-0 z-10"
                  style={{
                    color: 'var(--list-time)',
                    background: 'var(--panel-header-bg)',
                    borderBottom: '1px solid var(--panel-border)',
                  }}
                >
                  {group.label}
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
                      active={selectedArticle?.id === article.id}
                      onSelect={() => selectArticle(article)}
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
          ? 'text-white'
          : 'hover:bg-black/5'
      }`}
      style={{
        color: active ? '#fff' : 'var(--list-summary)',
        background: active ? 'var(--accent)' : undefined,
      }}
      title={shortcut ? `${label} (${shortcut})` : label}
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
      className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-black/5"
      style={{ color: active ? 'var(--accent)' : 'var(--list-title)' }}
    >
      <span className="flex-shrink-0">{icon}</span>
      <span className="flex-1 text-[13px] font-medium">{label}</span>
      {active && (
        <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}
    </button>
  );
}

/* ── Empty state ────────────────────────────────────────────────── */

function EmptyState({ filter, searchQuery }: { filter: Filter; searchQuery: string }) {
  const { t } = useTranslation();
  let icon: ReactNode;
  let title: string;
  let subtitle: string;

  if (searchQuery) {
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

  const isSuccess = filter === 'unread';

  return (
    <div className="p-12 text-center flex flex-col items-center gap-3">
      <div
        className="w-14 h-14 rounded-full flex items-center justify-center"
        style={{
          background: isSuccess ? 'var(--accent-glow)' : 'color-mix(in srgb, var(--panel-border) 40%, transparent)',
          color: isSuccess ? 'var(--accent)' : 'var(--list-summary)',
        }}
      >
        {icon}
      </div>
      <p className="text-sm font-medium" style={{ color: 'var(--list-title)' }}>{title}</p>
      <p className="text-xs" style={{ color: 'var(--list-summary)' }}>{subtitle}</p>
    </div>
  );
}

/* ── Article row ─────────────────────────────────────────────────── */

interface ArticleRowProps {
  article: Article;
  viewMode: string;
  showSource: boolean;
  active: boolean;
  onSelect: () => void;
  onToggleStar: (e: ReactMouseEvent) => void;
  onToggleRead: (e: ReactMouseEvent) => void;
  onToggleReadLater: (e: ReactMouseEvent) => void;
}

function ArticleRow({ article, viewMode, showSource, active, onSelect, onToggleStar, onToggleRead, onToggleReadLater }: ArticleRowProps) {
  const { t } = useTranslation();
  const isReadLater = article.labels?.includes(READ_LATER_LABEL);
  const thumbnail = viewMode === 'preview' ? extractImageFromContent(article.content) : null;

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
      background: 'rgba(249,115,22,0.85)', color: '#fff',
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
        style={{ borderBottom: '1px solid var(--panel-border)' }}
      >
        {/* Always reserve space for the unread dot to avoid alignment shift */}
        <div
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: article.read ? 'transparent' : 'var(--list-unread-bar)' }}
        />
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
          className={`truncate flex-1 ${article.read ? 'font-normal' : 'font-medium'}`}
          data-theme={article.read ? 'list-title-read' : 'list-title'}
          style={{ color: article.read ? 'var(--list-title-read)' : 'var(--list-title)', fontSize: 'var(--fs-list-title)' }}
        >
          {article.title}
        </span>
        <span className="text-[10px] flex-shrink-0" data-theme="list-time" style={{ color: 'var(--list-time)' }}>
          {timeAgo(article.published, t)}
        </span>
        <ReadLaterButton active={isReadLater} onClick={onToggleReadLater} article={article} />
        <StarButton starred={article.starred} onClick={onToggleStar} article={article} />
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
      className={`article-row w-full text-left flex gap-3 px-4 py-3 cursor-pointer ${
        active ? 'article-row-active bg-[var(--list-selected)]' : 'hover:bg-[var(--list-hover)]'
      }`}
      style={{ borderBottom: '1px solid var(--panel-border)' }}
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
          className={`leading-snug mb-1 ${article.read ? 'font-normal' : 'font-semibold'}`}
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

      <div className="flex flex-col items-center gap-1 flex-shrink-0 pt-0.5">
        <StarButton starred={article.starred} onClick={onToggleStar} article={article} />
        <ReadLaterButton active={isReadLater} onClick={onToggleReadLater} article={article} />
        <MarkReadButton read={article.read} onClick={onToggleRead} />
      </div>
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
      className={`p-1 rounded transition-all ${
        active
          ? 'text-[var(--accent)]'
          : 'text-[var(--list-summary)] hover:text-[var(--list-title)]'
      }`}
      style={{
        background: active ? 'var(--accent-glow)' : undefined,
      }}
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
      className={`p-1 rounded transition-all ${
        topbarVisible
          ? 'text-[var(--accent)]'
          : 'text-[var(--list-summary)] hover:text-[var(--list-title)]'
      }`}
      style={{
        background: topbarVisible ? 'var(--accent-glow)' : undefined,
      }}
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
      className={`p-1 rounded transition-all ${
        active
          ? 'text-[var(--accent)]'
          : 'text-[var(--list-summary)] hover:text-[var(--list-title)]'
      }`}
      style={{
        background: active ? 'var(--accent-glow)' : undefined,
      }}
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
