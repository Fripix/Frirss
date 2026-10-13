import { describe, it, expect } from 'vitest';
import { countNewInView, viewFeedIds, type ViewDescriptor } from './newArticles';

const subs = [
  { id: 'feed/A', categories: [{ id: 'user/-/label/Tech' }] },
  { id: 'feed/B', categories: [{ id: 'user/-/label/News' }] },
  { id: 'feed/C' },
];

const view = (over: Partial<ViewDescriptor> = {}): ViewDescriptor => ({
  feedId: null,
  filter: 'all',
  searching: false,
  ...over,
});

describe('viewFeedIds', () => {
  it('home view, all or unread: every subscription', () => {
    expect(viewFeedIds(view(), subs)).toEqual(['feed/A', 'feed/B', 'feed/C']);
    expect(viewFeedIds(view({ filter: 'unread' }), subs)).toEqual(['feed/A', 'feed/B', 'feed/C']);
  });

  it('a feed: that feed only', () => {
    expect(viewFeedIds(view({ feedId: 'feed/B', filter: 'unread' }), subs)).toEqual(['feed/B']);
  });

  it('a category: the feeds filed under it', () => {
    expect(viewFeedIds(view({ feedId: 'user/-/label/Tech' }), subs)).toEqual(['feed/A']);
  });

  it('a label no feed is filed under: no pill', () => {
    expect(viewFeedIds(view({ feedId: 'user/-/label/Later' }), subs)).toBeNull();
  });

  it('favourites and read later: no pill, even with a feed selected', () => {
    for (const filter of ['starred', 'readlater'] as const) {
      expect(viewFeedIds(view({ filter }), subs)).toBeNull();
      expect(viewFeedIds(view({ filter, feedId: 'feed/A' }), subs)).toBeNull();
    }
  });

  it('a search: no pill', () => {
    expect(viewFeedIds(view({ searching: true }), subs)).toBeNull();
    expect(viewFeedIds(view({ searching: true, feedId: 'feed/A' }), subs)).toBeNull();
  });

  it('any other stream: no pill', () => {
    expect(viewFeedIds(view({ feedId: 'user/-/state/com.google/starred' }), subs)).toBeNull();
  });
});

describe('countNewInView', () => {
  it('adds the arrivals of the feeds in view and ignores the others', () => {
    expect(countNewInView({ 'feed/A': 2, 'feed/B': 5, 'feed/C': 1 }, ['feed/A', 'feed/C'])).toBe(3);
  });

  it('is zero without arrivals or without feeds', () => {
    expect(countNewInView({}, ['feed/A'])).toBe(0);
    expect(countNewInView({ 'feed/A': 2 }, [])).toBe(0);
  });
});

describe('viewFeedIds — visibilité FreshRSS', () => {
  it("sur l'accueil, écarte les flux limités à leur catégorie ou à leur propre vue", () => {
    const subs = [
      { id: 'feed/A', priority: 'main' as const },
      { id: 'feed/B', priority: 'category' as const },
      { id: 'feed/C', priority: 'feed' as const },
      { id: 'feed/D', priority: 'important' as const },
    ];
    expect(viewFeedIds({ feedId: null, filter: 'all', searching: false }, subs)).toEqual(['feed/A', 'feed/D']);
  });

  it('dans une catégorie, garde ses flux « catégorie seulement »', () => {
    const subs = [
      { id: 'feed/A', priority: 'main' as const, categories: [{ id: 'user/-/label/X' }] },
      { id: 'feed/B', priority: 'category' as const, categories: [{ id: 'user/-/label/X' }] },
    ];
    expect(viewFeedIds({ feedId: 'user/-/label/X', filter: 'all', searching: false }, subs)).toEqual(['feed/A', 'feed/B']);
  });
});
