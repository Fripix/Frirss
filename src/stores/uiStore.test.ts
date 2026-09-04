// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore, UI_SYNC_KEYS } from './uiStore';

describe('uiStore', () => {
  beforeEach(() => localStorage.clear());

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
});
