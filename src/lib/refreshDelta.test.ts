import { describe, it, expect } from 'vitest';
import { computeRefreshDelta } from './refreshDelta';

describe('computeRefreshDelta', () => {
  it('counts new unread per feed and the total', () => {
    const r = computeRefreshDelta({ 'feed/a': 2, 'feed/b': 0 }, { 'feed/a': 5, 'feed/b': 3 });
    expect(r.totalNew).toBe(6);
    expect(r.newByFeed).toEqual({ 'feed/a': 3, 'feed/b': 3 });
  });

  it('ignores non-feed keys (categories, states, reading-list total)', () => {
    const r = computeRefreshDelta(
      { 'user/-/state/com.google/reading-list': 10, 'user/-/label/News': 4 },
      { 'user/-/state/com.google/reading-list': 20, 'user/-/label/News': 9 }
    );
    expect(r.totalNew).toBe(0);
    expect(r.newByFeed).toEqual({});
  });

  it('ignores feeds whose count decreased (articles were read)', () => {
    const r = computeRefreshDelta({ 'feed/a': 5 }, { 'feed/a': 2 });
    expect(r.totalNew).toBe(0);
    expect(r.newByFeed).toEqual({});
  });

  it('counts a feed that was absent before', () => {
    const r = computeRefreshDelta({}, { 'feed/a': 4 });
    expect(r.totalNew).toBe(4);
    expect(r.newByFeed).toEqual({ 'feed/a': 4 });
  });
});
