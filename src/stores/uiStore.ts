import { create } from 'zustand';
import type { OfflineImagePreset, OfflineImageSized, OfflineImageSizes } from '../lib/offlineImages';

function loadJson<T>(key: string, fallback: T): T {
  try {
    const val = localStorage.getItem(key);
    return val ? (JSON.parse(val) as T) : fallback;
  } catch {
    return fallback;
  }
}

export type Shortcuts = Record<string, string>;

const defaultShortcuts: Shortcuts = {
  nextArticle: 'ArrowDown',
  prevArticle: 'ArrowUp',
  openArticle: 'ArrowRight',
  markUnread: 'u',
  toggleStar: 'd',
  markRead: 'r',
  openOriginal: 'o',
  toggleSidebar: 'b',
  search: 'f',
  readLater: 'l',
};

export interface FeedSetting {
  autoExtract?: boolean;
  /**
   * Per-feed panel layout override ('2' | '3' | 'grid'). Empty/absent means the
   * feed follows the global panelLayout. Synced — "this feed reads better as a
   * grid" is a property of the feed, true on every device.
   */
  layout?: string;
}

export interface UiState {
  viewMode: string;
  setViewMode: (mode: string) => void;
  mobileReadingFontSize: number;
  setMobileReadingFontSize: (px: number) => void;
  showFavicons: boolean;
  toggleFavicons: () => void;
  sidebarVisible: boolean;
  toggleSidebar: () => void;
  setSidebarVisible: (v: boolean) => void;
  // Reading Focus mode: hide the sidebar + article list, reading pane fills the
  // viewport. Ephemeral (per-session), toggled by button / double-click / Esc.
  readingFocus: boolean;
  setReadingFocus: (v: boolean) => void;
  toggleReadingFocus: () => void;
  topbarVisible: boolean;
  toggleTopbar: () => void;
  organizeMode: boolean;
  setOrganizeMode: (v: boolean) => void;
  categoryOrder: string[];
  setCategoryOrder: (order: string[]) => void;
  feedOrder: Record<string, string[]>;
  setFeedOrder: (catId: string, feedIds: string[]) => void;
  labelOrder: string[];
  setLabelOrder: (order: string[]) => void;
  labelSortAlpha: boolean;
  setLabelSortAlpha: (v: boolean) => void;
  showLabelCounts: boolean;
  setShowLabelCounts: (v: boolean) => void;
  // Hide feeds (and now-empty categories) that have no unread articles.
  hideReadFeeds: boolean;
  toggleHideReadFeeds: () => void;
  // Require a second click on "Mark all as read" (guards accidental clicks).
  // Synced per-user. Off → mark immediately.
  confirmMarkAllRead: boolean;
  setConfirmMarkAllRead: (v: boolean) => void;
  // Collapse state persisted per-user (synced): whole ÉTIQUETTES section,
  // individual label groups, and feed categories.
  labelsCollapsed: boolean;
  setLabelsCollapsed: (v: boolean) => void;
  collapsedLabelGroups: Record<string, boolean>;
  toggleLabelGroup: (name: string) => void;
  collapsedCategories: Record<string, boolean>;
  toggleCategoryCollapsed: (catId: string) => void;
  // "Unread only" filter preference, kept independently per feed/label
  // (keyed by feed id; '' = the "all feeds" landing view). Synced per-user.
  unreadOnlyByFeed: Record<string, boolean>;
  setFeedUnreadOnly: (feedKey: string, on: boolean) => void;
  // Auto-refresh the offline cache on app open (local per-device, never synced).
  autoOffline: boolean;
  setAutoOffline: (v: boolean) => void;
  // Which offline image budget is active (synced — a comfort preference).
  // 'none' disables image prefetch entirely.
  offlineImagePreset: OfflineImagePreset;
  setOfflineImagePreset: (p: OfflineImagePreset) => void;
  // Edited preset sizes in Mo. Device-local, never synced: they are absolute
  // megabytes weighed against a quota that differs on every device — pushing a
  // desktop's 8 Go onto a phone would be wrong. An absent entry follows the
  // quota-derived suggestion.
  offlineImageSizes: OfflineImageSizes;
  setOfflineImageSize: (preset: OfflineImageSized, mb: number) => void;
  resetOfflineImageSizes: () => void;
  showDateSeparators: boolean;
  toggleDateSeparators: () => void;
  // Group grid cards by date. Independent of showDateSeparators (which drives
  // the list views) and OFF by default — the grid is a continuous gallery.
  gridDateSeparators: boolean;
  toggleGridDateSeparators: () => void;
  showSourceInFeed: boolean;
  showSourceInAll: boolean;
  toggleShowSourceInFeed: () => void;
  toggleShowSourceInAll: () => void;
  panelLayout: string;
  setPanelLayout: (layout: string) => void;
  feedSettings: Record<string, FeedSetting>;
  setFeedAutoExtract: (feedId: string, value: boolean) => void;
  getFeedAutoExtract: (feedId: string) => boolean;
  /** Set (or clear, with '') this feed's layout override. */
  setFeedLayout: (feedId: string, layout: string) => void;
  appTitle: string;
  appLogo: string | null;
  logoMode: 'small' | 'large';
  // Force the layout regardless of screen width ('auto' = follow width).
  // Local to each device — never synced (a tablet can be mobile while the
  // desktop stays desktop).
  layoutMode: 'auto' | 'desktop' | 'mobile';
  setAppTitle: (title: string) => void;
  setAppLogo: (dataUrl: string | null) => void;
  setLogoMode: (mode: 'small' | 'large') => void;
  setLayoutMode: (mode: 'auto' | 'desktop' | 'mobile') => void;
  shortcuts: Shortcuts;
  setShortcut: (action: string, key: string) => void;
  resetShortcuts: () => void;
  applyServerPrefs: (prefs: Record<string, unknown> | null | undefined) => void;
}

