// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore, UI_SYNC_KEYS, MAX_TOASTS } from './uiStore';

describe('toasts', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ toasts: [] });
  });

  it('starts empty', () => {
    expect(useUiStore.getState().toasts).toEqual([]);
  });

  it('keeps the message it was given', () => {
    useUiStore.getState().pushToast('47 articles marked read');
    const [toast] = useUiStore.getState().toasts;
    expect(toast.message).toBe('47 articles marked read');
  });

  it('gives every toast its own id, so two identical messages both show', () => {
    const a = useUiStore.getState().pushToast('Copied');
    const b = useUiStore.getState().pushToast('Copied');
    expect(a).not.toBe(b);
    expect(useUiStore.getState().toasts).toHaveLength(2);
  });

  it('drops the oldest past the cap rather than stacking to the top of the screen', () => {
    for (let i = 0; i < MAX_TOASTS + 2; i++) useUiStore.getState().pushToast(`n${i}`);
    const { toasts } = useUiStore.getState();
    expect(toasts).toHaveLength(MAX_TOASTS);
    expect(toasts[0].message).toBe('n2');
  });

  it('dismisses by id and leaves the others alone', () => {
    const a = useUiStore.getState().pushToast('a');
    useUiStore.getState().pushToast('b');
    useUiStore.getState().dismissToast(a);
    expect(useUiStore.getState().toasts.map((t) => t.message)).toEqual(['b']);
  });

  it('ignores a dismiss for an id that is already gone', () => {
    const a = useUiStore.getState().pushToast('a');
    useUiStore.getState().dismissToast(a);
    expect(() => useUiStore.getState().dismissToast(a)).not.toThrow();
    expect(useUiStore.getState().toasts).toEqual([]);
  });

  it('carries an optional action', () => {
    let ran = false;
    useUiStore.getState().pushToast('Feed removed', {
      action: { label: 'Undo', run: () => { ran = true; } },
    });
    useUiStore.getState().toasts[0].action?.run();
    expect(ran).toBe(true);
  });

  it('is never synced to the server or written to storage', () => {
    // A transient message is not a preference. Syncing it would replay a
    // stale notification on another device.
    expect(UI_SYNC_KEYS).not.toContain('toasts');
    useUiStore.getState().pushToast('a');
    expect(localStorage.getItem('frirss_toasts')).toBeNull();
  });
});
