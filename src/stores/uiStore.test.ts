// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useUiStore, UI_SYNC_KEYS, normalizeAiSummaryRatio, normalizeAiProviderId, normalizeAiCategoryProviders,
  normalizeAiCategoryBooleans,
} from './uiStore';
import { isUnreadOnly } from './uiStore';

describe('uiStore', () => {
  beforeEach(() => localStorage.clear());

  // Décision du propriétaire (2026-09-25) : sans réglage explicite, « Tout lu »
  // et les deux marquages de plage agissent au premier clic, sans confirmation.
  // Qui a explicitement activé la confirmation garde son choix — la valeur
  // stockée gagne, ce test ne porte que sur le défaut au tout premier chargement.
  /**
   * Inversé le 2026-09-30, à la demande du propriétaire, après l'issue #17 :
   * une action irréversible ne s'arme pas toute seule sur une installation
   * neuve. Les comptes EXISTANTS gardent l'ancien comportement — c'est
   * `applyServerPrefs` qui s'en charge, et `uiStore.confirmDefault.test.ts`
   * qui le fige.
   */
  it('summarize defaults to s and survives an older synced shortcuts object', () => {
    expect(useUiStore.getState().shortcuts.summarize).toBe('s');
    useUiStore.getState().applyServerPrefs({ shortcuts: { nextArticle: 'j' } });
    expect(useUiStore.getState().shortcuts).toMatchObject({ nextArticle: 'j', summarize: 's' });
    // applyServerPrefs also applies the legacy-account rule for the mark-all-read
    // confirmation (any synced prefs without it turn it off): put the store back.
    useUiStore.setState({ confirmMarkAllRead: true, shortcuts: { ...useUiStore.getState().shortcuts, nextArticle: 'ArrowDown' } });
  });

  it('summarize survives a locally stored shortcuts object that predates it', async () => {
    localStorage.setItem('frirss_shortcuts', JSON.stringify({ nextArticle: 'j' }));
    vi.resetModules();
    const fresh = await import('./uiStore');
    expect(fresh.useUiStore.getState().shortcuts).toMatchObject({ nextArticle: 'j', summarize: 's', search: 'f' });
  });

  it('translate defaults to t and survives an older synced shortcuts object', () => {
    expect(useUiStore.getState().shortcuts.translate).toBe('t');
    useUiStore.getState().applyServerPrefs({ shortcuts: { nextArticle: 'j', summarize: 's' } });
    expect(useUiStore.getState().shortcuts).toMatchObject({ nextArticle: 'j', summarize: 's', translate: 't' });
    useUiStore.setState({ confirmMarkAllRead: true, shortcuts: { ...useUiStore.getState().shortcuts, nextArticle: 'ArrowDown' } });
  });

  it('translate survives a locally stored shortcuts object that predates it', async () => {
    localStorage.setItem('frirss_shortcuts', JSON.stringify({ nextArticle: 'j', summarize: 's' }));
    vi.resetModules();
    const fresh = await import('./uiStore');
    expect(fresh.useUiStore.getState().shortcuts).toMatchObject({ nextArticle: 'j', summarize: 's', translate: 't' });
  });

  it('translate is a reading shortcut, listed with the configurable ones', async () => {
    const { shortcutActions, shortcutGroups } = await import('./uiStore');
    expect(shortcutActions).toContain('translate');
    expect(shortcutGroups.reading).toContain('translate');
    expect(shortcutGroups.list).not.toContain('translate');
  });

  it('confirmMarkAllRead est activé par défaut, sans réglage stocké', () => {
    expect(useUiStore.getState().confirmMarkAllRead).toBe(true);
  });

  it('setAppLogo stores then clears the logo', () => {
    useUiStore.getState().setAppLogo('https://example.com/logo.png');
    expect(useUiStore.getState().appLogo).toBe('https://example.com/logo.png');
    expect(localStorage.getItem('frirss_appLogo')).toBe('https://example.com/logo.png');

    useUiStore.getState().setAppLogo(null);
    expect(useUiStore.getState().appLogo).toBe(null);
    expect(localStorage.getItem('frirss_appLogo')).toBe(null);
  });

  it('setAppTitle falls back to FriRSS for empty input', () => {
    useUiStore.getState().setAppTitle('   ');
    expect(useUiStore.getState().appTitle).toBe('FriRSS');
    useUiStore.getState().setAppTitle('My Reader');
    expect(useUiStore.getState().appTitle).toBe('My Reader');
  });

  it('applyServerPrefs applies raw-string prefs', () => {
    useUiStore.getState().applyServerPrefs({ viewMode: 'compact', appTitle: 'Hello' });
    expect(useUiStore.getState().viewMode).toBe('compact');
    expect(useUiStore.getState().appTitle).toBe('Hello');
  });

  it('applyServerPrefs ignores non-object input', () => {
    const before = useUiStore.getState().viewMode;
    useUiStore.getState().applyServerPrefs(null);
    expect(useUiStore.getState().viewMode).toBe(before);
  });

  it('setFeedUnreadOnly stores the preference per feed, independently', () => {
    useUiStore.setState({ unreadOnlyByFeed: {} });
    useUiStore.getState().setFeedUnreadOnly('feed/A', true);
    expect(useUiStore.getState().unreadOnlyByFeed['feed/A']).toBe(true);
    // A second feed is unaffected.
    expect(useUiStore.getState().unreadOnlyByFeed['feed/B']).toBeUndefined();
    useUiStore.getState().setFeedUnreadOnly('feed/B', true);
    useUiStore.getState().setFeedUnreadOnly('feed/A', false);
    expect(useUiStore.getState().unreadOnlyByFeed['feed/A']).toBe(false);
    expect(useUiStore.getState().unreadOnlyByFeed['feed/B']).toBe(true);
    expect(JSON.parse(localStorage.getItem('frirss_unreadOnlyByFeed')!)['feed/B']).toBe(true);
  });

  it('setLabelsCollapsed persists the labels section state', () => {
    useUiStore.getState().setLabelsCollapsed(true);
    expect(useUiStore.getState().labelsCollapsed).toBe(true);
    expect(localStorage.getItem('frirss_labelsCollapsed')).toBe('true');
  });

  it('toggleCategoryCollapsed flips a single category and persists', () => {
    useUiStore.setState({ collapsedCategories: {} });
    useUiStore.getState().toggleCategoryCollapsed('cat/A');
    expect(useUiStore.getState().collapsedCategories['cat/A']).toBe(true);
    useUiStore.getState().toggleCategoryCollapsed('cat/A');
    expect(useUiStore.getState().collapsedCategories['cat/A']).toBe(false);
    expect(JSON.parse(localStorage.getItem('frirss_collapsedCategories')!)['cat/A']).toBe(false);
  });

  it('toggleLabelGroup flips a single group and persists', () => {
    useUiStore.setState({ collapsedLabelGroups: {} });
    useUiStore.getState().toggleLabelGroup('News');
    expect(useUiStore.getState().collapsedLabelGroups['News']).toBe(true);
    expect(JSON.parse(localStorage.getItem('frirss_collapsedLabelGroups')!)['News']).toBe(true);
  });

  it('applyServerPrefs applies the new collapse + per-feed unread prefs', () => {
    useUiStore.getState().applyServerPrefs({
      unreadOnlyByFeed: { 'feed/A': true },
      labelsCollapsed: true,
      collapsedCategories: { 'cat/A': true },
      collapsedLabelGroups: { News: true },
    });
    const s = useUiStore.getState();
    expect(s.unreadOnlyByFeed['feed/A']).toBe(true);
    expect(s.labelsCollapsed).toBe(true);
    expect(s.collapsedCategories['cat/A']).toBe(true);
    expect(s.collapsedLabelGroups['News']).toBe(true);
  });

  it('syncs the new prefs across devices (present in UI_SYNC_KEYS)', () => {
    for (const k of ['unreadOnlyByFeed', 'labelsCollapsed', 'collapsedCategories', 'collapsedLabelGroups', 'hideReadFeeds']) {
      expect(UI_SYNC_KEYS).toContain(k);
    }
  });

  it('toggleHideReadFeeds flips and persists the preference', () => {
    useUiStore.setState({ hideReadFeeds: false });
    useUiStore.getState().toggleHideReadFeeds();
    expect(useUiStore.getState().hideReadFeeds).toBe(true);
    expect(localStorage.getItem('frirss_hideReadFeeds')).toBe('true');
    useUiStore.getState().toggleHideReadFeeds();
    expect(useUiStore.getState().hideReadFeeds).toBe(false);
  });

  // A device still on an older version can sync a preset we have removed;
  // taking it as-is used to crash the offline preferences tab.
  it('applyServerPrefs normalises a retired image preset', () => {
    useUiStore.getState().applyServerPrefs({ offlineImagePreset: 'custom' });
    expect(useUiStore.getState().offlineImagePreset).toBe('standard');
    expect(localStorage.getItem('frirss_offlineImagePreset')).toBe('"standard"');
  });

  it('applyServerPrefs keeps a valid image preset', () => {
    useUiStore.getState().applyServerPrefs({ offlineImagePreset: 'max' });
    expect(useUiStore.getState().offlineImagePreset).toBe('max');
  });

  it('setRowAction flips a single icon and persists it, others untouched', () => {
    useUiStore.setState({ rowActions: { star: true, readLater: true, openSource: true, markRead: true } });
    useUiStore.getState().setRowAction('openSource', false);
    const s = useUiStore.getState();
    expect(s.rowActions.openSource).toBe(false);
    expect(s.rowActions.star).toBe(true);
    expect(s.rowActions.readLater).toBe(true);
    expect(s.rowActions.markRead).toBe(true);
    expect(JSON.parse(localStorage.getItem('frirss_rowActions')!)).toEqual(s.rowActions);
  });

  it('rowActions is synced across devices (present in UI_SYNC_KEYS)', () => {
    expect(UI_SYNC_KEYS).toContain('rowActions');
  });

  // A device still on an older version syncs a `rowActions` object missing
  // keys added since — completing it here (as for `offlineImagePreset`
  // above) is what keeps an icon from vanishing in silence.
  it('applyServerPrefs completes a rowActions object missing newer keys', () => {
    useUiStore.getState().applyServerPrefs({ rowActions: { star: false } });
    expect(useUiStore.getState().rowActions).toEqual({
      star: false, readLater: true, openSource: true, markRead: true,
    });
    expect(JSON.parse(localStorage.getItem('frirss_rowActions')!)).toEqual({
      star: false, readLater: true, openSource: true, markRead: true,
    });
  });

  it('applyServerPrefs keeps a fully-specified rowActions object as-is', () => {
    useUiStore.getState().applyServerPrefs({
      rowActions: { star: false, readLater: false, openSource: true, markRead: false },
    });
    expect(useUiStore.getState().rowActions).toEqual({
      star: false, readLater: false, openSource: true, markRead: false,
    });
  });

  // The completion above guards `applyServerPrefs` (sync). The initial load
  // from `localStorage` — the other of the "two places" `docs/FEATURES.md`
  // says are guarded — goes through the same `normalizeRowActions()`, but at
  // module-init time, so it needs its own re-import to exercise: a partial
  // object left by an older build must not make an icon vanish at startup.
  it('completes a partial rowActions object read from localStorage at load', async () => {
    localStorage.setItem('frirss_rowActions', JSON.stringify({ star: false }));
    vi.resetModules();
    const { useUiStore: freshStore } = await import('./uiStore');
    expect(freshStore.getState().rowActions).toEqual({
      star: false, readLater: true, openSource: true, markRead: true,
    });
  });
});

