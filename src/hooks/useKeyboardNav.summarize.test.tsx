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

  // Le menu « Traduire en… » / « Résumer avec… » est un `role="menu"`, pas
  // une boîte : `t` y lançait une traduction payante derrière le menu, `s` un
  // résumé, et j/k changeaient l'article sous le menu ouvert.
  it('stays silent, every shortcut included, while focus is on an item of an open menu', () => {
    renderHook(() => useKeyboardNav());
    let translated = 0;
    const onTranslate = () => { translated++; };
    window.addEventListener('frirss:ai-translate', onTranslate);
    useUiStore.setState({ shortcuts: { ...useUiStore.getState().shortcuts, translate: 't' } });
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    const item = document.createElement('button');
    item.setAttribute('role', 'menuitem');
    menu.appendChild(item);
    document.body.appendChild(menu);
    const selectNextArticle = useFeedStore.getState().selectNextArticle;
    let moved = 0;
    useFeedStore.setState({ selectNextArticle: () => { moved++; } } as never);
    const s = press('s', item);
    const t = press('t', item);
    press(useUiStore.getState().shortcuts.nextArticle, item);
    menu.remove();
    useFeedStore.setState({ selectNextArticle } as never);
    window.removeEventListener('frirss:ai-translate', onTranslate);
    expect(heard).toHaveLength(0);
    expect(translated).toBe(0);
    expect(moved).toBe(0);
    expect(s.defaultPrevented).toBe(false);
    expect(t.defaultPrevented).toBe(false);
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

// `t` partage la garde de `s` : même appel peut-être payant, mêmes conflits
// (⌘T / Ctrl+T ouvrent un onglet, et ne doivent ni être bloqués ni traduire).
describe('useKeyboardNav — translate', () => {
  let translated: Event[];
  const onTranslate = (e: Event) => { translated.push(e); };
  beforeEach(() => {
    translated = [];
    window.addEventListener('frirss:ai-translate', onTranslate);
    useUiStore.setState({ shortcuts: { ...useUiStore.getState().shortcuts, translate: 't' } });
  });
  afterEach(() => { window.removeEventListener('frirss:ai-translate', onTranslate); });

  it('broadcasts the translate event, and only it, when AI is usable and an article is open', () => {
    renderHook(() => useKeyboardNav());
    const e = press('t');
    expect(translated).toHaveLength(1);
    expect(heard).toHaveLength(0);
    expect(e.defaultPrevented).toBe(true);
  });

  it.each([
    ['AI off', () => useAiStore.setState({ config: { ...ON, enabled: false } })],
    ['no usable provider', () => useAiStore.setState({ config: { ...ON, providers: [{ ...provider, available: false }] } })],
    ['no open article', () => useFeedStore.setState({ selectedArticle: null })],
  ] as const)('lets the key through untouched with %s', (_label, setup) => {
    setup();
    renderHook(() => useKeyboardNav());
    const e = press('t');
    expect(translated).toHaveLength(0);
    expect(e.defaultPrevented).toBe(false);
  });

  it.each([
    ['Cmd+T', { metaKey: true }],
    ['Ctrl+T', { ctrlKey: true }],
    ['Alt+T', { altKey: true }],
    ['a held key', { repeat: true }],
  ] as const)('leaves %s alone: no translation, no preventDefault', (_label, init) => {
    renderHook(() => useKeyboardNav());
    const e = press('t', document.body, init);
    expect(translated).toHaveLength(0);
    expect(e.defaultPrevented).toBe(false);
  });

  it.each(['input', 'textarea', 'select'])('ignores the key on a focused %s', (tag) => {
    renderHook(() => useKeyboardNav());
    const el = document.createElement(tag);
    document.body.appendChild(el);
    const e = press('t', el);
    el.remove();
    expect(translated).toHaveLength(0);
    expect(e.defaultPrevented).toBe(false);
  });

  it('ignores the key while a dialog is open', () => {
    renderHook(() => useKeyboardNav());
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    const e = press('t');
    dialog.remove();
    expect(translated).toHaveLength(0);
    expect(e.defaultPrevented).toBe(false);
  });

  it('follows a reassigned key', () => {
    useUiStore.getState().setShortcut('translate', 'y');
    renderHook(() => useKeyboardNav());
    press('t');
    expect(translated).toHaveLength(0);
    press('y');
    expect(translated).toHaveLength(1);
    useUiStore.getState().setShortcut('translate', 't');
  });
});
