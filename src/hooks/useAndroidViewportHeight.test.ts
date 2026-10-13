// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAndroidViewportHeight, APP_HEIGHT_VAR } from './useAndroidViewportHeight';

const ANDROID = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/145.0.0.0 Mobile Safari/537.36';
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

const read = () => document.documentElement.style.getPropertyValue(APP_HEIGHT_VAR);

afterEach(() => {
  document.documentElement.style.removeProperty(APP_HEIGHT_VAR);
});

describe('useAndroidViewportHeight', () => {
  it('publishes innerHeight as a CSS variable on Android and follows resizes', () => {
    Object.defineProperty(window, 'innerHeight', { value: 890, configurable: true, writable: true });
    const { unmount } = renderHook(() => useAndroidViewportHeight(ANDROID));
    expect(read()).toBe('890px');

    act(() => {
      window.innerHeight = 412;
      window.dispatchEvent(new Event('resize'));
    });
    expect(read()).toBe('412px');

    unmount();
    expect(read()).toBe('');
  });

  it('does nothing off Android: iOS keeps its stylesheet units', () => {
    Object.defineProperty(window, 'innerHeight', { value: 890, configurable: true, writable: true });
    const { unmount } = renderHook(() => useAndroidViewportHeight(IOS));
    expect(read()).toBe('');
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(read()).toBe('');
    unmount();
  });
});