describe('uiStore — portée du filtre Non lus', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ unreadOnlyScope: 'feed', unreadOnlyAll: false, unreadOnlyByFeed: {} });
  });

  it('isUnreadOnly per feed reads the stored choice, like before', () => {
    useUiStore.setState({ unreadOnlyByFeed: { 'feed/A': true, 'feed/B': false } });
    expect(isUnreadOnly('feed/A')).toBe(true);
    expect(isUnreadOnly('feed/B')).toBe(false);
    expect(isUnreadOnly('feed/unset')).toBe(false);
  });

  it('setUnreadOnlyScope to all takes the choice of the current view and keeps the table', () => {
    useUiStore.setState({ unreadOnlyByFeed: { 'feed/A': true, 'feed/B': false } });
    useUiStore.getState().setUnreadOnlyScope('all', 'feed/A');
    const s = useUiStore.getState();
    expect(s.unreadOnlyScope).toBe('all');
    expect(s.unreadOnlyAll).toBe(true);
    expect(s.unreadOnlyByFeed).toEqual({ 'feed/A': true, 'feed/B': false });
    expect(JSON.parse(localStorage.getItem('frirss_unreadOnlyScope')!)).toBe('all');
    expect(JSON.parse(localStorage.getItem('frirss_unreadOnlyAll')!)).toBe(true);
    expect(isUnreadOnly('feed/B')).toBe(true);
  });

  it('back to per feed keeps the last state and clears the per-feed table', () => {
    useUiStore.setState({ unreadOnlyScope: 'all', unreadOnlyAll: true, unreadOnlyByFeed: { 'feed/B': false } });
    useUiStore.getState().setUnreadOnlyScope('feed', 'feed/A');
    const s = useUiStore.getState();
    expect(s.unreadOnlyScope).toBe('feed');
    expect(s.unreadOnlyAll).toBe(true);
    expect(s.unreadOnlyByFeed).toEqual({});
    expect(JSON.parse(localStorage.getItem('frirss_unreadOnlyByFeed')!)).toEqual({});
    expect(isUnreadOnly('feed/B')).toBe(true);
  });

  it('choosing the active scope writes nothing', () => {
    useUiStore.setState({ unreadOnlyByFeed: { 'feed/A': true } });
    useUiStore.getState().setUnreadOnlyScope('feed', 'feed/A');
    expect(useUiStore.getState().unreadOnlyByFeed).toEqual({ 'feed/A': true });
    expect(localStorage.getItem('frirss_unreadOnlyScope')).toBeNull();
  });

  it('setUnreadOnlyAll stores and persists the global state', () => {
    useUiStore.getState().setUnreadOnlyAll(true);
    expect(useUiStore.getState().unreadOnlyAll).toBe(true);
    expect(localStorage.getItem('frirss_unreadOnlyAll')).toBe('true');
  });

  it('applyServerPrefs applies both prefs and normalises an unknown scope', () => {
    useUiStore.getState().applyServerPrefs({ unreadOnlyScope: 'all', unreadOnlyAll: true });
    expect(useUiStore.getState().unreadOnlyScope).toBe('all');
    expect(useUiStore.getState().unreadOnlyAll).toBe(true);
    useUiStore.getState().applyServerPrefs({ unreadOnlyScope: 'everything' });
    expect(useUiStore.getState().unreadOnlyScope).toBe('feed');
  });

  it('syncs both prefs across devices', () => {
    expect(UI_SYNC_KEYS).toContain('unreadOnlyScope');
    expect(UI_SYNC_KEYS).toContain('unreadOnlyAll');
  });

  it('applyServerPrefs only accepts a real true for the global state', () => {
    useUiStore.getState().applyServerPrefs({ unreadOnlyAll: 'false' });
    expect(useUiStore.getState().unreadOnlyAll).toBe(false);
    useUiStore.getState().applyServerPrefs({ unreadOnlyAll: 1 });
    expect(useUiStore.getState().unreadOnlyAll).toBe(false);
    useUiStore.getState().applyServerPrefs({ unreadOnlyAll: true });
    expect(useUiStore.getState().unreadOnlyAll).toBe(true);
  });
});

