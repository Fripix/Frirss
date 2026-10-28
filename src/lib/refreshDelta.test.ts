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

  // `loadSubscriptions` (ajout d'un flux) : un flux que la base précédente ne
  // connaissait pas apporte tout son stock, pas des arrivées.
  it('with ignoreUnknownFeeds, a feed absent before does not count', () => {
    const r = computeRefreshDelta(
      { 'feed/a': 2 },
      { 'feed/a': 3, 'feed/new': 30 },
      { ignoreUnknownFeeds: true },
    );
    expect(r.totalNew).toBe(1);
    expect(r.newByFeed).toEqual({ 'feed/a': 1 });
  });

  it('with ignoreUnknownFeeds, a feed known at zero still counts', () => {
    const r = computeRefreshDelta({ 'feed/a': 0 }, { 'feed/a': 2 }, { ignoreUnknownFeeds: true });
    expect(r.newByFeed).toEqual({ 'feed/a': 2 });
  });
});
