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

function press(key: string, target: EventTarget = document.body): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
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

  it('follows a reassigned key', () => {
    useUiStore.getState().setShortcut('summarize', 'z');
    renderHook(() => useKeyboardNav());
    press('s');
    expect(heard).toHaveLength(0);
    press('z');
    expect(heard).toHaveLength(1);
  });
});