describe('uiStore — pastille « nouveaux articles »', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ showNewArticlesPill: true });
  });

  it('persists a change', () => {
    useUiStore.getState().setShowNewArticlesPill(false);
    expect(useUiStore.getState().showNewArticlesPill).toBe(false);
    expect(localStorage.getItem('frirss_showNewArticlesPill')).toBe('false');
  });

  it('syncs across devices, and only an explicit false turns it off', () => {
    expect(UI_SYNC_KEYS).toContain('showNewArticlesPill');
    useUiStore.getState().applyServerPrefs({ showNewArticlesPill: false });
    expect(useUiStore.getState().showNewArticlesPill).toBe(false);
    useUiStore.getState().applyServerPrefs({ showNewArticlesPill: 'false' });
    expect(useUiStore.getState().showNewArticlesPill).toBe(true);
    useUiStore.getState().applyServerPrefs({ showNewArticlesPill: false });
    useUiStore.getState().applyServerPrefs({ showNewArticlesPill: true });
    expect(useUiStore.getState().showNewArticlesPill).toBe(true);
  });
});

describe('uiStore — panneau « Résumé IA »', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ aiPanelCollapsed: false, aiSummaryRatio: 20, aiPanelAutoExpanded: false });
  });

  it('persists the collapse state and syncs it', () => {
    useUiStore.getState().setAiPanelCollapsed(true);
    expect(useUiStore.getState().aiPanelCollapsed).toBe(true);
    expect(localStorage.getItem('frirss_aiPanelCollapsed')).toBe('true');
    expect(UI_SYNC_KEYS).toContain('aiPanelCollapsed');
    useUiStore.getState().applyServerPrefs({ aiPanelCollapsed: false });
    expect(useUiStore.getState().aiPanelCollapsed).toBe(false);
    // Seul un `true` explicite replie : le défaut est déplié.
    useUiStore.getState().applyServerPrefs({ aiPanelCollapsed: 'true' });
    expect(useUiStore.getState().aiPanelCollapsed).toBe(false);
  });

  it('remembers, on this device only, that the panel already opened itself once', () => {
    useUiStore.getState().markAiPanelAutoExpanded();
    expect(useUiStore.getState().aiPanelAutoExpanded).toBe(true);
    expect(localStorage.getItem('frirss_aiPanelAutoExpanded')).toBe('true');
    expect(UI_SYNC_KEYS).not.toContain('aiPanelAutoExpanded');
  });
});

