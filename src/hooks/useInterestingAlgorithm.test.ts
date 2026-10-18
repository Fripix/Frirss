// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { INTERESTING_ALGORITHM_STORAGE_KEY, readSavedInterestingAlgorithm, useInterestingAlgorithm } from './useInterestingAlgorithm';
import { INTERESTING_ALGORITHMS } from '../lib/intelligenceRanking';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('useInterestingAlgorithm', () => {
  it('defaults to the current algorithm', () => {
    const { result } = renderHook(() => useInterestingAlgorithm());
    expect(result.current[0]).toBe('current');
  });

  it('keeps every previously selectable choice, plus Intelligence Next', () => {
    for (const { value } of INTERESTING_ALGORITHMS) {
      localStorage.setItem(INTERESTING_ALGORITHM_STORAGE_KEY, value);
      expect(readSavedInterestingAlgorithm()).toBe(value);
    }
    expect(INTERESTING_ALGORITHMS.map((a) => a.value)).toEqual([
      'current', 'weighted-idf', 'synonyms', 'topics', 'combined', 'microsoft-news', 'personal-news', 'intelligence-next',
      'gdelt', 'gdelt-github', 'gdelt-hn', 'hn-lob', 'all-four', 'custom',
    ]);
  });

  it('falls back to the default for an unknown stored value', () => {
    localStorage.setItem(INTERESTING_ALGORITHM_STORAGE_KEY, 'removed-experiment');
    const { result } = renderHook(() => useInterestingAlgorithm());
    expect(result.current[0]).toBe('current');
  });

  it('persists a choice across a remount', () => {
    const first = renderHook(() => useInterestingAlgorithm());
    act(() => first.result.current[1]('intelligence-next'));
    expect(first.result.current[0]).toBe('intelligence-next');
    expect(localStorage.getItem(INTERESTING_ALGORITHM_STORAGE_KEY)).toBe('intelligence-next');
    first.unmount();
    const second = renderHook(() => useInterestingAlgorithm());
    expect(second.result.current[0]).toBe('intelligence-next');
  });

  it('ignores values that are not algorithms', () => {
    const { result } = renderHook(() => useInterestingAlgorithm());
    act(() => result.current[1]('topics'));
    act(() => result.current[1]('nope'));
    expect(result.current[0]).toBe('topics');
  });

  it('still works when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const { result } = renderHook(() => useInterestingAlgorithm());
    expect(result.current[0]).toBe('current');
    act(() => result.current[1]('combined'));
    expect(result.current[0]).toBe('combined');
  });
});
