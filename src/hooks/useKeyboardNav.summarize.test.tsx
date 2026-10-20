// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useKeyboardNav } from './useKeyboardNav';
import { useUiStore } from '../stores/uiStore';
import { useFeedStore } from '../stores/feedStore';
import { useAiStore } from '../stores/aiStore';

const provider = { id: 1, name: 'P', type: 'openai' as const, hasAdminKey: false, shared: false, hasUserKey: false, available: true };
const ON = { enabled: true, providers: [provider], userKeysAllowed: false, dailyCap: 0, usageToday: 0, defaultProvider: 1 };
const article = { id: 'a1', title: 'T', read: true } as never;

let heard: Event[];
const listener = (e: Event) => { heard.push(e); };

beforeEach(() => {
  heard = [];
  window.addEventListener('frirss:ai-summarize', listener);
  useAiStore.setState({ config: ON });
  useFeedStore.setState({ selectedArticle: article });
  useUiStore.setState({ shortcuts: { ...useUiStore.getState().shortcuts, summarize: 's' } });
});
afterEach(() => { window.removeEventListener('frirss:ai-summarize', listener); cleanup(); });

function press(key: string, target: EventTarget = document.body, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

describe('useKeyboardNav — summarize', () => {
  it('broadcasts the event and swallows the key when AI is usable and an article is open', () => {
    renderHook(() => useKeyboardNav());
    const e = press('s');
    expect(heard).toHaveLength(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it('lets the key through untouched when AI is off', () => {
    useAiStore.setState({ config: { ...ON, enabled: false } });
    renderHook(() => useKeyboardNav());
    const e = press('s');
    expect(heard).toHaveLength(0);
    expect(e.defaultPrevented).toBe(false);
  });

  it('lets the key through untouched when no provider is usable', () => {
    useAiStore.setState({ config: { ...ON, providers: [{ ...provider, available: false }] } });
    renderHook(() => useKeyboardNav());
    const e = press('s');
    expect(heard).toHaveLength(0);
    expect(e.defaultPrevented).toBe(false);
  });

  it('lets the key through untouched when no article is open', () => {
    useFeedStore.setState({ selectedArticle: null });
    renderHook(() => useKeyboardNav());
    const e = press('s');
    expect(heard).toHaveLength(0);
    expect(e.defaultPrevented).toBe(false);
  });

  it('ignores the key while typing in a field', () => {
    renderHook(() => useKeyboardNav());
    const input = document.createElement('input');
    document.body.appendChild(input);
    press('s', input);
    input.remove();
    expect(heard).toHaveLength(0);
  });

  it('ignores the key on a focused select (type-ahead in a list of providers)', () => {
    renderHook(() => useKeyboardNav());
    const select = document.createElement('select');
    document.body.appendChild(select);
    const e = press('s', select);
    select.remove();
    expect(heard).toHaveLength(0);
    expect(e.defaultPrevented).toBe(false);
  });

  it('ignores the key, and every other shortcut, while a dialog is open', () => {
    renderHook(() => useKeyboardNav());
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    const selectNextArticle = useFeedStore.getState().selectNextArticle;
    let moved = 0;
    useFeedStore.setState({ selectNextArticle: () => { moved++; } } as never);
    const e = press('s');
    press(useUiStore.getState().shortcuts.nextArticle);
    dialog.remove();
    useFeedStore.setState({ selectNextArticle } as never);
    expect(heard).toHaveLength(0);
    expect(moved).toBe(0);
    expect(e.defaultPrevented).toBe(false);
  });

  it('still works from a focused toolbar button outside any dialog', () => {
    renderHook(() => useKeyboardNav());
    const button = document.createElement('button');
    document.body.appendChild(button);
    press('s', button);
    button.remove();
    expect(heard).toHaveLength(1);
  });

  it('follows a reassigned key', () => {
    useUiStore.getState().setShortcut('summarize', 'z');
    renderHook(() => useKeyboardNav());
    press('s');
    expect(heard).toHaveLength(0);
    press('z');
    expect(heard).toHaveLength(1);
  });

  it.each([
    ['Cmd+S', { metaKey: true }],
    ['Ctrl+S', { ctrlKey: true }],
    ['Alt+S', { altKey: true }],
  ] as const)('leaves %s to the browser: no summary, no preventDefault', (_label, init) => {
    renderHook(() => useKeyboardNav());
    const e = press('s', document.body, init);
    expect(heard).toHaveLength(0);
    expect(e.defaultPrevented).toBe(false);
  });

  it('ignores an auto-repeated keydown (key held down)', () => {
    renderHook(() => useKeyboardNav());
    const e = press('s', document.body, { repeat: true });
    expect(heard).toHaveLength(0);
    expect(e.defaultPrevented).toBe(false);
  });
});
