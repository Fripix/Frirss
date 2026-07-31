// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useOnlineStatus } from './useOnlineStatus';

describe('useOnlineStatus', () => {
  it('reflects the initial navigator.onLine value', () => {
    const { result, unmount } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(navigator.onLine);
    unmount();
  });

  it('goes false on an offline event and true again on online', () => {
    const { result, unmount } = renderHook(() => useOnlineStatus());

    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(result.current).toBe(false);

    act(() => { window.dispatchEvent(new Event('online')); });
    expect(result.current).toBe(true);

    unmount();
  });

  it('stops reacting to events after unmount', () => {
    const { result, unmount } = renderHook(() => useOnlineStatus());
    unmount();
    // No throw, and the (detached) value stays at its last state.
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(result.current).toBe(true);
  });
});
