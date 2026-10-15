// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Article, Subscription } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('../../api/intelligence', () => ({
  getArticleFeedback: vi.fn(() => Promise.resolve([])),
  setArticleFeedback: vi.fn(() => Promise.resolve()),
  removeArticleFeedback: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../lib/intelligenceRanking', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/intelligenceRanking')>();
  return { ...real, rankInterestingArticles: vi.fn(real.rankInterestingArticles) };
});

import ArticleList from './ArticleList';
import { useFeedStore } from '../../stores/feedStore';
import { useUiStore } from '../../stores/uiStore';
import { rankInterestingArticles, type SavedArticleSignal } from '../../lib/intelligenceRanking';
import { INTERESTING_ALGORITHM_STORAGE_KEY } from '../../hooks/useInterestingAlgorithm';
import { INTELLIGENCE_FEEDBACK_CHANGED } from '../../hooks/useIntelligenceFeedback';
import { getArticleFeedback, type ArticleFeedback } from '../../api/intelligence';

const article = (id: string, title: string, sourceId = 'feed/a'): Article => ({
  id, title, summary: title, content: `<p>${title}</p>`, author: '', url: `https://example.com/${id}`,
  source: sourceId, sourceId, published: Date.now(), read: false, starred: false, labels: [], tags: [],
});
const feeds = [
  { id: 'feed/a', title: 'Alpha', url: 'https://alpha.example/feed.xml', htmlUrl: 'https://alpha.example/' },
  { id: 'feed/b', title: 'Beta' },
] as Subscription[];
const ranker = vi.mocked(rankInterestingArticles);
const initial = { feed: useFeedStore.getState(), ui: useUiStore.getState() };
const signal = (id: string): SavedArticleSignal => ({ id, title: `Saved ${id}`, summary: '', content: '', sourceId: 'feed/a', starred: true, readLater: false });
const contextOfCall = (call: number) => ranker.mock.calls.at(call)![4]!;

function show(filter: 'interesting' | 'all', layoutMode: 'desktop' | 'mobile', savedArticleSignals: SavedArticleSignal[] | null = []) {
  useUiStore.setState({ layoutMode });
  useFeedStore.setState({
    filter,
    loading: false,
    articles: [article('1', 'Rust compiler'), article('2', 'Garden tips', 'feed/b')],
    subscriptions: feeds,
    savedArticleSignals,
    selectedFeed: null,
    searchQuery: '',
  });
  return render(<ArticleList />);
}

beforeEach(() => {
  ranker.mockClear();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  useFeedStore.setState(initial.feed, true);
  useUiStore.setState(initial.ui, true);
  localStorage.clear();
});