describe('uiStore — longueur des résumés IA', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ aiSummaryRatio: 20 });
  });

  it('normalises to a multiple of 5 between 5 and 50, 20 otherwise', () => {
    expect(normalizeAiSummaryRatio(35)).toBe(35);
    expect(normalizeAiSummaryRatio(5)).toBe(5);
    expect(normalizeAiSummaryRatio(50)).toBe(50);
    for (const bad of [0, 55, 12, 12.5, '30', null, undefined, NaN]) expect(normalizeAiSummaryRatio(bad), String(bad)).toBe(20);
  });

  it('persists a change and syncs it, normalised on apply', () => {
    useUiStore.getState().setAiSummaryRatio(40);
    expect(useUiStore.getState().aiSummaryRatio).toBe(40);
    expect(localStorage.getItem('frirss_aiSummaryRatio')).toBe('40');
    expect(UI_SYNC_KEYS).toContain('aiSummaryRatio');
    useUiStore.getState().applyServerPrefs({ aiSummaryRatio: 15 });
    expect(useUiStore.getState().aiSummaryRatio).toBe(15);
    useUiStore.getState().applyServerPrefs({ aiSummaryRatio: 999 });
    expect(useUiStore.getState().aiSummaryRatio).toBe(20);
    expect(localStorage.getItem('frirss_aiSummaryRatio')).toBe('20');
  });
});

