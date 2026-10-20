// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const store = vi.hoisted(() => ({
  selectedArticle: { id: 'a1', read: false, url: 'https://example.com/a' } as { id: string; read: boolean; url: string } | null,
  selectedFeed: null,
  articles: [],
  selectNextArticle: vi.fn(),
  selectPrevArticle: vi.fn(),
  selectArticle: vi.fn(),
  toggleRead: vi.fn(),
  toggleStar: vi.fn(),
  toggleReadLater: vi.fn(),
}));
vi.mock('../stores/feedStore', () => ({ useFeedStore: { getState: () => store } }));
vi.mock('../lib/openExternal', () => ({ openExternal: vi.fn() }));

import { useKeyboardNav } from './useKeyboardNav';
import { useUiStore } from '../stores/uiStore';
import { openExternal } from '../lib/openExternal';

function Harness() {
  useKeyboardNav();
  return null;
}

function press(init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init });
  window.dispatchEvent(e);
  return e;
}

describe('useKeyboardNav — the browser keeps its keys', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.getState().resetShortcuts();
    useUiStore.setState({ shortcutHelpOpen: false, commandPaletteOpen: false, sidebarVisible: true });
    store.selectedArticle = { id: 'a1', read: false, url: 'https://example.com/a' };
    vi.clearAllMocks();
    render(<Harness />);
  });
  afterEach(cleanup);

  it('handles a plain shortcut key', () => {
    const e = press({ key: 'r' });
    expect(store.toggleRead).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it.each([
    ['metaKey', 'r'], ['ctrlKey', 'r'], ['altKey', 'r'],
    ['metaKey', 'l'], ['ctrlKey', 'd'], ['ctrlKey', 'b'], ['metaKey', 'o'], ['ctrlKey', 'u'], ['metaKey', 'f'],
  ])('leaves %s+%s to the browser', (mod, key) => {
    const listener = vi.fn();
    window.addEventListener('frirss:open-search', listener);
    const sidebarBefore = useUiStore.getState().sidebarVisible;
    const e = press({ key, [mod]: true });
    window.removeEventListener('frirss:open-search', listener);
    expect(e.defaultPrevented).toBe(false);
    expect(store.toggleRead).not.toHaveBeenCalled();
    expect(store.toggleStar).not.toHaveBeenCalled();
    expect(store.toggleReadLater).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(useUiStore.getState().sidebarVisible).toBe(sidebarBefore);
  });

  it('leaves a modified arrow to the browser', () => {
    const e = press({ key: 'ArrowDown', altKey: true });
    expect(store.selectNextArticle).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it('leaves a modified ? to the browser', () => {
    const e = press({ key: '?', metaKey: true, shiftKey: true });
    expect(useUiStore.getState().shortcutHelpOpen).toBe(false);
    expect(e.defaultPrevented).toBe(false);
  });

  it.each(['d', 'l', 'o', 'b', '?'])('does not repeat the toggle on %j when the key is held', (key) => {
    const sidebarBefore = useUiStore.getState().sidebarVisible;
    const e = press({ key, repeat: true });
    expect(e.defaultPrevented).toBe(false);
    expect(store.toggleStar).not.toHaveBeenCalled();
    expect(store.toggleReadLater).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
    expect(useUiStore.getState().sidebarVisible).toBe(sidebarBefore);
    expect(useUiStore.getState().shortcutHelpOpen).toBe(false);
  });

  it('keeps moving through the list while an arrow is held', () => {
    press({ key: 'ArrowDown', repeat: true });
    press({ key: 'ArrowDown', repeat: true });
    expect(store.selectNextArticle).toHaveBeenCalledTimes(2);
  });

  it('still opens the palette on ⌘K', () => {
    const e = press({ key: 'k', metaKey: true });
    expect(useUiStore.getState().commandPaletteOpen).toBe(true);
    expect(e.defaultPrevented).toBe(true);
  });
});
