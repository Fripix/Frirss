import { useEffect, useMemo, useState, useCallback, useRef, type ReactNode, type CSSProperties, type FormEvent, type MouseEvent as ReactMouseEvent, type DragEvent as ReactDragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useFeedStore, READ_LATER_LABEL, getSampleArticleUrl } from '../../stores/feedStore';
import { feedSiteUrl } from '../../lib/feedSiteUrl';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import { useThemeStore } from '../../stores/themeStore';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import client from '../../api/client';
import AddFeedDialog from './AddFeedDialog';
import type { Article, Subscription, Tag } from '../../types';
import { groupLabels } from '../../utils/labels';
import {
  savedCategories, isSavedCategory, READ_LATER_PREFIX, STARRED_PREFIX,
} from '../../lib/savedCategories';
import { getFavicon, setFavicon, blobToDataUrl } from '../../lib/faviconCache';
import { resolveVersionLabel } from '../../lib/version';

const SIDEBAR_FONT_MIN = 11;
const SIDEBAR_FONT_MAX = 18;

interface Category {
  id: string;
  label: string;
  feeds: Subscription[];
}

type DragItem =
  | { type: 'category'; id: string }
  | { type: 'feed'; id: string; catId: string };

export default function Sidebar() {
  const { t } = useTranslation();
  const {
    subscriptions,
    unreadCounts,
    selectedFeed,
    filter,
    selectView,
    selectCategory,
    refresh,
    labels,
    toggleStar,
    toggleReadLater,
    toggleArticleLabel,
    starredCount,
    readLaterCount,
    renameFeed,
    removeFeed,
  } = useFeedStore();
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const logout = useAuthStore((s) => s.logout);
  const {
    showFavicons,
    toggleFavicons,
    organizeMode,
    setOrganizeMode,
    categoryOrder,
    setCategoryOrder,
    feedOrder,
    setFeedOrder,
    hideReadFeeds,
    toggleHideReadFeeds,
  } = useUiStore();

  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';
  const setLayoutMode = useUiStore((s) => s.setLayoutMode);
  const appTitle = useUiStore((s) => s.appTitle);
  const appLogo = useUiStore((s) => s.appLogo);
  const logoMode = useUiStore((s) => s.logoMode);
  const theme = useThemeStore((s) => s.theme);
  const setFontSize = useThemeStore((s) => s.setFontSize);
  const sidebarFontSize = parseInt(theme.fontSizes['sidebar-feed']) || 13;

  const collapsedCategories = useUiStore((s) => s.collapsedCategories);
  const toggleCategoryCollapsed = useUiStore((s) => s.toggleCategoryCollapsed);
  const savedCollapsed = useUiStore((s) => s.savedCollapsed);
  const toggleSavedCollapsed = useUiStore((s) => s.toggleSavedCollapsed);
  const [refreshing, setRefreshing] = useState(false);
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [addFeedOpen, setAddFeedOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ feed: Subscription; x: number; y: number } | null>(null);

  const categories = useMemo(() => {
    const map: Record<string, Category> = {};
    subscriptions.forEach((sub) => {
      const catId = sub.categories?.[0]?.id || 'uncategorized';
      const catLabel = sub.categories?.[0]?.label || t('sidebar.uncategorized');
      if (!map[catId]) map[catId] = { id: catId, label: catLabel, feeds: [] };
      map[catId].feeds.push(sub);
    });

    const cats = Object.values(map);

    // Apply custom category order
    if (categoryOrder.length > 0) {
      cats.sort((a, b) => {
        const ai = categoryOrder.indexOf(a.id);
        const bi = categoryOrder.indexOf(b.id);
        if (ai === -1 && bi === -1) return a.label.localeCompare(b.label);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
    } else {
      cats.sort((a, b) => a.label.localeCompare(b.label));
    }

    // Apply custom feed order within each category
    cats.forEach((cat) => {
      const order = feedOrder[cat.id];
      if (order && order.length > 0) {
        cat.feeds.sort((a, b) => {
          const ai = order.indexOf(a.id);
          const bi = order.indexOf(b.id);
          if (ai === -1 && bi === -1) return a.title.localeCompare(b.title);
          if (ai === -1) return 1;
          if (bi === -1) return -1;
          return ai - bi;
        });
      }
    });

    return cats;
  }, [subscriptions, categoryOrder, feedOrder, t]);

  // When "hide read feeds" is on, drop feeds with no unread — and categories
  // left empty — but always keep the feed you're currently viewing. Disabled
  // in organize mode so every feed stays draggable.
  const displayCategories = useMemo(() => {
    if (!hideReadFeeds || organizeMode) return categories;
    const keepId = selectedFeed?.id;
    return categories
      .map((cat) => ({
        ...cat,
        feeds: cat.feeds.filter((f) => (unreadCounts[f.id] || 0) > 0 || f.id === keepId),
      }))
      .filter((cat) => cat.feeds.length > 0);
  }, [categories, hideReadFeeds, organizeMode, unreadCounts, selectedFeed]);

  const totalUnread = useMemo(() => {
    return Object.entries(unreadCounts).reduce((sum, [key, count]) => {
      if (subscriptions.some((s) => s.id === key)) return sum + count;
      return sum;
    }, 0);
  }, [unreadCounts, subscriptions]);

  function toggleCategory(catId: string) {
    toggleCategoryCollapsed(catId);
  }

  async function handleRefresh() {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  // Drag & drop for categories
  const handleCatDragStart = useCallback((e: ReactDragEvent, catId: string) => {
    setDragItem({ type: 'category', id: catId });
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleCatDragOver = useCallback((e: ReactDragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleCatDrop = useCallback(
    (e: ReactDragEvent, targetCatId: string) => {
      e.preventDefault();
      if (!dragItem || dragItem.type !== 'category') return;
      const ids = categories.map((c) => c.id);
      const fromIdx = ids.indexOf(dragItem.id);
      const toIdx = ids.indexOf(targetCatId);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
      const newOrder = [...ids];
      newOrder.splice(fromIdx, 1);
      newOrder.splice(toIdx, 0, dragItem.id);
      setCategoryOrder(newOrder);
      setDragItem(null);
    },
    [dragItem, categories, setCategoryOrder]
  );

  // Drag & drop for feeds within a category
  const handleFeedDragStart = useCallback((e: ReactDragEvent, feedId: string, catId: string) => {
    setDragItem({ type: 'feed', id: feedId, catId });
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleFeedDrop = useCallback(
    (e: ReactDragEvent, targetFeedId: string, catId: string) => {
      e.preventDefault();
      if (!dragItem || dragItem.type !== 'feed' || dragItem.catId !== catId) return;
      const cat = categories.find((c) => c.id === catId);
      if (!cat) return;
      const ids = cat.feeds.map((f) => f.id);
      const fromIdx = ids.indexOf(dragItem.id);
      const toIdx = ids.indexOf(targetFeedId);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
      const newOrder = [...ids];
      newOrder.splice(fromIdx, 1);
      newOrder.splice(toIdx, 0, dragItem.id);
      setFeedOrder(catId, newOrder);
      setDragItem(null);
    },
    [dragItem, categories, setFeedOrder]
  );

  const serverName = (() => {
    try {
      return new URL(serverUrl).hostname;
    } catch {
      return serverUrl;
    }
  })();

  return (
    <div className={`sidebar h-full flex flex-col ${isMobile ? 'sidebar-mobile' : ''}`} style={{ background: 'var(--sidebar-bg)' }}>
      {/* Header — gradient vert */}
      <div
        className="sidebar-header px-4 py-5 pb-4 flex-shrink-0"
        style={{ background: 'var(--sidebar-header-bg)' }}
      >
        <div className="flex items-center gap-2.5">
          {appLogo && logoMode === 'large' ? (
            /* Full mode: the custom logo replaces the title + server name */
            <img
              src={appLogo}
              alt={appTitle}
              className="h-8 flex-shrink-0 object-contain rounded"
              style={{ maxWidth: 'calc(100% - 80px)' }}
            />
          ) : (
            /* Compact mode (custom small logo) OR default: logo + title + server */
            <>
              <img
                src={appLogo || '/logo_frirss.png'}
                alt={appTitle}
                className={`w-9 h-9 rounded-lg flex-shrink-0 object-contain ${appLogo ? '' : 'bg-white p-0.5'}`}
              />
              <div className="min-w-0 flex-1">
                <h1
                  className="font-extrabold text-[17px] leading-tight truncate tracking-tight"
                  style={{
                    background: 'linear-gradient(180deg, #ffffff 0%, rgba(255,255,255,0.72) 100%)',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    color: 'transparent',
                    filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.18))',
                  }}
                >{appTitle}</h1>
                <p className="text-[11px] truncate text-white/70">
                  {serverName}
                </p>
              </div>
            </>
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className={`flex-shrink-0 ml-auto rounded transition-colors hover:bg-white/20 text-white/80 ${isMobile ? 'p-2' : 'p-1.5'}`}
            title={t('sidebar.refresh')}
          >
            <svg
              className={`${isMobile ? 'w-5 h-5' : 'w-4 h-4'} ${refreshing ? 'animate-spin' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button
            onClick={toggleSidebar}
            className={`flex-shrink-0 rounded transition-colors hover:bg-white/20 text-white/80 ${isMobile ? 'p-2' : 'p-1.5'}`}
            title={t('sidebar.hideSidebar') + (isMobile ? '' : ' (B)')}
          >
            {isMobile ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Toolbar — favicon toggle + organize (desktop-oriented controls
          hidden on mobile to declutter; only Add feed remains) */}
      <div className="px-3 py-2 flex items-center gap-1 flex-shrink-0" style={{ borderBottom: '1px solid var(--sidebar-divider)' }}>
        {/* Layout toggle (desktop / mobile) — only shown on touch tablets via CSS */}
        <div className="layout-toggle items-center gap-0.5 mr-1">
          <button
            onClick={() => setLayoutMode('desktop')}
            className="p-1.5 rounded transition-colors hover:bg-white/5"
            style={{ color: breakpoint === 'desktop' ? 'var(--accent)' : 'var(--sidebar-text)' }}
            title={t('sidebar.layoutDesktop')}
            aria-label={t('sidebar.layoutDesktop')}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
            </svg>
          </button>
          <button
            onClick={() => setLayoutMode('mobile')}
            className="p-1.5 rounded transition-colors hover:bg-white/5"
            style={{ color: breakpoint !== 'desktop' ? 'var(--accent)' : 'var(--sidebar-text)' }}
            title={t('sidebar.layoutMobile')}
            aria-label={t('sidebar.layoutMobile')}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
            </svg>
          </button>
        </div>
        <button
          onClick={toggleHideReadFeeds}
          className="p-1.5 rounded transition-colors hover:bg-white/5"
          style={{ color: hideReadFeeds ? 'var(--accent)' : 'var(--sidebar-text)' }}
          title={hideReadFeeds ? t('sidebar.showReadFeeds') : t('sidebar.hideReadFeeds')}
          aria-label={hideReadFeeds ? t('sidebar.showReadFeeds') : t('sidebar.hideReadFeeds')}
        >
          {hideReadFeeds ? (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          )}
        </button>
        {!isMobile && (
          <>
            <button
              onClick={toggleFavicons}
              className="p-1.5 rounded transition-colors hover:bg-white/5"
              style={{ color: showFavicons ? 'var(--accent)' : 'var(--sidebar-text)' }}
              title={showFavicons ? t('sidebar.hideFavicons') : t('sidebar.showFavicons')}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
              </svg>
            </button>
            <button
              onClick={() => setOrganizeMode(!organizeMode)}
              className="p-1.5 rounded transition-colors hover:bg-white/5"
              style={{ color: organizeMode ? 'var(--accent)' : 'var(--sidebar-text)' }}
              title={organizeMode ? t('sidebar.organizeEnd') : t('sidebar.organize')}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
              </svg>
            </button>

            {/* Sidebar font size control */}
            <div className="flex items-center gap-0 ml-1">
              <button
                onClick={() => { if (sidebarFontSize > SIDEBAR_FONT_MIN) setFontSize('sidebar-feed', String(sidebarFontSize - 1)); }}
                disabled={sidebarFontSize <= SIDEBAR_FONT_MIN}
                className="p-1 rounded transition-colors hover:bg-white/5 disabled:opacity-30"
                style={{ color: 'var(--sidebar-text)' }}
                title={t('sidebar.reduceText')}
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <text x="3" y="20" fontSize="18" fontWeight="bold" fill="currentColor" stroke="none">A</text>
                </svg>
              </button>
              <button
                onClick={() => { if (sidebarFontSize < SIDEBAR_FONT_MAX) setFontSize('sidebar-feed', String(sidebarFontSize + 1)); }}
                disabled={sidebarFontSize >= SIDEBAR_FONT_MAX}
                className="p-1 rounded transition-colors hover:bg-white/5 disabled:opacity-30"
                style={{ color: 'var(--sidebar-text)' }}
                title={t('sidebar.enlargeText')}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <text x="3" y="20" fontSize="22" fontWeight="bold" fill="currentColor" stroke="none">A</text>
                </svg>
              </button>
            </div>
          </>
        )}

        {isMobile && (
          <span className="text-xs font-semibold" style={{ color: 'var(--sidebar-text)' }}>
            {t('sidebar.addFeed')}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={() => setAddFeedOpen(true)}
          className={`rounded transition-colors hover:bg-white/5 ${isMobile ? 'p-2' : 'p-1.5'}`}
          style={{ color: 'var(--accent)' }}
          title={t('sidebar.addFeed')}
        >
          <svg className={isMobile ? 'w-5 h-5' : 'w-3.5 h-3.5'} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </button>
        {organizeMode && (
          <span className="text-[9px] ml-1 uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
            {t('sidebar.organizing')}
          </span>
        )}
      </div>

      {/* Filters */}
      <nav className="flex-1 overflow-y-auto sidebar-scroll py-2">
        <FilterItem
          icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-17.5 0V6.75A2.25 2.25 0 014.5 4.5h15A2.25 2.25 0 0121.75 6.75v6.75m-19.5 0v4.5A2.25 2.25 0 004.5 19.5h15a2.25 2.25 0 002.25-2.25v-4.5" />
            </svg>
          }
          label={t('sidebar.allFeeds')}
          active={filter === 'all' && !selectedFeed}
          count={totalUnread}
          onClick={() => selectView(null, 'all')}
        />
        <FilterItem
          icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          }
          label={t('sidebar.unread')}
          active={filter === 'unread' && !selectedFeed}
          count={totalUnread}
          onClick={() => selectView(null, 'unread')}
        />
        <FilterItem
          icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
            </svg>
          }
          label={t('sidebar.starred')}
          active={filter === 'starred' && !selectedFeed}
          badge={starredCount}
          badgeColor="var(--star-color)"
          onClick={() => selectView(null, 'starred')}
          onArticleDrop={(article) => {
            if (!article.starred) toggleStar(article);
          }}
          onToggleCollapse={() => toggleSavedCollapsed(STARRED_PREFIX)}
          collapsed={!!savedCollapsed[STARRED_PREFIX]}
          hasChildren={savedCategories(labels, STARRED_PREFIX).length > 0}
        />
        <SavedCategoryList prefix={STARRED_PREFIX} />
        <FilterItem
          icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
          label={t('sidebar.readLater')}
          active={filter === 'readlater' && !selectedFeed}
          badge={readLaterCount}
          badgeColor="var(--readlater-color)"
          onClick={() => selectView(null, 'readlater')}
          onArticleDrop={(article) => {
            if (!article.labels?.includes(READ_LATER_LABEL)) toggleReadLater(article);
          }}
          onToggleCollapse={() => toggleSavedCollapsed(READ_LATER_PREFIX)}
          collapsed={!!savedCollapsed[READ_LATER_PREFIX]}
          hasChildren={savedCategories(labels, READ_LATER_PREFIX).length > 0}
        />
        <SavedCategoryList prefix={READ_LATER_PREFIX} />

        {/* User labels section */}
        {labels.length > 0 && (
          <>
            <div className="h-px mx-3 my-3" style={{ background: 'var(--sidebar-divider)' }} />
            <LabelSection
              labels={labels}
              selectedFeed={selectedFeed}
              selectLabel={(label) => selectView(label)}
              onArticleDrop={(article, labelId) => {
                if (!article.labels?.includes(labelId)) {
                  toggleArticleLabel(article, labelId);
                }
              }}
            />
          </>
        )}

        <div className="h-px mx-3 my-3" style={{ background: 'var(--sidebar-divider)' }} />

        {/* Categories & feeds */}
        {displayCategories.map((cat) => {
          const catUnread = cat.feeds.reduce(
            (sum, f) => sum + (unreadCounts[f.id] || 0), 0
          );
          return (
            <div
              key={cat.id}
              className="mb-3"
              draggable={organizeMode}
              onDragStart={organizeMode ? (e) => handleCatDragStart(e, cat.id) : undefined}
              onDragOver={organizeMode ? handleCatDragOver : undefined}
              onDrop={organizeMode ? (e) => handleCatDrop(e, cat.id) : undefined}
            >
              <div
                className={`w-full flex items-center gap-2 px-4 py-1.5 text-[11px] font-bold tracking-widest uppercase transition-colors ${
                  organizeMode ? 'cursor-grab active:cursor-grabbing' : 'hover:bg-white/5'
                } ${selectedFeed?.id === cat.id ? 'sidebar-feed-active' : ''}`}
                data-theme={selectedFeed?.id === cat.id ? 'sidebar-text-active' : 'sidebar-category-text'}
                style={{
                  color: selectedFeed?.id === cat.id ? 'var(--sidebar-text-active)' : 'var(--sidebar-category-text)',
                  fontSize: 'var(--fs-sidebar-category)',
                }}
              >
                {organizeMode && (
                  <svg className="w-3 h-3 flex-shrink-0 opacity-50" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M7 2a2 2 0 10.001 4.001A2 2 0 007 2zm0 6a2 2 0 10.001 4.001A2 2 0 007 8zm0 6a2 2 0 10.001 4.001A2 2 0 007 14zm6-12a2 2 0 10.001 4.001A2 2 0 0013 2zm0 6a2 2 0 10.001 4.001A2 2 0 0013 8zm0 6a2 2 0 10.001 4.001A2 2 0 0013 14z" />
                  </svg>
                )}
                {/* Chevron: dedicated collapse/expand toggle. */}
                <button
                  onClick={(e) => { e.stopPropagation(); toggleCategory(cat.id); }}
                  className="flex-shrink-0 -my-1 py-1 hover:opacity-70 transition-opacity"
                  aria-label={collapsedCategories[cat.id] ? t('sidebar.expandCategory') : t('sidebar.collapseCategory')}
                  aria-expanded={!collapsedCategories[cat.id]}
                >
                  <svg
                    className={`w-3 h-3 transition-transform ${collapsedCategories[cat.id] ? '' : 'rotate-90'}`}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
                {/* Name: opens the aggregated "all articles in this category" view. */}
                <button
                  onClick={organizeMode ? undefined : () => selectCategory({ id: cat.id, label: cat.label })}
                  className="truncate flex-1 text-left uppercase tracking-widest"
                >
                  {cat.label}
                </button>
                {catUnread > 0 && (
                  <CategoryBadge count={catUnread} />
                )}
              </div>
              {!collapsedCategories[cat.id] &&
                cat.feeds.map((feed) => (
                  <FeedItem
                    key={feed.id}
                    feed={feed}
                    isSelected={selectedFeed?.id === feed.id}
                    unreadCount={unreadCounts[feed.id] || 0}
                    showFavicons={showFavicons}
                    organizeMode={organizeMode}
                    onSelect={() => selectView(feed)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ feed, x: e.clientX, y: e.clientY });
                    }}
                    onOpenMenu={(rect) => {
                      setContextMenu({ feed, x: rect.right, y: rect.top });
                    }}
                    onDragStart={(e) => { e.stopPropagation(); handleFeedDragStart(e, feed.id, cat.id); }}
                    onDragOver={(e) => { e.stopPropagation(); e.preventDefault(); }}
                    onDrop={(e) => { e.stopPropagation(); handleFeedDrop(e, feed.id, cat.id); }}
                  />
                ))}
            </div>
          );
        })}
      </nav>

      {/* App version. Dev/test builds show a beta label (e.g. "v1.3.4b3") in the
          accent colour so it's clear which test build is running. */}
      <div className="px-3 pb-1 flex-shrink-0 text-center select-none">
        <span
          className="text-[10px]"
          style={
            __APP_DEV_VERSION__
              ? { color: 'var(--accent)', opacity: 0.85 }
              : { color: 'var(--sidebar-text)', opacity: 0.45 }
          }
        >
          {resolveVersionLabel(__APP_DEV_VERSION__, __APP_VERSION__)}
        </span>
      </div>

      {/* Footer */}
      <div
        className="sidebar-bottom p-3 flex-shrink-0 flex items-center gap-1"
        style={{ borderTop: '1px solid var(--sidebar-divider)' }}
      >
        <button
          onClick={logout}
          className="text-[11px] transition-colors hover:text-white/60"
          style={{ color: 'var(--sidebar-text)' }}
        >
          {t('sidebar.disconnect')}
        </button>
        <div className="flex-1" />
        <a
          href="https://github.com/Fripix/frirss"
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded transition-all hover:bg-white/10 group"
          style={{ color: 'var(--sidebar-text)' }}
          title={t('sidebar.github')}
        >
          <svg className="w-3.5 h-3.5 opacity-40 group-hover:opacity-80 transition-opacity" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
          </svg>
        </a>
        <button
          onClick={() => useThemeStore.getState().openPreferences('branding')}
          className="p-1.5 rounded-md transition-colors hover:bg-white/10"
          style={{ color: 'var(--sidebar-text-active)' }}
          title={t('sidebar.preferences')}
        >
          <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>

      {addFeedOpen && <AddFeedDialog onClose={() => setAddFeedOpen(false)} />}
      {contextMenu && (
        <FeedContextMenu
          feed={contextMenu.feed}
          x={contextMenu.x}
          y={contextMenu.y}
          onRename={renameFeed}
          onDelete={removeFeed}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

interface FeedContextMenuProps {
  feed: Subscription;
  x: number;
  y: number;
  onRename: (feedId: string, title: string) => Promise<boolean>;
  onDelete: (feedId: string) => Promise<boolean>;
  onClose: () => void;
}

/**
 * Per-feed layout picker — same segmented look (and icons) as the toolbar's
 * layout toggle, so the two read as the same control. '' = follow the global
 * layout.
 */
function FeedLayoutPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const options = [
    {
      id: '',
      title: t('sidebar.feedLayoutDefault'),
      // Reset arrow — "go back to the global setting"
      path: 'M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3',
      single: true,
    },
    { id: '2', title: t('articleList.listOnly') },
    { id: '3', title: t('articleList.listAndReading') },
    { id: 'grid', title: t('articleList.gridLayout') },
  ];

  return (
    <div
      data-theme="list-active"
      className="flex items-center gap-0.5 rounded-md p-0.5 flex-shrink-0"
      style={{ background: 'var(--list-active)' }}
    >
      {options.map((opt) => (
        <button
          key={opt.id || 'default'}
          onClick={() => onChange(opt.id)}
          title={opt.title}
          aria-label={opt.title}
          aria-pressed={value === opt.id}
          className={`p-1 rounded transition-all ${
            value === opt.id
              ? 'bg-[var(--panel-bg)] shadow-sm text-[var(--accent)]'
              : 'text-[var(--list-summary)] hover:text-[var(--list-title)]'
          }`}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            {opt.single ? (
              <path strokeLinecap="round" strokeLinejoin="round" d={opt.path} />
            ) : opt.id === '2' ? (
              <>
                <rect x="3" y="4.5" width="18" height="15" rx="1.5" />
                <path strokeLinecap="round" d="M7 9h10M7 12h10M7 15h6" />
              </>
            ) : opt.id === '3' ? (
              <>
                <rect x="3" y="4.5" width="18" height="15" rx="1.5" />
                <line x1="11" y1="4.5" x2="11" y2="19.5" />
                <path strokeLinecap="round" d="M6 9h3M6 12h3M14 9h4M14 11.5h4M14 14h2.5" />
              </>
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75h6.5v6.5h-6.5v-6.5zm10 0h6.5v6.5h-6.5v-6.5zm-10 10h6.5v6.5h-6.5v-6.5zm10 0h6.5v6.5h-6.5v-6.5z" />
            )}
          </svg>
        </button>
      ))}
    </div>
  );
}

function FeedContextMenu({ feed, x, y, onRename, onDelete, onClose }: FeedContextMenuProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'rename' | 'confirmDelete' | null>(null);
  const [renameValue, setRenameValue] = useState(feed.title);
  const menuRef = useRef<HTMLDivElement>(null);
  const feedSettings = useUiStore((s) => s.feedSettings);
  const setFeedAutoExtract = useUiStore((s) => s.setFeedAutoExtract);
  const setFeedLayout = useUiStore((s) => s.setFeedLayout);
  const isAutoExtract = feedSettings[feed.id]?.autoExtract || false;
  const feedLayout = feedSettings[feed.id]?.layout || '';

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  // Position: keep menu in viewport
  const style: CSSProperties = {
    position: 'fixed', left: x, top: y, zIndex: 100,
    background: 'var(--panel-bg)', border: '1px solid var(--panel-border)',
    borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
    minWidth: '236px', overflow: 'hidden',
  };

  if (mode === 'rename') {
    return (
      <div ref={menuRef} style={style} className="p-3">
        <form onSubmit={async (e: FormEvent) => {
          e.preventDefault();
          if (renameValue.trim() && renameValue.trim() !== feed.title) {
            await onRename(feed.id, renameValue.trim());
          }
          onClose();
        }}>
          <label className="text-[10px] font-semibold uppercase tracking-wide mb-1.5 block" style={{ color: 'var(--list-summary)' }}>
            {t('sidebar.renameFeed')}
          </label>
          <input
            autoFocus
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            className="w-full text-sm px-2.5 py-1.5 rounded-lg border outline-none mb-2"
            style={{
              borderColor: 'var(--accent)', color: 'var(--list-title)',
              background: 'var(--panel-bg)',
            }}
            onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
          />
          <div className="flex gap-1.5 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-2.5 py-1 text-xs rounded-lg transition-colors hover:bg-black/5"
              style={{ color: 'var(--list-summary)' }}
            >
              {t('sidebar.cancel')}
            </button>
            <button
              type="submit"
              className="px-2.5 py-1 text-xs font-medium rounded-lg text-white"
              style={{ background: 'var(--accent)' }}
            >
              {t('sidebar.rename')}
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (mode === 'confirmDelete') {
    return (
      <div ref={menuRef} style={style} className="p-3">
        <p className="text-xs mb-3" style={{ color: 'var(--list-title)' }}>
          {t('sidebar.deleteFeedConfirm', { name: feed.title })}
        </p>
        <div className="flex gap-1.5 justify-end">
          <button
            onClick={onClose}
            className="px-2.5 py-1 text-xs rounded-lg transition-colors hover:bg-black/5"
            style={{ color: 'var(--list-summary)' }}
          >
            {t('sidebar.cancel')}
          </button>
          <button
            onClick={async () => { await onDelete(feed.id); onClose(); }}
            className="px-2.5 py-1 text-xs font-medium rounded-lg text-white"
            style={{ background: 'var(--danger)' }}
          >
            {t('sidebar.delete')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={menuRef} style={style} className="py-1">
      {/* Feed name header — anchors every item below to this feed. */}
      <div
        className="px-3 pt-1 pb-1.5 text-[11px] font-semibold truncate"
        style={{ color: 'var(--list-title)' }}
        title={feed.title}
      >
        {feed.title}
      </div>
      <div className="h-px mx-2 mb-1" style={{ background: 'var(--panel-border)' }} />
      <ContextMenuItem
        icon={
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
          </svg>
        }
        label={t('sidebar.rename')}
        onClick={() => setMode('rename')}
      />
      <ContextMenuItem
        icon={
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
        }
        label={t('sidebar.openSite')}
        onClick={() => {
          const url = feedSiteUrl(feed, getSampleArticleUrl(feed.id));
          if (url) window.open(url, '_blank');
          onClose();
        }}
      />
      <ContextMenuItem
        icon={
          <svg className="w-3.5 h-3.5" fill={isAutoExtract ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
        }
        label={isAutoExtract ? '✓ ' + t('sidebar.autoExtract') : t('sidebar.autoExtract')}
        onClick={() => {
          setFeedAutoExtract(feed.id, !isAutoExtract);
          onClose();
        }}
      />

      {/* Per-feed layout override — falls back to the global layout when empty */}
      <div className="h-px mx-2 my-1" style={{ background: 'var(--panel-border)' }} />
      <div className="px-3 py-2 flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium" style={{ color: 'var(--list-title)' }}>
          {t('sidebar.feedLayoutThisFeed')}
        </span>
        <FeedLayoutPicker
          value={feedLayout}
          onChange={(v) => {
            setFeedLayout(feed.id, v);
            onClose();
          }}
        />
      </div>

      <div className="h-px mx-2 my-1" style={{ background: 'var(--panel-border)' }} />
      <ContextMenuItem
        icon={
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
        }
        label={t('sidebar.unsubscribe')}
        danger
        onClick={() => setMode('confirmDelete')}
      />
    </div>
  );
}

interface ContextMenuItemProps {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}

function ContextMenuItem({ icon, label, onClick, danger }: ContextMenuItemProps) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors hover:bg-black/5"
      style={{ color: danger ? 'var(--danger)' : 'var(--list-title)' }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

interface FeedItemProps {
  feed: Subscription;
  isSelected: boolean;
  unreadCount: number;
  showFavicons: boolean;
  organizeMode: boolean;
  onSelect: () => void;
  onContextMenu: (e: ReactMouseEvent) => void;
  onOpenMenu: (rect: DOMRect) => void;
  onDragStart: (e: ReactDragEvent) => void;
  onDragOver: (e: ReactDragEvent) => void;
  onDrop: (e: ReactDragEvent) => void;
}

function FeedItem({ feed, isSelected, unreadCount, showFavicons, organizeMode, onSelect, onContextMenu, onOpenMenu, onDragStart, onDragOver, onDrop }: FeedItemProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedErrors = useFeedStore((s) => s.feedErrors);
  const hasError = !!feedErrors[feed.id];
  // Pulse this row when the last manual refresh brought new articles to it.
  const gotNew = useFeedStore((s) => (s.refreshResult?.newByFeed[feed.id] ?? 0) > 0);

  // Prefetch this feed's first page so opening it is instant (dedup'd in-store).
  const prefetch = () => { useFeedStore.getState().prefetchView(feed); };

  return (
    <button
      ref={btnRef}
      onClick={organizeMode ? undefined : onSelect}
      onPointerDown={organizeMode ? undefined : prefetch}
      onContextMenu={organizeMode ? undefined : onContextMenu}
      onMouseEnter={organizeMode ? undefined : () => { setHovered(true); hoverTimer.current = setTimeout(prefetch, 120); }}
      onMouseLeave={organizeMode ? undefined : () => { setHovered(false); if (hoverTimer.current) clearTimeout(hoverTimer.current); }}
      draggable={organizeMode}
      onDragStart={organizeMode ? onDragStart : undefined}
      onDragOver={organizeMode ? onDragOver : undefined}
      onDrop={organizeMode ? onDrop : undefined}
      className={`group w-full flex items-center gap-2 px-4 pl-7 py-1.5 sidebar-feed-item ${
        organizeMode
          ? 'cursor-grab active:cursor-grabbing'
          : isSelected
            ? 'sidebar-feed-active'
            : ''
      } ${gotNew ? 'feed-new-pulse' : ''}`}
      data-theme={isSelected ? 'sidebar-text-active' : 'sidebar-text'}
      style={{
        color: isSelected ? 'var(--sidebar-text-active)' : 'var(--sidebar-text)',
        fontSize: 'var(--fs-sidebar-feed)',
      }}
    >
      {organizeMode && (
        <svg className="w-2.5 h-2.5 flex-shrink-0 opacity-40" fill="currentColor" viewBox="0 0 20 20">
          <path d="M7 2a2 2 0 10.001 4.001A2 2 0 007 2zm0 6a2 2 0 10.001 4.001A2 2 0 007 8zm0 6a2 2 0 10.001 4.001A2 2 0 007 14zm6-12a2 2 0 10.001 4.001A2 2 0 0013 2zm0 6a2 2 0 10.001 4.001A2 2 0 0013 8zm0 6a2 2 0 10.001 4.001A2 2 0 0013 14z" />
        </svg>
      )}
      {showFavicons && (
        <span className="relative flex-shrink-0">
          <FeedFavicon iconUrl={feed.iconUrl} title={feed.title} />
          {hasError && (
            <span
              className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full"
              style={{ background: 'var(--danger, #ef4444)' }}
              title={t('sidebar.loadError')}
            />
          )}
        </span>
      )}
      {!showFavicons && hasError && (
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: 'var(--danger, #ef4444)' }}
          title={t('sidebar.loadError')}
        />
      )}
      <span className="truncate flex-1 text-left">
        {feed.title}
      </span>
      {/* Right side: fixed height container to avoid layout shift */}
      {!organizeMode && (
        <span className="flex-shrink-0 w-6 h-5 flex items-center justify-center relative">
          {hovered ? (
            <span
              className="absolute inset-0 flex items-center justify-center rounded-md sidebar-feed-edit-btn"
              style={{ background: 'rgba(255,255,255,0.1)' }}
              onClick={(e) => {
                e.stopPropagation();
                const rect = btnRef.current?.getBoundingClientRect();
                if (rect) onOpenMenu(rect);
              }}
              title={t('sidebar.editFeed')}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--sidebar-text-active)' }}>
                <circle cx="6" cy="12" r="1.5" />
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="18" cy="12" r="1.5" />
              </svg>
            </span>
          ) : (
            unreadCount > 0 && <UnreadBadge count={unreadCount} />
          )}
        </span>
      )}
    </button>
  );
}

/**
 * Categories filed under Favoris / À lire plus tard. They are prefixed labels,
 * so each row is a plain FilterItem — which already accepts an article drop,
 * making drag-to-file work with no extra machinery.
 */
function SavedCategoryList({ prefix }: { prefix: string }) {
  const labels = useFeedStore((s) => s.labels);
  const selectedFeed = useFeedStore((s) => s.selectedFeed);
  const selectView = useFeedStore((s) => s.selectView);
  const toggleArticleLabel = useFeedStore((s) => s.toggleArticleLabel);
  const collapsed = useUiStore((s) => s.savedCollapsed[prefix]);
  const cats = useMemo(() => savedCategories(labels, prefix), [labels, prefix]);

  if (collapsed || !cats.length) return null;
  return (
    <div className="ml-5">
      {cats.map((cat) => (
        <FilterItem
          key={cat.id}
          icon={
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
            </svg>
          }
          label={cat.name}
          active={selectedFeed?.id === cat.id}
          onClick={() => selectView({ id: cat.id, title: cat.name } as Subscription)}
          // Dropping an article files it here — FilterItem already handles it.
          onArticleDrop={(article) => { toggleArticleLabel(article, cat.id); }}
        />
      ))}
    </div>
  );
}

interface FilterItemProps {
  icon: ReactNode;
  label: string;
  active: boolean;
  count?: number;
  badge?: number;
  badgeColor?: string;
  onClick: () => void;
  onArticleDrop?: (article: Article) => void;
  /** Optional chevron to reveal the saved categories underneath. */
  onToggleCollapse?: () => void;
  collapsed?: boolean;
  hasChildren?: boolean;
}

function FilterItem({ icon, label, active, count, badge, badgeColor, onClick, onArticleDrop, onToggleCollapse, collapsed, hasChildren }: FilterItemProps) {
  const { t } = useTranslation();
  const [dragOver, setDragOver] = useState(false);

  function handleDragOver(e: ReactDragEvent) {
    if (!onArticleDrop) return;
    if (e.dataTransfer.types.includes('application/frirss-article')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'link';
      setDragOver(true);
    }
  }

  function handleDragLeave(e: ReactDragEvent) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  }

  function handleDrop(e: ReactDragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (!onArticleDrop) return;
    const json = e.dataTransfer.getData('application/frirss-article-json');
    if (json) {
      try {
        onArticleDrop(JSON.parse(json));
      } catch { /* ignore */ }
    }
  }

  return (
    <div
      className="relative flex items-center"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <button
        onClick={onClick}
        className={`flex-1 min-w-0 flex items-center gap-3 px-4 py-2 transition-all ${
          dragOver ? 'drop-highlight' : active ? 'bg-white/10' : 'hover:bg-white/5'
        }`}
        style={{
          color: dragOver ? '#fff' : active ? 'var(--sidebar-text-active)' : 'var(--sidebar-text)',
          background: dragOver ? 'var(--accent)' : undefined,
          borderRadius: '6px',
          margin: dragOver ? '2px 6px' : '0',
          boxShadow: dragOver ? '0 0 12px rgba(249,115,22,0.5)' : undefined,
          fontSize: 'var(--fs-sidebar-feed)',
        }}
      >
        {icon}
        <span className="flex-1 text-left font-medium truncate">{label}</span>
        {dragOver && (
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        )}
        {!dragOver && (count ?? 0) > 0 && <UnreadBadge count={count ?? 0} />}
        {!dragOver && !count && (badge ?? 0) > 0 && <SpecialBadge count={badge ?? 0} color={badgeColor} />}
      </button>
      {/* Chevron: reveals the saved categories, like the feed-category headers. */}
      {hasChildren && onToggleCollapse && !dragOver && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleCollapse(); }}
          className="flex-shrink-0 px-2 py-2 hover:opacity-70 transition-opacity"
          style={{ color: 'var(--sidebar-text)' }}
          aria-label={collapsed ? t('sidebar.expandCategory') : t('sidebar.collapseCategory')}
          aria-expanded={!collapsed}
        >
          <svg
            className={`w-3 h-3 transition-transform ${collapsed ? '' : 'rotate-90'}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}
    </div>
  );
}

function SpecialBadge({ count, color }: { count: number; color?: string }) {
  return (
    <span
      className="flex-shrink-0 min-w-[22px] h-[18px] px-1.5 flex items-center justify-center rounded-md text-[9px] font-bold tabular-nums"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
      }}
    >
      {count}
    </span>
  );
}

function UnreadBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span
      className="flex-shrink-0 min-w-[22px] h-[20px] px-[7px] flex items-center justify-center rounded-full text-[10px] font-bold tabular-nums"
      style={{
        color: 'var(--accent)',
        background: 'rgba(76, 212, 161, 0.15)',
      }}
    >
      {count}
    </span>
  );
}

function CategoryBadge({ count }: { count: number }) {
  return (
    <span
      className="flex-shrink-0 text-[10px] font-semibold tabular-nums opacity-50"
      style={{ color: 'var(--sidebar-text)' }}
    >
      {count}
    </span>
  );
}

interface LabelSectionProps {
  labels: Tag[];
  selectedFeed: Subscription | null;
  selectLabel: (label: { id: string; title: string }) => void;
  onArticleDrop: (article: Article, labelId: string) => void;
}

function LabelSection({ labels, selectedFeed, selectLabel, onArticleDrop }: LabelSectionProps) {
  const { t } = useTranslation();
  const collapsed = useUiStore((s) => s.labelsCollapsed);
  const setCollapsed = useUiStore((s) => s.setLabelsCollapsed);
  const collapsedGroups = useUiStore((s) => s.collapsedLabelGroups);
  const toggleLabelGroup = useUiStore((s) => s.toggleLabelGroup);
  const labelColors = useThemeStore((s) => s.labelColors);
  const openPreferences = useThemeStore((s) => s.openPreferences);
  const labelOrder = useUiStore((s) => s.labelOrder);
  const labelSortAlpha = useUiStore((s) => s.labelSortAlpha);
  const showLabelCounts = useUiStore((s) => s.showLabelCounts);
  const labelCounts = useFeedStore((s) => s.labelCounts);

  // Resolve the effective color for a label (own color > inherited parent color > null)
  const resolveLabelColor = useCallback((labelId: string): string | null => {
    // Own color?
    if (labelColors[labelId]?.color) return labelColors[labelId].color;
    // Check parent
    const labelName = labelId.split('/label/').pop();
    if (!labelName) return null;
    const slashIdx = labelName.indexOf('/');
    if (slashIdx > 0) {
      const parentName = labelName.substring(0, slashIdx);
      const parentId = labelId.split('/label/')[0] + '/label/' + parentName;
      const parentEntry = labelColors[parentId];
      if (parentEntry?.color && parentEntry.inherit !== false) {
        return parentEntry.color;
      }
    }
    return null;
  }, [labelColors]);

  const items = useMemo(
    // Saved categories live under Favoris / À lire plus tard — showing them
    // here too would be the main source of confusion in this design.
    () => groupLabels(labels.filter((t) => !isSavedCategory(t.id)), labelOrder, labelSortAlpha),
    [labels, labelOrder, labelSortAlpha]
  );

  function toggleGroup(name: string) {
    toggleLabelGroup(name);
  }

  // Separate standalone labels from groups for rendering
  const standaloneLabels = items.filter((i) => i.type === 'single');
  const groups = items.filter((i) => i.type !== 'single');

  return (
    <div className="mb-1">
      {/* Section header: "ÉTIQUETTES" — same style as feed category headers */}
      <div className="flex items-center">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex-1 flex items-center gap-2 px-4 py-1.5 text-[11px] font-bold tracking-widest uppercase transition-colors hover:bg-white/5"
          data-theme="sidebar-category-text"
          style={{ color: 'var(--sidebar-category-text)', fontSize: 'var(--fs-sidebar-category)' }}
        >
          <svg
            className={`w-3 h-3 transition-transform flex-shrink-0 ${collapsed ? '' : 'rotate-90'}`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
              clipRule="evenodd"
            />
          </svg>
          <span className="truncate flex-1 text-left">{t('sidebar.labels')}</span>
        </button>
        <button
          onClick={() => openPreferences('labels')}
          className="p-1.5 mr-2 rounded transition-colors hover:bg-white/10"
          style={{ color: 'var(--sidebar-text)' }}
          title={t('sidebar.manageLabels')}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.204-.107-.397.165-.71.505-.78.929l-.15.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.108-1.204l-.526-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>

      {!collapsed && (
        <>
          {/* Standalone labels — shown like feed items with tag icon */}
          {standaloneLabels.map((item) => (
            <LabelDropItem
              key={item.tag!.id}
              labelId={item.tag!.id}
              name={item.name}
              isSelected={selectedFeed?.id === item.tag!.id}
              onClick={() => selectLabel({ id: item.tag!.id, title: item.name })}
              onArticleDrop={onArticleDrop}
              labelColor={resolveLabelColor(item.tag!.id)}
              count={showLabelCounts ? labelCounts[item.tag!.id] : undefined}
            />
          ))}

          {/* Label groups — sub-section style distinct from main "ÉTIQUETTES" header */}
          {groups.map((item) => {
            const isGroupCollapsed = collapsedGroups[item.name];
            const hasParentTag = item.type === 'parent';
            const isParentSelected = hasParentTag && selectedFeed?.id === item.tag?.id;
            const parentLabelColor = hasParentTag && item.tag ? resolveLabelColor(item.tag.id) : null;

            return (
              <div key={item.name} className="mb-1">
                <LabelGroupHeader
                  name={item.name}
                  count={!showLabelCounts ? undefined
                    : hasParentTag && item.tag ? labelCounts[item.tag.id]
                    : (item.children ?? []).reduce((s, c) => s + (labelCounts[c.tag.id] ?? 0), 0)}
                  isCollapsed={!!isGroupCollapsed}
                  isSelected={!!isParentSelected}
                  hasParentTag={hasParentTag}
                  onToggle={() => toggleGroup(item.name)}
                  onViewArticles={hasParentTag && item.tag
                    ? () => selectLabel({ id: item.tag!.id, title: item.name })
                    : undefined
                  }
                  labelColor={parentLabelColor}
                />

                {/* Child labels — indented under parent */}
                {!isGroupCollapsed && (item.children ?? []).map(({ tag, leafName, fullName }) => (
                  <LabelDropItem
                    key={tag.id}
                    labelId={tag.id}
                    name={leafName}
                    isSelected={selectedFeed?.id === tag.id}
                    onClick={() => selectLabel({ id: tag.id, title: fullName })}
                    onArticleDrop={onArticleDrop}
                    labelColor={resolveLabelColor(tag.id)}
                    count={showLabelCounts ? labelCounts[tag.id] : undefined}
                    isChild
                  />
                ))}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

interface LabelGroupHeaderProps {
  name: string;
  count?: number;
  isCollapsed: boolean;
  isSelected: boolean;
  hasParentTag: boolean;
  onToggle: () => void;
  onViewArticles?: () => void;
  labelColor: string | null;
}

function LabelGroupHeader({ name, count, isCollapsed, isSelected, hasParentTag, onToggle, onViewArticles, labelColor }: LabelGroupHeaderProps) {
  const { t } = useTranslation();
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleClick() {
    if (hasParentTag) {
      // Single click → view articles (delayed to distinguish from double-click)
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null;
        onViewArticles?.();
      }, 250);
    } else {
      // No parent label → single click just toggles
      onToggle();
    }
  }

  function handleDoubleClick() {
    // Cancel the pending single-click action
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    onToggle();
  }

  const iconColor = labelColor || 'var(--accent)';

  return (
    <button
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className={`w-full flex items-center gap-1 px-4 py-1.5 transition-colors sidebar-feed-item ${
        isSelected ? 'sidebar-feed-active' : ''
      }`}
      style={{
        color: isSelected ? 'var(--sidebar-text-active)' : 'var(--sidebar-text)',
        fontSize: 'var(--fs-sidebar-feed)',
      }}
    >
      {/* Chevron — clickable independently to toggle collapse */}
      <span
        className="flex-shrink-0 p-0.5 rounded hover:bg-white/10 transition-colors cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        title={isCollapsed ? t('sidebar.expand') : t('sidebar.collapse')}
      >
        <svg
          className={`w-3 h-3 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
          fill="currentColor"
          viewBox="0 0 20 20"
          style={{ opacity: 0.4 }}
        >
          <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
        </svg>
      </span>
      {/* Tag icon — uses label color */}
      <LabelTagIcon
        className="w-3.5 h-3.5"
        style={{ color: iconColor, opacity: 0.6 }}
      />
      {/* Name */}
      <span className="truncate flex-1 text-left font-semibold">{name}</span>
      {count !== undefined && <CategoryBadge count={count} />}
    </button>
  );
}

function LabelTagIcon({ className = 'w-3.5 h-3.5', style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg
      className={`${className} flex-shrink-0`}
      style={style || { color: 'var(--sidebar-text)', opacity: 0.45 }}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
    </svg>
  );
}

interface LabelDropItemProps {
  labelId: string;
  name: string;
  isSelected: boolean;
  onClick: () => void;
  onArticleDrop: (article: Article, labelId: string) => void;
  isParentEntry?: boolean;
  labelColor: string | null;
  isChild?: boolean;
  count?: number;
}

function LabelDropItem({ labelId, name, isSelected, onClick, onArticleDrop, isParentEntry, labelColor, isChild, count }: LabelDropItemProps) {
  const [dragOver, setDragOver] = useState(false);

  function handleDragOver(e: ReactDragEvent) {
    if (e.dataTransfer.types.includes('application/frirss-article')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'link';
      setDragOver(true);
    }
  }

  function handleDragLeave(e: ReactDragEvent) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  }

  function handleDrop(e: ReactDragEvent) {
    e.preventDefault();
    setDragOver(false);
    const json = e.dataTransfer.getData('application/frirss-article-json');
    if (json && onArticleDrop) {
      try {
        onArticleDrop(JSON.parse(json), labelId);
      } catch { /* ignore */ }
    }
  }

  const iconColor = labelColor || 'var(--sidebar-text)';

  return (
    <button
      onClick={onClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`w-full flex items-center gap-2 px-4 py-1.5 sidebar-feed-item ${
        isChild ? 'pl-10' : 'pl-7'
      } ${dragOver ? '' : isSelected ? 'sidebar-feed-active' : ''}`}
      style={{
        color: dragOver ? '#fff' : isSelected ? 'var(--sidebar-text-active)' : 'var(--sidebar-text)',
        background: dragOver ? 'var(--accent)' : undefined,
        borderRadius: dragOver ? '6px' : undefined,
        margin: dragOver ? '2px 6px' : '0',
        boxShadow: dragOver ? '0 0 12px rgba(249,115,22,0.5)' : undefined,
        fontSize: 'var(--fs-sidebar-feed)',
        fontStyle: isParentEntry ? 'italic' : undefined,
        opacity: isParentEntry ? 0.7 : undefined,
      }}
    >
      <LabelTagIcon
        style={dragOver
          ? { color: '#fff', opacity: 1 }
          : isParentEntry
            ? { color: labelColor || 'var(--accent)', opacity: 0.5 }
            : { color: iconColor, opacity: labelColor ? 0.7 : 0.45 }
        }
      />
      <span className="truncate flex-1 text-left">{name}</span>
      {!dragOver && count !== undefined && <CategoryBadge count={count} />}
      {dragOver && (
        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
      )}
    </button>
  );
}

function getLetterAvatarColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 50%, 42%)`;
}

function LetterAvatar({ title }: { title?: string }) {
  const letter = (title || '?')[0].toUpperCase();
  const color = getLetterAvatarColor(title || '');
  return (
    <div
      className="w-3.5 h-3.5 rounded flex-shrink-0 flex items-center justify-center text-[7px] font-bold leading-none text-white"
      style={{ background: color }}
    >
      {letter}
    </div>
  );
}

function FeedFavicon({ iconUrl, title }: { iconUrl?: string; title?: string }) {
  // Seed synchronously from the persistent cache → the icon paints on the
  // first frame after a reload, with no flash and no re-fetch.
  const [src, setSrc] = useState<string | null>(() => getFavicon(iconUrl));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!iconUrl) {
      setFailed(true);
      return;
    }

    // Already resolved (this session or a previous one).
    const cached = getFavicon(iconUrl);
    if (cached) {
      setSrc(cached);
      setFailed(false);
      return;
    }

    let cancelled = false;

    // Strategy 1: fetch through the authenticated client (proxy + auth), then
    // persist as a data URL so it survives reloads.
    client
      .get<Blob>(iconUrl, { responseType: 'blob' })
      .then(async (response) => {
        // Check that we got an image (not an HTML error page)
        if (response.data.type && response.data.type.startsWith('image')) {
          const dataUrl = await blobToDataUrl(response.data);
          if (cancelled) return;
          setFavicon(iconUrl, dataUrl);
          setSrc(dataUrl);
        } else {
          throw new Error('Not an image');
        }
      })
      .catch(() => {
        if (cancelled) return;
        // Strategy 2: load the image directly (works if the server allows
        // unauthenticated access); the plain URL is cacheable as-is.
        const img = new Image();
        img.onload = () => {
          if (cancelled) return;
          setFavicon(iconUrl, iconUrl);
          setSrc(iconUrl);
        };
        img.onerror = () => {
          if (cancelled) return;
          console.warn('[FriRSS] Favicon failed to load:', iconUrl);
          setFailed(true);
        };
        img.src = iconUrl;
      });

    return () => { cancelled = true; };
  }, [iconUrl]);

  if (failed || !iconUrl) {
    return <LetterAvatar title={title} />;
  }

  if (!src) {
    return <LetterAvatar title={title} />;
  }

  return (
    <img
      src={src}
      alt=""
      className="w-3.5 h-3.5 rounded flex-shrink-0"
      onError={() => setFailed(true)}
    />
  );
}