describe('uiStore — routage des fournisseurs IA', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({
      aiPreferredProvider: null, aiFallback: true, aiAutoSummary: false, aiCategoryProviders: {}, feedSettings: {},
    });
  });

  it('normalises a provider id to a positive integer, null otherwise', () => {
    expect(normalizeAiProviderId(7)).toBe(7);
    for (const bad of [0, -1, 1.5, '7', null, undefined, NaN, Infinity]) expect(normalizeAiProviderId(bad), String(bad)).toBeNull();
  });

  it('keeps only non-empty names mapped to a valid provider id', () => {
    expect(normalizeAiCategoryProviders({ A: 2, B: -1, '': 3, C: 'x' })).toEqual({ A: 2 });
    for (const bad of [null, undefined, 'x', 4, [1, 2]]) expect(normalizeAiCategoryProviders(bad), String(bad)).toEqual({});
  });

  it('AI routing prefs: defaults, persistence, sync and normalisation', () => {
    const s = useUiStore.getState();
    expect([s.aiPreferredProvider, s.aiFallback, s.aiAutoSummary, s.aiCategoryProviders]).toEqual([null, true, false, {}]);
    for (const k of ['aiPreferredProvider', 'aiFallback', 'aiAutoSummary', 'aiCategoryProviders']) expect(UI_SYNC_KEYS).toContain(k);
    s.setAiCategoryProvider('Tech', 3); s.setAiCategoryProvider('News', 4); s.setAiCategoryProvider('News', null);
    expect(useUiStore.getState().aiCategoryProviders).toEqual({ Tech: 3 });
    expect(JSON.parse(localStorage.getItem('frirss_aiCategoryProviders')!)).toEqual({ Tech: 3 });
    s.applyServerPrefs({ aiPreferredProvider: '7', aiFallback: 'no', aiAutoSummary: true, aiCategoryProviders: { A: 2, B: -1, '': 3, C: 'x' } });
    const n = useUiStore.getState();
    expect([n.aiPreferredProvider, n.aiFallback, n.aiAutoSummary, n.aiCategoryProviders]).toEqual([null, true, true, { A: 2 }]);
  });

  it('turns auto-summary off for an account whose saved prefs predate it', () => {
    // Navigateur partagé : la valeur locale vient d'un autre compte, qui a vu
    // l'avertissement de coût ; celui-ci ne l'a jamais vu.
    useUiStore.getState().setAiAutoSummary(true);
    useUiStore.getState().applyServerPrefs({ viewMode: 'compact' });
    expect(useUiStore.getState().aiAutoSummary).toBe(false);
    expect(localStorage.getItem('frirss_aiAutoSummary')).toBe('false');
  });

  it('keeps auto-summary as the account saved it, and leaves it alone for an empty prefs object', () => {
    useUiStore.getState().setAiAutoSummary(true);
    useUiStore.getState().applyServerPrefs({});
    expect(useUiStore.getState().aiAutoSummary).toBe(true);
    useUiStore.getState().applyServerPrefs({ viewMode: 'compact', aiAutoSummary: true });
    expect(useUiStore.getState().aiAutoSummary).toBe(true);
  });

  it('persists the preferred provider, fallback and auto-summary through their setters', () => {
    const s = useUiStore.getState();
    s.setAiPreferredProvider(9); s.setAiFallback(false); s.setAiAutoSummary(true);
    const n = useUiStore.getState();
    expect([n.aiPreferredProvider, n.aiFallback, n.aiAutoSummary]).toEqual([9, false, true]);
    expect(localStorage.getItem('frirss_aiPreferredProvider')).toBe('9');
    expect(localStorage.getItem('frirss_aiFallback')).toBe('false');
    expect(localStorage.getItem('frirss_aiAutoSummary')).toBe('true');
    // A setter fed a bad id stores "no preference", not garbage.
    s.setAiPreferredProvider(-3);
    expect(useUiStore.getState().aiPreferredProvider).toBeNull();
  });

  it('clearing the preferred provider on one device reaches the others', () => {
    useUiStore.getState().setAiPreferredProvider(9);
    useUiStore.getState().applyServerPrefs({ aiPreferredProvider: null });
    expect(useUiStore.getState().aiPreferredProvider).toBeNull();
    expect(localStorage.getItem('frirss_aiPreferredProvider')).toBe('null');
  });

  it('per-feed AI provider is set and cleared through feedSettings', () => {
    useUiStore.getState().setFeedAiProvider('feed/1', 5);
    expect(useUiStore.getState().feedSettings['feed/1'].aiProvider).toBe(5);
    useUiStore.getState().setFeedAiProvider('feed/1', null);
    expect(useUiStore.getState().feedSettings['feed/1']).toBeUndefined();
  });
});

