import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuthStore } from './stores/authStore';
import { getMe, getAuthStatus } from './api/backend';
import { useFeedStore } from './stores/feedStore';
import { useThemeStore } from './stores/themeStore';
import { useUiStore } from './stores/uiStore';
import { useKeyboardNav } from './hooks/useKeyboardNav';
import { useBreakpoint } from './hooks/useBreakpoint';
import { hydrateExtractCache } from './lib/extractCache';
import { hydratePrefs, stopSync } from './lib/prefsSync';
import { saveLastView, loadLastView } from './lib/lastView';
import Login from './components/Login/Login';
import LoginTransition from './components/Login/LoginTransition';
import Sidebar from './components/Sidebar/Sidebar';
import ArticleList from './components/ArticleList/ArticleList';
import ReadingPane from './components/ReadingPane/ReadingPane';
import ResizeHandle from './components/ResizeHandle';
import ServerSwitcher from './components/ServerSwitcher/ServerSwitcher';
import ShortcutBar from './components/ShortcutBar';
import OfflineBanner from './components/OfflineBanner';
import MobileDrawer from './components/MobileDrawer';
import MobileStack from './components/MobileStack';

// Preferences is a heavy, rarely-opened panel → load it on demand
const Preferences = lazy(() => import('./components/Preferences/Preferences'));

const MIN_SIDEBAR = 160;
const MAX_SIDEBAR = 350;
// Min width of the article-list column — kept ≥ the toolbar (search + Non lus
// + Favoris + Tout lu) so its controls never wrap or get clipped.
const MIN_LIST = 340;