describe('ArticleList — Interesting algorithm choice', () => {
  it('desktop: the toolbar offers Intelligence Next and remembers the choice', () => {
    show('interesting', 'desktop');
    const select = screen.getByRole('combobox', { name: 'articleList.rankingAlgorithmLabel' }) as HTMLSelectElement;
    expect(select.value).toBe('current');
    expect([...select.options].map((o) => o.value)).toContain('intelligence-next');
    fireEvent.change(select, { target: { value: 'intelligence-next' } });
    expect(localStorage.getItem(INTERESTING_ALGORITHM_STORAGE_KEY)).toBe('intelligence-next');
    expect(ranker).toHaveBeenLastCalledWith(
      expect.any(Array), expect.any(Array), expect.any(Number), 'intelligence-next',
      expect.objectContaining({
        subscriptions: [
          // The URLs let it group feeds by publisher.
          { id: 'feed/a', title: 'Alpha', categories: [], url: 'https://alpha.example/feed.xml', htmlUrl: 'https://alpha.example/' },
          { id: 'feed/b', title: 'Beta', categories: [] },
        ],
        savedArticles: [],
      }),
    );
  });

  it('mobile: the View options sheet offers the same choice', () => {
    localStorage.setItem(INTERESTING_ALGORITHM_STORAGE_KEY, 'personal-news');
    show('interesting', 'mobile');
    expect(screen.queryByRole('combobox', { name: 'articleList.rankingAlgorithmLabel' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'articleList.viewOptions' }));
    const select = screen.getByRole('combobox', { name: 'articleList.rankingAlgorithmLabel' }) as HTMLSelectElement;
    expect(select.value).toBe('personal-news');
    expect([...select.options].map((o) => o.textContent)).toContain('Intelligence Next');
  });

  it('existing algorithms get no context, so polls and feed edits do not re-rank them', () => {
    show('interesting', 'desktop');
    expect(ranker).toHaveBeenCalledTimes(1);
    expect(ranker.mock.calls[0][4]).toEqual({});
    act(() => {
      useFeedStore.setState({
        subscriptions: [...feeds, { id: 'feed/c', title: 'Gamma' } as Subscription],
        savedArticleSignals: [{ id: 'x', title: 'Saved', summary: '', content: '', sourceId: 'feed/a', starred: true, readLater: false }],
      });
    });
    expect(ranker).toHaveBeenCalledTimes(1);
  });

  it('Intelligence Next adopts background context changes at the next re-rank, not mid-read', () => {
    localStorage.setItem(INTERESTING_ALGORITHM_STORAGE_KEY, 'intelligence-next');
    show('interesting', 'desktop', null);
    expect(ranker).toHaveBeenCalledTimes(1);
    expect(contextOfCall(0).savedArticles).toEqual([]);
    // A refresh that only rebuilds the subscription objects changes nothing.
    act(() => { useFeedStore.setState({ subscriptions: feeds.map((feed) => ({ ...feed })) }); });
    expect(ranker).toHaveBeenCalledTimes(1);
    // A new subscription waits: the list on screen keeps its order.
    const gamma = { id: 'feed/c', title: 'Gamma' } as Subscription;
    act(() => { useFeedStore.setState({ subscriptions: [...feeds, gamma] }); });
    expect(ranker).toHaveBeenCalledTimes(1);
    // The first favourites snapshot to load is used right away, with the latest subscriptions.
    act(() => { useFeedStore.setState({ savedArticleSignals: [signal('x')] }); });
    expect(ranker).toHaveBeenCalledTimes(2);
    expect(contextOfCall(1).savedArticles).toEqual([signal('x')]);
    expect(contextOfCall(1).subscriptions?.map((feed) => feed.id)).toEqual(['feed/a', 'feed/b', 'feed/c']);
    // A later poll that changes the favourites waits as well…
    act(() => { useFeedStore.setState({ savedArticleSignals: [signal('x'), signal('y')] }); });
    expect(ranker).toHaveBeenCalledTimes(2);
    // …until the articles change, which re-ranks with everything current.
    act(() => { useFeedStore.setState({ articles: [...useFeedStore.getState().articles, article('3', 'Telescope news', 'feed/c')] }); });
    expect(ranker).toHaveBeenCalledTimes(3);
    expect(contextOfCall(2).savedArticles?.map((saved) => saved.id)).toEqual(['x', 'y']);
  });

  it('a background reload that only renews an undated article\'s placeholder time does not re-rank', () => {
    localStorage.setItem(INTERESTING_ALGORITHM_STORAGE_KEY, 'intelligence-next');
    useUiStore.setState({ layoutMode: 'desktop' });
    const undated = (published: number): Article => ({ ...article('u', 'Undated note', 'feed/b'), published, publishedMissing: true });
    useFeedStore.setState({
      filter: 'interesting', loading: false, selectedFeed: null, searchQuery: '', savedArticleSignals: [], subscriptions: feeds,
      articles: [article('1', 'Rust compiler'), undated(1_000)],
    });
    render(<ArticleList />);
    expect(ranker).toHaveBeenCalledTimes(1);
    // silentRefresh re-normalises the page: new objects, and \`published\` = load time again.
    act(() => { useFeedStore.setState({ articles: [{ ...useFeedStore.getState().articles[0] }, undated(2_000)] }); });
    expect(ranker).toHaveBeenCalledTimes(1);
    // A dated article whose date changes is still a change.
    act(() => { useFeedStore.setState({ articles: [{ ...useFeedStore.getState().articles[0], published: 3_000 }, undated(3_000)] }); });
    expect(ranker).toHaveBeenCalledTimes(2);
  });

  it('Intelligence Next applies a first star at the next vote, not as soon as it is polled', async () => {
    localStorage.setItem(INTERESTING_ALGORITHM_STORAGE_KEY, 'intelligence-next');
    show('interesting', 'desktop', []); // loaded: the reader has no favourites yet
    await act(async () => {}); // let the initial feedback request settle
    const calls = ranker.mock.calls.length;
    act(() => { useFeedStore.setState({ savedArticleSignals: [signal('x')] }); });
    expect(ranker).toHaveBeenCalledTimes(calls);
    const upvote: ArticleFeedback = { articleId: '1', url: '', title: 'Rust compiler', summary: '', content: '', sourceId: 'feed/a', vote: 1 };
    vi.mocked(getArticleFeedback).mockResolvedValueOnce([upvote]);
    await act(async () => { window.dispatchEvent(new Event(INTELLIGENCE_FEEDBACK_CHANGED)); });
    expect(ranker).toHaveBeenCalledTimes(calls + 1);
    expect(ranker.mock.calls.at(-1)![1]).toEqual([upvote]);
    expect(contextOfCall(-1).savedArticles?.map((saved) => saved.id)).toEqual(['x']);
  });

  it('Intelligence Next uses subscriptions as soon as they first arrive', () => {
    localStorage.setItem(INTERESTING_ALGORITHM_STORAGE_KEY, 'intelligence-next');
    useUiStore.setState({ layoutMode: 'desktop' });
    useFeedStore.setState({
      filter: 'interesting', loading: false, selectedFeed: null, searchQuery: '', savedArticleSignals: [],
      articles: [article('1', 'Rust compiler'), article('2', 'Garden tips', 'feed/b')],
      subscriptions: [],
    });
    render(<ArticleList />);
    expect(ranker).toHaveBeenCalledTimes(1);
    expect(ranker.mock.calls[0][4]?.subscriptions).toEqual([]);
    act(() => { useFeedStore.setState({ subscriptions: feeds }); });
    expect(ranker).toHaveBeenCalledTimes(2);
    expect(ranker.mock.calls[1][4]?.subscriptions?.map((feed) => feed.id)).toEqual(['feed/a', 'feed/b']);
  });

  it('other views neither rank nor show the selector', () => {
    show('all', 'desktop');
    expect(ranker).not.toHaveBeenCalled();
    expect(screen.queryByRole('combobox', { name: 'articleList.rankingAlgorithmLabel' })).toBeNull();
  });
});
