// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLatchedValue } from './useLatchedValue';

const firstItems = (adopted: string[], latest: string[]) => !adopted.length && latest.length > 0;

function setup(initial: { value: string[]; key: string }) {
  return renderHook(({ value, key }) => useLatchedValue(value, [key], firstItems), { initialProps: initial });
}

describe('useLatchedValue', () => {
  it('starts with the current value', () => {
    const value = ['a'];
    const { result } = setup({ value, key: 'k1' });
    expect(result.current).toBe(value);
  });

  it('keeps the adopted value while only the value changes', () => {
    const first = ['a'];
    const { result, rerender } = setup({ value: first, key: 'k1' });
    rerender({ value: ['b'], key: 'k1' });
    expect(result.current).toBe(first);
    rerender({ value: [], key: 'k1' });
    expect(result.current).toBe(first);
  });

  it('adopts the latest value when a refresh dependency changes, in the same render', () => {
    const { result, rerender } = setup({ value: ['a'], key: 'k1' });
    rerender({ value: ['b'], key: 'k1' });
    const latest = ['c'];
    rerender({ value: latest, key: 'k2' });
    expect(result.current).toBe(latest);
    // …and holds it again afterwards.
    rerender({ value: ['d'], key: 'k2' });
    expect(result.current).toBe(latest);
  });

  it('adopts a change early when asked to (a missing value arrived)', () => {
    const { result, rerender } = setup({ value: [], key: 'k1' });
    const arrived = ['a'];
    rerender({ value: arrived, key: 'k1' });
    expect(result.current).toBe(arrived);
    rerender({ value: ['b'], key: 'k1' });
    expect(result.current).toBe(arrived);
  });

  it('tracks refresh dependencies even when the value did not change', () => {
    const value = ['a'];
    const { result, rerender } = setup({ value, key: 'k1' });
    rerender({ value, key: 'k2' });
    // A later background change must still wait for the next refresh.
    rerender({ value: ['b'], key: 'k2' });
    expect(result.current).toBe(value);
  });
});