export const useUiStore = create<UiState>()((set, get) => ({
  // Article list view mode
  viewMode: localStorage.getItem('frirss_viewMode') || 'preview',
  setViewMode: (mode) => {
    localStorage.setItem('frirss_viewMode', mode);
    set({ viewMode: mode });
  },

  // Reading-pane body font size on mobile/tablet — independent from the
  // desktop theme value (which is synced); defaults a notch bigger for touch.
  mobileReadingFontSize: parseInt(localStorage.getItem('frirss_mobileReadingFontSize') ?? '', 10) || 17,
  setMobileReadingFontSize: (px) => {
    const v = Math.max(13, Math.min(26, px));
    localStorage.setItem('frirss_mobileReadingFontSize', String(v));
    set({ mobileReadingFontSize: v });
  },

  // Show favicons in sidebar
  showFavicons: loadJson('frirss_showFavicons', true),
  toggleFavicons: () => {
    set((state) => {
      const next = !state.showFavicons;
      localStorage.setItem('frirss_showFavicons', JSON.stringify(next));
      return { showFavicons: next };
    });
  },

  // Sidebar visibility
  sidebarVisible: loadJson('frirss_sidebarVisible', true),
  toggleSidebar: () => {
    set((state) => {
      const next = !state.sidebarVisible;
      localStorage.setItem('frirss_sidebarVisible', JSON.stringify(next));
      return { sidebarVisible: next };
    });
  },
  setSidebarVisible: (v) => {
    localStorage.setItem('frirss_sidebarVisible', JSON.stringify(v));
    set({ sidebarVisible: v });
  },

  // Reading Focus mode (ephemeral — always starts off on a fresh load).
  readingFocus: false,
  setReadingFocus: (v) => set({ readingFocus: v }),
  toggleReadingFocus: () => set((s) => ({ readingFocus: !s.readingFocus })),

  // Server switcher topbar visibility
  topbarVisible: loadJson('frirss_topbarVisible', true),
  toggleTopbar: () => {
    set((state) => {
      const next = !state.topbarVisible;
      localStorage.setItem('frirss_topbarVisible', JSON.stringify(next));
      return { topbarVisible: next };
    });
  },

  // Sidebar organize mode
  organizeMode: false,
  setOrganizeMode: (v) => set({ organizeMode: v }),

  // Custom category order (array of category IDs)
  categoryOrder: loadJson('frirss_categoryOrder', [] as string[]),
  setCategoryOrder: (order) => {
    localStorage.setItem('frirss_categoryOrder', JSON.stringify(order));
    set({ categoryOrder: order });
  },

  // Custom feed order within categories { [catId]: [feedId, feedId, ...] }
  feedOrder: loadJson('frirss_feedOrder', {} as Record<string, string[]>),
  setFeedOrder: (catId, feedIds) => {
    set((state) => {
      const next = { ...state.feedOrder, [catId]: feedIds };
      localStorage.setItem('frirss_feedOrder', JSON.stringify(next));
      return { feedOrder: next };
    });
  },

  // Label ordering: flat array of label IDs in display order
  labelOrder: loadJson('frirss_labelOrder', [] as string[]),
  setLabelOrder: (order) => {
    localStorage.setItem('frirss_labelOrder', JSON.stringify(order));
    set({ labelOrder: order });
  },
  // When true, ignore custom order and sort alphabetically
  labelSortAlpha: loadJson('frirss_labelSortAlpha', true),
  setLabelSortAlpha: (v) => {
    localStorage.setItem('frirss_labelSortAlpha', JSON.stringify(v));
    set({ labelSortAlpha: v });
  },
  // Show the article count next to each label in the sidebar.
  showLabelCounts: loadJson('frirss_showLabelCounts', true),
  setShowLabelCounts: (v) => {
    localStorage.setItem('frirss_showLabelCounts', JSON.stringify(v));
    set({ showLabelCounts: v });
  },

  // Show only feeds with unread articles (declutters large feed lists).
  hideReadFeeds: loadJson('frirss_hideReadFeeds', false),
  toggleHideReadFeeds: () => {
    set((state) => {
      const next = !state.hideReadFeeds;
      localStorage.setItem('frirss_hideReadFeeds', JSON.stringify(next));
      return { hideReadFeeds: next };
    });
  },

  // Confirm before "Mark all as read" (default on — guards accidental clicks).
  confirmMarkAllRead: loadJson('frirss_confirmMarkAllRead', true),
  setConfirmMarkAllRead: (v) => {
    localStorage.setItem('frirss_confirmMarkAllRead', JSON.stringify(v));
    set({ confirmMarkAllRead: v });
  },

  // Whole ÉTIQUETTES section collapsed?
  labelsCollapsed: loadJson('frirss_labelsCollapsed', false),
  setLabelsCollapsed: (v) => {
    localStorage.setItem('frirss_labelsCollapsed', JSON.stringify(v));
    set({ labelsCollapsed: v });
  },
  // Per-label-group collapse: { [groupName]: true }
  collapsedLabelGroups: loadJson('frirss_collapsedLabelGroups', {} as Record<string, boolean>),
  toggleLabelGroup: (name) => {
    set((state) => {
      const next = { ...state.collapsedLabelGroups, [name]: !state.collapsedLabelGroups[name] };
      localStorage.setItem('frirss_collapsedLabelGroups', JSON.stringify(next));
      return { collapsedLabelGroups: next };
    });
  },
  // Per-feed-category collapse: { [catId]: true }
  collapsedCategories: loadJson('frirss_collapsedCategories', {} as Record<string, boolean>),
  toggleCategoryCollapsed: (catId) => {
    set((state) => {
      const next = { ...state.collapsedCategories, [catId]: !state.collapsedCategories[catId] };
      localStorage.setItem('frirss_collapsedCategories', JSON.stringify(next));
      return { collapsedCategories: next };
    });
  },

  // Per-feed "unread only" preference: { [feedId]: true }
  unreadOnlyByFeed: loadJson('frirss_unreadOnlyByFeed', {} as Record<string, boolean>),
  setFeedUnreadOnly: (feedKey, on) => {
    set((state) => {
      const next = { ...state.unreadOnlyByFeed, [feedKey]: on };
      localStorage.setItem('frirss_unreadOnlyByFeed', JSON.stringify(next));
      return { unreadOnlyByFeed: next };
    });
  },
  // Auto-refresh the offline cache on app open (local, throttled in App).
  autoOffline: loadJson('frirss_autoOffline', false),
  setAutoOffline: (v) => {
    localStorage.setItem('frirss_autoOffline', JSON.stringify(v));
    set({ autoOffline: v });
  },

  offlineImagePreset: loadJson<OfflineImagePreset>('frirss_offlineImagePreset', 'standard'),
  setOfflineImagePreset: (p) => {
    localStorage.setItem('frirss_offlineImagePreset', JSON.stringify(p));
    set({ offlineImagePreset: p });
  },
  offlineImageSizes: loadJson('frirss_offlineImageSizes', {} as OfflineImageSizes),
  setOfflineImageSize: (preset, mb) => {
    set((state) => {
      const next = { ...state.offlineImageSizes };
      // A cleared/zero field means "follow the suggestion" — drop the entry.
      if (mb > 0) next[preset] = Math.round(mb);
      else delete next[preset];
      localStorage.setItem('frirss_offlineImageSizes', JSON.stringify(next));
      return { offlineImageSizes: next };
    });
  },
  resetOfflineImageSizes: () => {
    localStorage.setItem('frirss_offlineImageSizes', JSON.stringify({}));
    set({ offlineImageSizes: {} });
  },

  // Show date separators in article list (Aujourd'hui, Hier, …)
  showDateSeparators: loadJson('frirss_showDateSeparators', true),
  toggleDateSeparators: () => {
    set((state) => {
      const next = !state.showDateSeparators;
      localStorage.setItem('frirss_showDateSeparators', JSON.stringify(next));
      return { showDateSeparators: next };
    });
  },

  // Grid-only date grouping — off by default (continuous gallery).
  gridDateSeparators: loadJson('frirss_gridDateSeparators', false),
  toggleGridDateSeparators: () => {
    set((state) => {
      const next = !state.gridDateSeparators;
      localStorage.setItem('frirss_gridDateSeparators', JSON.stringify(next));
      return { gridDateSeparators: next };
    });
  },

  // Show source name in article list
  showSourceInFeed: loadJson('frirss_showSourceInFeed', true),     // inside a specific feed
  showSourceInAll: loadJson('frirss_showSourceInAll', true),       // in "Tous les flux"
  toggleShowSourceInFeed: () => {
    set((state) => {
      const next = !state.showSourceInFeed;
      localStorage.setItem('frirss_showSourceInFeed', JSON.stringify(next));
      return { showSourceInFeed: next };
    });
  },
  toggleShowSourceInAll: () => {
    set((state) => {
      const next = !state.showSourceInAll;
      localStorage.setItem('frirss_showSourceInAll', JSON.stringify(next));
      return { showSourceInAll: next };
    });
  },

  // Layout: 2 panels or 3 panels
  panelLayout: localStorage.getItem('frirss_panelLayout') || '3',
  setPanelLayout: (layout) => {
    localStorage.setItem('frirss_panelLayout', layout);
    set({ panelLayout: layout });
  },

  // Per-feed settings: { [feedId]: { autoExtract: true } }
  feedSettings: loadJson('frirss_feedSettings', {} as Record<string, FeedSetting>),
  setFeedAutoExtract: (feedId, value) => {
    set((state) => {
      const next = {
        ...state.feedSettings,
        [feedId]: { ...state.feedSettings[feedId], autoExtract: value },
      };
      localStorage.setItem('frirss_feedSettings', JSON.stringify(next));
      return { feedSettings: next };
    });
  },
  getFeedAutoExtract: (feedId) => {
    const { feedSettings } = get();
    return feedSettings[feedId]?.autoExtract || false;
  },
  setFeedLayout: (feedId, layout) => {
    set((state) => {
      const entry = { ...state.feedSettings[feedId] };
      if (layout) entry.layout = layout;
      else delete entry.layout;

      const next = { ...state.feedSettings, [feedId]: entry };
      // Drop the entry entirely once it carries no settings at all.
      if (Object.keys(entry).length === 0) delete next[feedId];

      localStorage.setItem('frirss_feedSettings', JSON.stringify(next));
      return { feedSettings: next };
    });
  },

  // App branding — custom title & logo
  appTitle: localStorage.getItem('frirss_appTitle') || 'FriRSS',
  appLogo: localStorage.getItem('frirss_appLogo') || null,
  // 'large' = the logo replaces the title (historical behaviour);
  // 'small' = a compact logo sits next to the title + server name.
  logoMode: (localStorage.getItem('frirss_logoMode') === 'small' ? 'small' : 'large'),
  layoutMode: ((): 'auto' | 'desktop' | 'mobile' => {
    const v = localStorage.getItem('frirss_layoutMode');
    return v === 'desktop' || v === 'mobile' ? v : 'auto';
  })(),
  setAppTitle: (title) => {
    const val = title.trim() || 'FriRSS';
    localStorage.setItem('frirss_appTitle', val);
    set({ appTitle: val });
  },
  setAppLogo: (dataUrl) => {
    if (dataUrl) {
      localStorage.setItem('frirss_appLogo', dataUrl);
    } else {
      localStorage.removeItem('frirss_appLogo');
    }
    set({ appLogo: dataUrl || null });
  },
  setLogoMode: (mode) => {
    localStorage.setItem('frirss_logoMode', mode);
    set({ logoMode: mode });
  },
  setLayoutMode: (mode) => {
    localStorage.setItem('frirss_layoutMode', mode);
    set({ layoutMode: mode });
  },

  // Keyboard shortcuts (configurable)
  shortcuts: loadJson('frirss_shortcuts', defaultShortcuts),
  setShortcut: (action, key) => {
    set((state) => {
      const next = { ...state.shortcuts, [action]: key };
      localStorage.setItem('frirss_shortcuts', JSON.stringify(next));
      return { shortcuts: next };
    });
  },
  resetShortcuts: () => {
    localStorage.setItem('frirss_shortcuts', JSON.stringify(defaultShortcuts));
    set({ shortcuts: { ...defaultShortcuts } });
  },

  // ── Server-side sync ───────────────────────────────────────────
  // Apply preferences hydrated from the backend (per-user, not browser-bound).
  // Mirrors each value to localStorage in the format the store expects:
  // raw strings for viewMode/appTitle/appLogo, JSON for the rest.
  // Geometric prefs (panelLayout, sidebarVisible) are intentionally NOT synced.
  applyServerPrefs: (prefs) => {
    if (!prefs || typeof prefs !== 'object') return;
    const has = (k: string) => Object.prototype.hasOwnProperty.call(prefs, k);
    const next: Record<string, unknown> = {};

    // Raw-string keys
    if (has('viewMode') && typeof prefs.viewMode === 'string') {
      localStorage.setItem('frirss_viewMode', prefs.viewMode);
      next.viewMode = prefs.viewMode;
    }
    if (has('appTitle') && typeof prefs.appTitle === 'string') {
      const val = prefs.appTitle.trim() || 'FriRSS';
      localStorage.setItem('frirss_appTitle', val);
      next.appTitle = val;
    }
    if (has('appLogo')) {
      if (prefs.appLogo) {
        localStorage.setItem('frirss_appLogo', String(prefs.appLogo));
        next.appLogo = prefs.appLogo;
      } else {
        localStorage.removeItem('frirss_appLogo');
        next.appLogo = null;
      }
    }
    if (has('logoMode') && (prefs.logoMode === 'small' || prefs.logoMode === 'large')) {
      localStorage.setItem('frirss_logoMode', prefs.logoMode);
      next.logoMode = prefs.logoMode;
    }

    // JSON keys — state field name matches the localStorage suffix
    const jsonKeys = [
      'showFavicons', 'topbarVisible', 'categoryOrder', 'feedOrder',
      'labelOrder', 'labelSortAlpha', 'showLabelCounts', 'showDateSeparators', 'gridDateSeparators',
      'showSourceInFeed', 'showSourceInAll', 'feedSettings', 'shortcuts',
      'labelsCollapsed', 'collapsedLabelGroups', 'collapsedCategories', 'unreadOnlyByFeed', 'hideReadFeeds',
      'confirmMarkAllRead', 'offlineImagePreset',
    ];
    for (const k of jsonKeys) {
      if (has(k) && prefs[k] !== undefined && prefs[k] !== null) {
        localStorage.setItem(`frirss_${k}`, JSON.stringify(prefs[k]));
        next[k] = prefs[k];
      }
    }

    if (Object.keys(next).length) set(next as Partial<UiState>);
  },
}));

