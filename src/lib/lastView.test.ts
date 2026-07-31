// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { saveLastView, loadLastView } from './lastView';
import type { Subscription } from '../types';

const feed = { id: 'feed/42', title: 'Example' } as Subscription;

describe('lastView', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a feed view for a given server', () => {
    saveLastView('srv1', { feed, filter: 'unread' });
    expect(loadLastView('srv1')).toEqual({ feed, filter: 'unread' });
  });

  it('round-trips the landing view (feed = null)', () => {
    saveLastView('srv1', { feed: null, filter: 'starred' });
    expect(loadLastView('srv1')).toEqual({ feed: null, filter: 'starred' });
  });

  it('keeps views independent per server', () => {
    saveLastView('srv1', { feed, filter: 'all' });
    expect(loadLastView('srv2')).toBeNull();
  });

  it('returns null when nothing is stored', () => {
    expect(loadLastView('srv1')).toBeNull();
  });

  it('returns null on corrupt JSON', () => {
    localStorage.setItem('frirss_lastView_srv1', '{not json');
    expect(loadLastView('srv1')).toBeNull();
  });

  it('rejects an unknown filter value', () => {
    localStorage.setItem('frirss_lastView_srv1', JSON.stringify({ feed: null, filter: 'bogus' }));
    expect(loadLastView('srv1')).toBeNull();
  });

  it('handles a null server id via a stable "default" key', () => {
    saveLastView(null, { feed, filter: 'all' });
    expect(loadLastView(null)).toEqual({ feed, filter: 'all' });
  });
});