describe('uiStore — traduction IA et automatismes par flux', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({
      aiTranslationLanguage: 'ui', aiTranslationProvider: null, aiCategoryAutoTranslate: {}, aiCategoryAutoSummary: {},
      aiAutoTranslateConfirmed: false, aiAutoSummaryConfirmed: false, feedSettings: {},
    });
  });


  it('defaults, persistence and sync of the translation prefs', () => {
    const s = useUiStore.getState();
    expect([s.aiTranslationLanguage, s.aiTranslationProvider, s.aiCategoryAutoTranslate, s.aiCategoryAutoSummary,
      s.aiAutoTranslateConfirmed, s.aiAutoSummaryConfirmed]).toEqual(['ui', null, {}, {}, false, false]);
    for (const k of ['aiTranslationLanguage', 'aiTranslationProvider', 'aiCategoryAutoTranslate', 'aiCategoryAutoSummary',
      'aiAutoTranslateConfirmed', 'aiAutoSummaryConfirmed']) expect(UI_SYNC_KEYS).toContain(k);
    s.setAiTranslationLanguage('zh-Hant'); s.setAiTranslationProvider(4);
    // Comme le panneau : `false` est une valeur (éteint sous un global allumé), `null` retire l'entrée.
    s.setAiCategoryAutoTranslate('Tech', true); s.setAiCategoryAutoTranslate('News', false);
    s.setAiCategoryAutoTranslate('Old', true); s.setAiCategoryAutoTranslate('Old', null);
    s.setAiCategoryAutoSummary('Dev', true); s.setAiCategoryAutoSummary('Off', false);
    s.setAiAutoTranslateConfirmed(true); s.setAiAutoSummaryConfirmed(true);
    const n = useUiStore.getState();
    expect([n.aiTranslationLanguage, n.aiTranslationProvider, n.aiCategoryAutoTranslate, n.aiCategoryAutoSummary,
      n.aiAutoTranslateConfirmed, n.aiAutoSummaryConfirmed]).toEqual(['zh-Hant', 4, { Tech: true, News: false }, { Dev: true, Off: false }, true, true]);
    expect(localStorage.getItem('frirss_aiTranslationLanguage')).toBe('"zh-Hant"');
    expect(localStorage.getItem('frirss_aiTranslationProvider')).toBe('4');
    expect(JSON.parse(localStorage.getItem('frirss_aiCategoryAutoTranslate')!)).toEqual({ Tech: true, News: false });
    expect(localStorage.getItem('frirss_aiAutoTranslateConfirmed')).toBe('true');
    s.setAiTranslationLanguage('ru' as never);
    expect(useUiStore.getState().aiTranslationLanguage).toBe('ui');
  });

  it('normalises the translation prefs arriving from the server', () => {
    useUiStore.getState().applyServerPrefs({ aiTranslationLanguage: 'ru' });
    expect(useUiStore.getState().aiTranslationLanguage).toBe('ui');
    useUiStore.getState().applyServerPrefs({ aiTranslationLanguage: 'de', aiTranslationProvider: '3' });
    expect([useUiStore.getState().aiTranslationLanguage, useUiStore.getState().aiTranslationProvider]).toEqual(['de', null]);
    // `false` survit (catégorie éteinte sous un global allumé) ; le reste tombe. Un `true` d'avant reste valable.
    useUiStore.getState().applyServerPrefs({ aiCategoryAutoTranslate: { A: true, B: 'x', E: false }, aiCategoryAutoSummary: { C: true, D: 1, F: false } });
    expect(useUiStore.getState().aiCategoryAutoTranslate).toEqual({ A: true, E: false });
    expect(useUiStore.getState().aiCategoryAutoSummary).toEqual({ C: true, F: false });
  });

  it('clearing the translation provider on one device reaches the others', () => {
    useUiStore.getState().setAiTranslationProvider(9);
    useUiStore.getState().applyServerPrefs({ aiTranslationProvider: null });
    expect(useUiStore.getState().aiTranslationProvider).toBeNull();
    expect(localStorage.getItem('frirss_aiTranslationProvider')).toBe('null');
  });

  it('turns both confirmations off for an account whose saved prefs predate them', () => {
    useUiStore.getState().setAiAutoTranslateConfirmed(true);
    useUiStore.getState().setAiAutoSummaryConfirmed(true);
    useUiStore.getState().applyServerPrefs({ viewMode: 'compact' });
    expect(useUiStore.getState().aiAutoTranslateConfirmed).toBe(false);
    expect(useUiStore.getState().aiAutoSummaryConfirmed).toBe(false);
    expect(localStorage.getItem('frirss_aiAutoTranslateConfirmed')).toBe('false');
  });

  it('keeps the confirmations as the account saved them; a non-boolean or an empty object changes nothing', () => {
    useUiStore.getState().setAiAutoTranslateConfirmed(true);
    useUiStore.getState().applyServerPrefs({});
    expect(useUiStore.getState().aiAutoTranslateConfirmed).toBe(true);
    useUiStore.getState().applyServerPrefs({ aiAutoTranslateConfirmed: 'yes', aiAutoSummaryConfirmed: true });
    expect(useUiStore.getState().aiAutoTranslateConfirmed).toBe(true);
    expect(useUiStore.getState().aiAutoSummaryConfirmed).toBe(true);
  });

  // Navigateur partagé : la valeur locale peut venir d'un AUTRE compte. Un
  // compte qui porte des préférences sans la clé ne l'a jamais réglée : elle
  // repart éteinte. Un compte neuf (préférences vides) garde et pousse l'état
  // local — c'est la remise à zéro de la déconnexion (aiStore) qui le protège.
  for (const [key, lit] of [
    ['aiCategoryAutoTranslate', { Tech: true }],
    ['aiCategoryAutoSummary', { Tech: true }],
    ['aiCategoryProviders', { Tech: 3 }],
  ] as const) {
    it(`clears a local ${key} for an account whose saved prefs lack it`, () => {
      useUiStore.setState({ [key]: lit });
      useUiStore.getState().applyServerPrefs({ viewMode: 'compact' });
      expect(useUiStore.getState()[key]).toEqual({});
      expect(JSON.parse(localStorage.getItem(`frirss_${key}`)!)).toEqual({});
    });
    it(`keeps a local ${key} for a brand-new account (empty prefs)`, () => {
      useUiStore.setState({ [key]: lit });
      useUiStore.getState().applyServerPrefs({});
      expect(useUiStore.getState()[key]).toEqual(lit);
    });
  }
  for (const key of ['aiPreferredProvider', 'aiTranslationProvider'] as const) {
    it(`resets a local ${key} for an account whose saved prefs lack it`, () => {
      useUiStore.setState({ [key]: 3 });
      useUiStore.getState().applyServerPrefs({ viewMode: 'compact' });
      expect(useUiStore.getState()[key]).toBeNull();
      expect(localStorage.getItem(`frirss_${key}`)).toBe('null');
    });
    it(`keeps a local ${key} for a brand-new account (empty prefs), and the saved one otherwise`, () => {
      useUiStore.setState({ [key]: 3 });
      useUiStore.getState().applyServerPrefs({});
      expect(useUiStore.getState()[key]).toBe(3);
      useUiStore.getState().applyServerPrefs({ viewMode: 'compact', [key]: 5 });
      expect(useUiStore.getState()[key]).toBe(5);
    });
  }
  it('keeps the target language and the fallback for an account whose saved prefs lack them', () => {
    useUiStore.setState({ aiTranslationLanguage: 'de', aiFallback: false });
    useUiStore.getState().applyServerPrefs({ viewMode: 'compact' });
    expect([useUiStore.getState().aiTranslationLanguage, useUiStore.getState().aiFallback]).toEqual(['de', false]);
    useUiStore.setState({ aiFallback: true });
  });
  it('strips the local per-feed AI overrides for an account whose saved prefs lack feedSettings', () => {
    useUiStore.setState({ feedSettings: {
      'feed/1': { aiAutoTranslate: true, aiAutoSummary: true, aiProvider: 3, layout: 'grid' },
      'feed/2': { aiAutoTranslate: true },
    } });
    useUiStore.getState().applyServerPrefs({ viewMode: 'compact' });
    expect(useUiStore.getState().feedSettings).toEqual({ 'feed/1': { layout: 'grid' } });
    expect(JSON.parse(localStorage.getItem('frirss_feedSettings')!)).toEqual({ 'feed/1': { layout: 'grid' } });
  });
  it('takes the server feedSettings entirely when it has them, and keeps the local ones for a brand-new account', () => {
    const local = { 'feed/1': { aiAutoTranslate: true, layout: 'grid' } };
    useUiStore.setState({ feedSettings: local });
    useUiStore.getState().applyServerPrefs({});
    expect(useUiStore.getState().feedSettings).toEqual(local);
    useUiStore.getState().applyServerPrefs({ feedSettings: { 'feed/2': { aiAutoSummary: true } } });
    expect(useUiStore.getState().feedSettings).toEqual({ 'feed/2': { aiAutoSummary: true } });
  });

  it('per-feed automatic translate/summary keep an explicit false and are cleared with the empty string', () => {
    useUiStore.getState().setFeedAiAutoTranslate('feed/1', false);
    expect(useUiStore.getState().feedSettings['feed/1']).toEqual({ aiAutoTranslate: false });
    useUiStore.getState().setFeedAiAutoSummary('feed/1', true);
    expect(useUiStore.getState().feedSettings['feed/1']).toEqual({ aiAutoTranslate: false, aiAutoSummary: true });
    useUiStore.getState().setFeedAiAutoTranslate('feed/1', '');
    useUiStore.getState().setFeedAiAutoSummary('feed/1', '');
    expect(useUiStore.getState().feedSettings['feed/1']).toBeUndefined();
  });
});

