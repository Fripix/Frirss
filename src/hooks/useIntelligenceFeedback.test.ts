// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ArticleFeedback } from '../api/intelligence';

const getArticleFeedback = vi.fn<() => Promise<ArticleFeedback[]>>();
vi.mock('../api/intelligence', () => ({ getArticleFeedback: () => getArticleFeedback() }));

import { INTELLIGENCE_FEEDBACK_CHANGED, useIntelligenceFeedback } from './useIntelligenceFeedback';

function deferred() {
  let resolve!: (rows: ArticleFeedback[]) => void;
  const promise = new Promise<ArticleFeedback[]>((done) => { resolve = done; });
  return { promise, resolve };
}

const vote = (articleId: string, value: 1 | -1): ArticleFeedback => ({
  articleId, url: '', title: articleId, summary: '', content: '', sourceId: 'feed/1', vote: value,
});

afterEach(() => { getArticleFeedback.mockReset(); });

describe('useIntelligenceFeedback', () => {
  it('loads votes on mount and refetches when a vote changes', async () => {
    getArticleFeedback.mockResolvedValueOnce([vote('a', 1)]).mockResolvedValueOnce([vote('a', -1)]);
    const { result, unmount } = renderHook(() => useIntelligenceFeedback());
    await act(async () => {});
    expect(result.current).toEqual([vote('a', 1)]);

    await act(async () => { window.dispatchEvent(new Event(INTELLIGENCE_FEEDBACK_CHANGED)); });
    expect(result.current).toEqual([vote('a', -1)]);
    unmount();
  });

  it('ignores an older response that arrives after a newer one', async () => {
    const initial = deferred();
    const afterVote = deferred();
    const afterUndo = deferred();
    getArticleFeedback
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(afterVote.promise)
      .mockReturnValueOnce(afterUndo.promise);
    const { result, unmount } = renderHook(() => useIntelligenceFeedback());
    act(() => {
      window.dispatchEvent(new Event(INTELLIGENCE_FEEDBACK_CHANGED)); // vote saved
      window.dispatchEvent(new Event(INTELLIGENCE_FEEDBACK_CHANGED)); // vote undone
    });

    await act(async () => { afterUndo.resolve([]); });
    await act(async () => { afterVote.resolve([vote('a', 1)]); });
    await act(async () => { initial.resolve([vote('stale', -1)]); });

    expect(result.current).toEqual([]);
    unmount();
  });

  it('keeps the last good snapshot when a refetch fails', async () => {
    getArticleFeedback.mockResolvedValueOnce([vote('a', 1)]).mockRejectedValueOnce(new Error('offline'));
    const { result, unmount } = renderHook(() => useIntelligenceFeedback());
    await act(async () => {});
    await act(async () => { window.dispatchEvent(new Event(INTELLIGENCE_FEEDBACK_CHANGED)); });
    expect(result.current).toEqual([vote('a', 1)]);
    unmount();
  });
});
