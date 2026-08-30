// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  addToHistory,
  loadSearchHistory,
  rememberSearch,
  forgetSearch,
  MAX_SEARCH_HISTORY,
} from './searchHistory';

describe('addToHistory', () => {
  it('puts the newest query first', () => {
    expect(addToHistory(['old'], 'new')).toEqual(['new', 'old']);
  });

  it('moves a repeated query back to the front instead of duplicating it', () => {
    expect(addToHistory(['b', 'a'], 'a')).toEqual(['a', 'b']);
  });

  it('treats case and surrounding spaces as the same query', () => {
    expect(addToHistory(['FreshRSS'], '  freshrss ')).toEqual(['freshrss']);
  });

  it('caps the list', () => {
    const long = Array.from({ length: MAX_SEARCH_HISTORY + 3 }, (_, i) => `q${i}`);
    expect(addToHistory(long, 'new')).toHaveLength(MAX_SEARCH_HISTORY);
  });

  it('ignores an empty query rather than storing a blank entry', () => {
    expect(addToHistory(['a'], '   ')).toEqual(['a']);
    expect(addToHistory(['a'], '')).toEqual(['a']);
  });
});

describe('stored history', () => {
  beforeEach(() => localStorage.clear());

  it('is empty for a server that has never been searched', () => {
    expect(loadSearchHistory('7')).toEqual([]);
  });

  it('round-trips through storage', () => {
    rememberSearch('7', 'kernel');
    expect(loadSearchHistory('7')).toEqual(['kernel']);
  });

  it('keeps servers apart', () => {
    // Feeds differ per server, so a query that made sense on one is noise on
    // the next.
    rememberSearch('7', 'kernel');
    rememberSearch('8', 'recipes');
    expect(loadSearchHistory('7')).toEqual(['kernel']);
    expect(loadSearchHistory('8')).toEqual(['recipes']);
  });

  it('forgets a single entry', () => {
    rememberSearch('7', 'a');
    rememberSearch('7', 'b');
    forgetSearch('7', 'a');
    expect(loadSearchHistory('7')).toEqual(['b']);
  });

  it('survives a corrupted entry rather than throwing', () => {
    localStorage.setItem('frirss_searchHistory_7', '{not json');
    expect(loadSearchHistory('7')).toEqual([]);
  });

  it('ignores a stored value that is not a list of strings', () => {
    localStorage.setItem('frirss_searchHistory_7', '{"a":1}');
    expect(loadSearchHistory('7')).toEqual([]);
    localStorage.setItem('frirss_searchHistory_7', '[1,2,null]');
    expect(loadSearchHistory('7')).toEqual([]);
  });

  it('treats a numeric and a string server id as the same server', () => {
    // `activeServerId` is a string in some paths and a number in others.
    rememberSearch(7, 'kernel');
    expect(loadSearchHistory('7')).toEqual(['kernel']);
  });

  it('handles a missing server id without inventing a shared bucket', () => {
    rememberSearch(null, 'a');
    expect(loadSearchHistory(null)).toEqual(['a']);
    expect(loadSearchHistory('7')).toEqual([]);
  });
});