describe('uiStore — panneau Résumé IA (toujours visible ou seulement avec un résumé)', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ aiPanelAlways: true, aiCategoryPanel: {}, feedSettings: {} });
  });

  it('normalises category booleans: both true and false are values, the rest is dropped', () => {
    expect(normalizeAiCategoryBooleans({ A: true, B: false, C: 'x', '': true, D: 1 })).toEqual({ A: true, B: false });
    for (const bad of [null, undefined, 'x', 4, [true]]) expect(normalizeAiCategoryBooleans(bad), String(bad)).toEqual({});
  });

  it('is visible by default, synced, and persisted through its setters', () => {
    const s = useUiStore.getState();
    expect([s.aiPanelAlways, s.aiCategoryPanel]).toEqual([true, {}]);
    for (const k of ['aiPanelAlways', 'aiCategoryPanel']) expect(UI_SYNC_KEYS).toContain(k);
    s.setAiPanelAlways(false);
    s.setAiCategoryPanel('Tech', true); s.setAiCategoryPanel('News', false); s.setAiCategoryPanel('Old', true); s.setAiCategoryPanel('Old', null);
    const n = useUiStore.getState();
    expect([n.aiPanelAlways, n.aiCategoryPanel]).toEqual([false, { Tech: true, News: false }]);
    expect(localStorage.getItem('frirss_aiPanelAlways')).toBe('false');
    expect(JSON.parse(localStorage.getItem('frirss_aiCategoryPanel')!)).toEqual({ Tech: true, News: false });
  });

  it('normalises the prefs arriving from the server', () => {
    useUiStore.getState().applyServerPrefs({ aiPanelAlways: false, aiCategoryPanel: { A: true, B: false, C: 'x' } });
    expect(useUiStore.getState().aiPanelAlways).toBe(false);
    expect(useUiStore.getState().aiCategoryPanel).toEqual({ A: true, B: false });
    useUiStore.getState().applyServerPrefs({ aiPanelAlways: 'no' });
    expect(useUiStore.getState().aiPanelAlways).toBe(false);
  });

  it('shows the panel again for an account whose saved prefs predate the setting', () => {
    useUiStore.getState().setAiPanelAlways(false);
    useUiStore.getState().applyServerPrefs({ viewMode: 'compact' });
    expect(useUiStore.getState().aiPanelAlways).toBe(true);
    expect(localStorage.getItem('frirss_aiPanelAlways')).toBe('true');
  });

  it('leaves the setting alone for a brand-new account (empty prefs)', () => {
    useUiStore.getState().setAiPanelAlways(false);
    useUiStore.getState().applyServerPrefs({});
    expect(useUiStore.getState().aiPanelAlways).toBe(false);
  });

  it('clears the local category choices for an account whose saved prefs lack them, keeps them for a new one', () => {
    useUiStore.setState({ aiCategoryPanel: { Tech: false } });
    useUiStore.getState().applyServerPrefs({});
    expect(useUiStore.getState().aiCategoryPanel).toEqual({ Tech: false });
    useUiStore.getState().applyServerPrefs({ viewMode: 'compact' });
    expect(useUiStore.getState().aiCategoryPanel).toEqual({});
    expect(JSON.parse(localStorage.getItem('frirss_aiCategoryPanel')!)).toEqual({});
  });

  it('per-feed panel keeps an explicit false and is cleared with the empty string', () => {
    useUiStore.getState().setFeedAiPanel('feed/1', false);
    expect(useUiStore.getState().feedSettings['feed/1']).toEqual({ aiPanel: false });
    useUiStore.getState().setFeedAiPanel('feed/1', true);
    expect(useUiStore.getState().feedSettings['feed/1']).toEqual({ aiPanel: true });
    useUiStore.getState().setFeedAiPanel('feed/1', '');
    expect(useUiStore.getState().feedSettings['feed/1']).toBeUndefined();
  });

  it('strips the per-feed panel for an account whose saved prefs lack feedSettings, and on sign-out', () => {
    useUiStore.setState({ feedSettings: { 'feed/1': { aiPanel: false, layout: 'grid' }, 'feed/2': { aiPanel: true } } });
    useUiStore.getState().applyServerPrefs({ viewMode: 'compact' });
    expect(useUiStore.getState().feedSettings).toEqual({ 'feed/1': { layout: 'grid' } });
    useUiStore.setState({ feedSettings: { 'feed/1': { aiPanel: false, layout: 'grid' } }, aiCategoryPanel: { Tech: false } });
    useUiStore.getState().forgetAiAccountChoices();
    expect(useUiStore.getState().feedSettings).toEqual({ 'feed/1': { layout: 'grid' } });
    expect(useUiStore.getState().aiCategoryPanel).toEqual({});
    expect(JSON.parse(localStorage.getItem('frirss_aiCategoryPanel')!)).toEqual({});
  });
});