export default function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const backendToken = useAuthStore((s) => s.backendToken);
  const setBackendAuth = useAuthStore((s) => s.setBackendAuth);
  const activeServerId = useAuthStore((s) => s.activeServerId);
  const loadArticles = useFeedStore((s) => s.loadArticles);
  const loadSubscriptions = useFeedStore((s) => s.loadSubscriptions);
  const resetAndReload = useFeedStore((s) => s.resetAndReload);
  const selectedArticle = useFeedStore((s) => s.selectedArticle);
  const selectedFeedId = useFeedStore((s) => s.selectedFeed?.id);
  const filter = useFeedStore((s) => s.filter);
  const preferencesOpen = useThemeStore((s) => s.preferencesOpen);
  const panelLayout = useUiStore((s) => s.panelLayout);
  const sidebarVisible = useUiStore((s) => s.sidebarVisible);
  const readingFocus = useUiStore((s) => s.readingFocus);
  const setSidebarVisible = useUiStore((s) => s.setSidebarVisible);
  const topbarVisible = useUiStore((s) => s.topbarVisible);

  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';
  const isTablet = breakpoint === 'tablet';
  const isDesktop = breakpoint === 'desktop';
  const containerRef = useRef<HTMLDivElement>(null);

  // Expose the effective layout to CSS (responsive rules key off this instead
  // of raw width, so a forced layout styles correctly). On <html> so portals
  // rendered to <body> are covered too.
  useEffect(() => {
    document.documentElement.dataset.layout = breakpoint;
  }, [breakpoint]);

  // Persistent extract cache: evict content older than the retention window
  // and warm the in-memory tier from IndexedDB so reads are instant.
  useEffect(() => {
    hydrateExtractCache();
  }, []);

  useKeyboardNav();

  const [sidebarWidth, setSidebarWidth] = useState(
    () => parseInt(localStorage.getItem('frirss_sidebarWidth') ?? '', 10) || 220
  );
  const [listWidth, setListWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem('frirss_listWidth') ?? '', 10);
    return saved && saved >= MIN_LIST ? saved : 320;
  });

  const syncCounts = useFeedStore((s) => s.syncCounts);
  const silentRefresh = useFeedStore((s) => s.silentRefresh);

  // ── Login → interface transition ─────────────────────────────────
  // `transition` holds the variant currently playing (null = idle). The variant
  // is a global, admin-configurable setting ('none' disables the animation).
  const [transition, setTransition] = useState<string | null>(null);
  // Cached login-animation setting (from the public /auth/status endpoint).
  // localStorage gives an instant value on the first flip; the fetch keeps it fresh.
  const loginVariantRef = useRef(localStorage.getItem('frirss_loginAnimation') || 'portal');
  useEffect(() => {
    getAuthStatus()
      .then((s) => {
        if (s && typeof s.loginAnimation === 'string') {
          loginVariantRef.current = s.loginAnimation;
          localStorage.setItem('frirss_loginAnimation', s.loginAnimation);
        }
      })
      .catch(() => {});
  }, []);

  // Track auth so we only play the animation on a real false→true flip
  // (not on a page refresh that restores an already-authenticated session).
  const wasAuthedRef = useRef(isAuthenticated);
  // useLayoutEffect: set the overlay *before* the browser paints the interface,
  // so the freshly-mounted UI is never glimpsed before the animation covers it.
  useLayoutEffect(() => {
    if (!wasAuthedRef.current && isAuthenticated) {
      // Read the freshest value: localStorage is updated live when an admin changes
      // the setting, so it beats the ref captured at mount.
      const v = localStorage.getItem('frirss_loginAnimation') || loginVariantRef.current || 'portal';
      if (v && v !== 'none') setTransition(v);
    }
    wasAuthedRef.current = isAuthenticated;
  }, [isAuthenticated]);

  const transitionLayer = transition && (
    <LoginTransition variant={transition} onDone={() => setTransition(null)} />
  );

  // ── OIDC callback: pick up token (or error) from the URL on mount ──
  const [oidcError, setOidcError] = useState<string | null>(null);
  useEffect(() => {
    // The backend hands the OIDC result back via the URL fragment (#...),
    // which — unlike a query string — is never sent to the server or logged.
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    const params = new URLSearchParams(hash);
    const token = params.get('oidc_token');
    const error = params.get('oidc_error');

    if (token) {
      // Seed the token so the API client can authenticate, then fetch the user
      setBackendAuth(token, null);
      getMe()
        .then((user) => setBackendAuth(token, user))
        .catch(() => useAuthStore.getState().logoutBackend());
    } else if (error) {
      setOidcError(error);
    }

    if (token || error) {
      // Clean the URL (remove the fragment) without reloading
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [setBackendAuth]);

  // Set once we restore a saved view on startup, so the unread-only
  // reconcile below doesn't override the resumed feed/filter.
  const restoredViewRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    loadSubscriptions();
    // Resume the last view (feed/label + filter) for this server, if any.
    const saved = loadLastView(useAuthStore.getState().activeServerId);
    if (saved) {
      restoredViewRef.current = true;
      useFeedStore.getState().selectView(saved.feed, saved.filter);
    } else {
      loadArticles();
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    // Warm the offline cache (favorites + read-later) in the background,
    // a few seconds after the initial load so it doesn't compete for bandwidth.
    timers.push(setTimeout(() => useFeedStore.getState().warmOfflineCache(), 4000));
    // Prefetch the first page of the unread feeds so opening them is instant.
    timers.push(setTimeout(() => useFeedStore.getState().warmFeedLists(), 3000));
    // Opt-in full offline refresh on open: online only, throttled to once/hour,
    // and incremental (skips already-cached articles).
    if (useUiStore.getState().autoOffline && (typeof navigator === 'undefined' || navigator.onLine)) {
      const last = Number(localStorage.getItem('frirss_lastOfflinePrep') || 0);
      if (Date.now() - last > 60 * 60 * 1000) {
        localStorage.setItem('frirss_lastOfflinePrep', String(Date.now()));
        timers.push(setTimeout(() => useFeedStore.getState().prepareOffline(), 8000));
      }
    }
    return () => timers.forEach(clearTimeout);
  }, [isAuthenticated, loadSubscriptions, loadArticles]);

  // ── Hydrate logical preferences from the backend (per-user sync) ──
  // Runs as soon as we have a backend session; tears down on logout.
  useEffect(() => {
    if (backendToken) {
      hydratePrefs().then(() => {
        // Once per-user prefs land, honour "unread only" on the initial view —
        // but only while still on the untouched landing view (don't override a
        // feed/favorites/read-later the user already opened during the fetch).
        if (restoredViewRef.current) return; // a saved view already won
        const fs = useFeedStore.getState();
        const desired = useUiStore.getState().unreadOnlyByFeed[''] ? 'unread' : 'all';
        if (!fs.selectedFeed && !fs.selectedArticle &&
            (fs.filter === 'all' || fs.filter === 'unread') && fs.filter !== desired) {
          fs.selectView(null, desired);
        }
      });
    } else {
      stopSync();
    }
  }, [backendToken]);

  // ── Persist the current view (feed/label + filter) for resume-on-open ──
  // Device-local, keyed by active server. The open article is not tracked.
  useEffect(() => {
    return useFeedStore.subscribe((s, p) => {
      if (s.selectedFeed !== p.selectedFeed || s.filter !== p.filter) {
        saveLastView(useAuthStore.getState().activeServerId, {
          feed: s.selectedFeed,
          filter: s.filter,
        });
      }
    });
  }, []);

  // ── Reload everything when the active FreshRSS server changes ──
  const prevServerRef = useRef(activeServerId);
  useEffect(() => {
    if (!isAuthenticated) {
      prevServerRef.current = activeServerId;
      return;
    }
    if (prevServerRef.current !== activeServerId) {
      prevServerRef.current = activeServerId;
      resetAndReload();
    }
  }, [activeServerId, isAuthenticated, resetAndReload]);

  // ── Background sync: periodic polling + visibility-based refresh ──
  useEffect(() => {
    if (!isAuthenticated) return;

    // Poll unread counts every 60s for cross-device sync
    const intervalId = setInterval(() => {
      syncCounts();
    }, 60_000);

    // When tab regains visibility → full silent refresh (cross-device scenario)
    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        silentRefresh();
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isAuthenticated, syncCounts, silentRefresh]);

  const resizeSidebar = useCallback((delta: number) => {
    setSidebarWidth((w) => {
      const next = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, w + delta));
      localStorage.setItem('frirss_sidebarWidth', String(next));
      return next;
    });
  }, []);

  const resizeList = useCallback((delta: number) => {
    setListWidth((w) => {
      const next = Math.max(MIN_LIST, w + delta);
      localStorage.setItem('frirss_listWidth', String(next));
      return next;
    });
  }, []);

  // ── Auto-close sidebar drawer after navigation on mobile/tablet ──
  const navKey = `${selectedFeedId || ''}:${filter}`;
  const prevNavRef = useRef(navKey);
  useEffect(() => {
    if (prevNavRef.current !== navKey && !isDesktop && sidebarVisible) {
      setSidebarVisible(false);
    }
    prevNavRef.current = navKey;
  }, [navKey, isDesktop, sidebarVisible, setSidebarVisible]);

  if (!isAuthenticated) {
    return <Login oidcError={oidcError} />;
  }

  const closeSidebar = () => setSidebarVisible(false);

  // ═══════════════════════════════════════════════════════════════════
  // MOBILE — single column, one view at a time, sidebar drawer
  // ═══════════════════════════════════════════════════════════════════
  if (isMobile) {
    return (
      <>
        <div ref={containerRef} className="app-shell overflow-hidden flex flex-col">
          <div className="safe-area-top" />
          {topbarVisible && <ServerSwitcher />}
          <div className="flex-1 min-h-0">
            <MobileStack
              showOverlay={!!selectedArticle}
              base={<ArticleList />}
              overlay={<ReadingPane showBack />}
            />
          </div>
          <div className="safe-area-bottom" />
        </div>

        <MobileDrawer
          open={sidebarVisible}
          onClose={closeSidebar}
          width={Math.min(360, Math.round(window.innerWidth * 0.85))}
        >
          <Sidebar />
        </MobileDrawer>

        {preferencesOpen && (
          <Suspense fallback={null}>
            <Preferences />
          </Suspense>
        )}
        {transitionLayer}
      <OfflineBanner />
      </>
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // TABLET — list + reading side by side, sidebar drawer
  // ═══════════════════════════════════════════════════════════════════
  if (isTablet) {
    return (
      <>
        <div ref={containerRef} className="app-shell overflow-hidden flex flex-col">
          <div className="safe-area-top" />
          {topbarVisible && <ServerSwitcher />}
          <div className="flex-1 flex overflow-hidden min-h-0">
            {!readingFocus && (
              <section
                className="flex-shrink-0 overflow-hidden"
                style={{
                  width: selectedArticle ? '38%' : '100%',
                  minWidth: selectedArticle ? '260px' : undefined,
                  maxWidth: selectedArticle ? '380px' : undefined,
                  borderRight: selectedArticle ? '1px solid var(--panel-border)' : undefined,
                  transition: 'width 0.15s ease',
                }}
              >
                <ArticleList />
              </section>
            )}
            {(selectedArticle || readingFocus) && (
              <main className="flex-1 overflow-hidden" style={{ minWidth: 0 }}>
                <ReadingPane showBack={!readingFocus} />
              </main>
            )}
          </div>
          <div className="safe-area-bottom" />
        </div>

        <MobileDrawer open={sidebarVisible} onClose={closeSidebar} width={300}>
          <Sidebar />
        </MobileDrawer>

        {preferencesOpen && (
          <Suspense fallback={null}>
            <Preferences />
          </Suspense>
        )}
        {transitionLayer}
      <OfflineBanner />
      </>
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // DESKTOP — 3-column (or 2-column) classic layout, unchanged
  // ═══════════════════════════════════════════════════════════════════
  const is2Panel = panelLayout === '2';
  // Reading Focus: reading pane fills the width, sidebar + list hidden.
  const showReadingPane = readingFocus || !is2Panel || selectedArticle;
  const showArticleList = !readingFocus && (!is2Panel || !selectedArticle);

  return (
    <>
      <div className="h-screen flex flex-col overflow-hidden">
        {topbarVisible && <ServerSwitcher />}
        <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Sidebar — full height, no shortcut bar */}
        {sidebarVisible && !readingFocus && (
          <>
            <aside
              className="flex-shrink-0 overflow-hidden"
              style={{ width: sidebarWidth }}
            >
              <Sidebar />
            </aside>
            <ResizeHandle onResize={resizeSidebar} />
          </>
        )}

        {/* Right side: content + shortcut bar */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="flex-1 flex overflow-hidden">
            {/* Article List */}
            {showArticleList && (
              <>
                <section
                  className="flex-shrink-0 overflow-hidden min-w-0"
                  style={{
                    width: is2Panel ? undefined : listWidth,
                    minWidth: is2Panel ? undefined : `${MIN_LIST}px`,
                    flex: is2Panel ? '1' : undefined,
                  }}
                >
                  <ArticleList />
                </section>
                {!is2Panel && <ResizeHandle onResize={resizeList} />}
              </>
            )}

            {/* Reading Pane */}
            {showReadingPane && (
              <main className="flex-1 overflow-hidden" style={{ minWidth: 0 }}>
                <ReadingPane showBack={is2Panel} />
              </main>
            )}
          </div>

          {/* Shortcut bar — only under content, not sidebar */}
          <ShortcutBar />
        </div>
        </div>
      </div>

      {preferencesOpen && (
          <Suspense fallback={null}>
            <Preferences />
          </Suspense>
        )}
      {transitionLayer}
      <OfflineBanner />
    </>
  );
}
