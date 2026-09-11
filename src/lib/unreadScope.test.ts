import { describe, it, expect } from 'vitest';
import { normalizeUnreadScope, switchUnreadScope, unreadOnlyFor, type UnreadPrefs } from './unreadScope';

const prefs = (over: Partial<UnreadPrefs> = {}): UnreadPrefs => ({
  scope: 'feed',
  all: false,
  byFeed: {},
  ...over,
});

describe('unreadOnlyFor', () => {
  it('per feed, global mode never used: identical to the legacy expression', () => {
    const byFeed: Record<string, boolean> = { 'feed/on': true, 'feed/off': false };
    for (const key of ['feed/on', 'feed/off', 'feed/unset', '']) {
      // Legacy expression, as it stood in feedStore/App: `unreadOnlyByFeed[key] ? 'unread' : 'all'`
      expect(unreadOnlyFor(key, prefs({ byFeed }))).toBe(!!byFeed[key]);
    }
  });

  it('per feed: a stored null (bad sync payload) reads like the legacy expression', () => {
    const byFeed = { 'feed/null': null } as unknown as Record<string, boolean>;
    expect(unreadOnlyFor('feed/null', prefs({ byFeed }))).toBe(false);
  });

  it('per feed after global use: a feed without a choice inherits, a feed with one keeps it', () => {
    const p = prefs({ all: true, byFeed: { 'feed/off': false } });
    expect(unreadOnlyFor('feed/unset', p)).toBe(true);
    expect(unreadOnlyFor('feed/off', p)).toBe(false);
  });

  it('all feeds: the per-feed table is ignored', () => {
    expect(unreadOnlyFor('feed/off', prefs({ scope: 'all', all: true, byFeed: { 'feed/off': false } }))).toBe(true);
    expect(unreadOnlyFor('', prefs({ scope: 'all', all: true }))).toBe(true);
    expect(unreadOnlyFor('feed/on', prefs({ scope: 'all', all: false, byFeed: { 'feed/on': true } }))).toBe(false);
  });
});

describe('switchUnreadScope', () => {
  it('to all feeds: takes the choice of the view on screen, keeps the table', () => {
    const byFeed = { 'feed/A': true, 'feed/B': false };
    expect(switchUnreadScope(prefs({ byFeed }), 'all', 'feed/A')).toEqual({ scope: 'all', all: true, byFeed });
    expect(switchUnreadScope(prefs({ byFeed }), 'all', 'feed/B').all).toBe(false);
    expect(switchUnreadScope(prefs({ byFeed }), 'all', 'feed/unset').all).toBe(false);
  });

  it('back to per feed: keeps the last state and clears the table', () => {
    const next = switchUnreadScope(prefs({ scope: 'all', all: true, byFeed: { 'feed/B': false } }), 'feed', 'feed/A');
    expect(next).toEqual({ scope: 'feed', all: true, byFeed: {} });
    // The old per-feed choice of feed/B does not come back.
    expect(unreadOnlyFor('feed/B', next)).toBe(true);
  });

  it('choosing the active scope returns the very same object', () => {
    const p = prefs({ byFeed: { 'feed/A': true } });
    expect(switchUnreadScope(p, 'feed', 'feed/A')).toBe(p);
    const q = prefs({ scope: 'all', all: true });
    expect(switchUnreadScope(q, 'all', 'feed/A')).toBe(q);
  });
});

describe('normalizeUnreadScope', () => {
  it('keeps the two known values and falls back to per feed', () => {
    expect(normalizeUnreadScope('all')).toBe('all');
    expect(normalizeUnreadScope('feed')).toBe('feed');
    expect(normalizeUnreadScope('everything')).toBe('feed');
    expect(normalizeUnreadScope(undefined)).toBe('feed');
    expect(normalizeUnreadScope(null)).toBe('feed');
  });
});