// Keys synced to the server (logical prefs — NOT geometric: panel widths,
// 2/3-column layout and sidebar visibility stay local to each device).
export const UI_SYNC_KEYS = [
  'viewMode', 'showFavicons', 'topbarVisible',
  'categoryOrder', 'feedOrder', 'labelOrder', 'labelSortAlpha', 'showLabelCounts',
  'showDateSeparators', 'gridDateSeparators', 'showSourceInFeed', 'showSourceInAll',
  'feedSettings', 'appTitle', 'appLogo', 'logoMode', 'shortcuts',
  'labelsCollapsed', 'collapsedLabelGroups', 'collapsedCategories', 'unreadOnlyByFeed', 'hideReadFeeds',
  'confirmMarkAllRead', 'offlineImagePreset',
];

// Keys into preferences.shortcuts.* in the locale files
export const shortcutActions = [
  'nextArticle', 'prevArticle', 'openArticle',
  'markRead', 'markUnread', 'toggleStar',
  'openOriginal', 'toggleSidebar', 'search', 'readLater',
];

// For the shortcut footer — only show contextual shortcuts
export const shortcutGroups: Record<string, string[]> = {
  list: ['prevArticle', 'nextArticle', 'openArticle', 'markRead', 'markUnread', 'toggleStar', 'readLater', 'search'],
  reading: ['prevArticle', 'nextArticle', 'markRead', 'markUnread', 'toggleStar', 'readLater', 'openOriginal'],
};
