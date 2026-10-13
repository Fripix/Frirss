import { describe, expect, it } from 'vitest';
import { showEndOfListMarkAll } from './endOfList';

const base = {
  hasContinuation: false,
  loading: false,
  loadingMore: false,
  searchQuery: '',
  filter: 'unread' as const,
  articles: [{ read: true }, { read: false }],
};

describe('showEndOfListMarkAll', () => {
  it('shows the footer once the last page is loaded and unread rows remain', () => {
    expect(showEndOfListMarkAll(base)).toBe(true);
  });

  it('hides it while another page is promised or loading', () => {
    expect(showEndOfListMarkAll({ ...base, hasContinuation: true })).toBe(false);
    expect(showEndOfListMarkAll({ ...base, loadingMore: true })).toBe(false);
    expect(showEndOfListMarkAll({ ...base, loading: true })).toBe(false);
  });

  it('hides it when nothing is left to mark', () => {
    expect(showEndOfListMarkAll({ ...base, articles: [{ read: true }] })).toBe(false);
    expect(showEndOfListMarkAll({ ...base, articles: [] })).toBe(false);
  });

  it('hides it during a search: mark-all would empty the whole view, not the results', () => {
    expect(showEndOfListMarkAll({ ...base, searchQuery: 'rust' })).toBe(false);
  });

  it('follows canMarkAllRead: never in starred or read-later views', () => {
    expect(showEndOfListMarkAll({ ...base, filter: 'starred' })).toBe(false);
    expect(showEndOfListMarkAll({ ...base, filter: 'readlater' })).toBe(false);
    expect(showEndOfListMarkAll({ ...base, filter: 'all' })).toBe(true);
  });
});
