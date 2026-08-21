import { describe, it, expect } from 'vitest';
import { buildActualizeRequest, refreshMaxFeeds, DEFAULT_MAX_FEEDS } from './actualizeRequest.js';

const OPTS = { serverUrl: 'https://example.com', freshrssUser: 'alice', token: 's3cr3t-token' };

describe('buildActualizeRequest', () => {
  it('is a GET — the only method FreshRSS accepts for this action', () => {
    expect(buildActualizeRequest(OPTS).method).toBe('GET');
  });

  it('carries controller, action, credentials and options in the query string', () => {
    const { url } = buildActualizeRequest(OPTS);
    const q = new URL(url).searchParams;
    expect(new URL(url).pathname).toBe('/i/');
    expect(q.get('c')).toBe('feed');
    expect(q.get('a')).toBe('actualize');
    expect(q.get('user')).toBe('alice');
    expect(q.get('token')).toBe('s3cr3t-token');
    expect(q.get('maxFeeds')).toBe(String(DEFAULT_MAX_FEEDS));
    expect(q.get('ajax')).toBe('1');
  });

  it('URL-encodes credentials that contain reserved characters', () => {
    const { url } = buildActualizeRequest({
      ...OPTS,
      freshrssUser: 'a b&c',
      token: 'tok/en+with=chars&more',
    });
    expect(url).not.toContain('tok/en+with=chars&more');
    const q = new URL(url).searchParams;
    expect(q.get('user')).toBe('a b&c');
    expect(q.get('token')).toBe('tok/en+with=chars&more');
  });

  it('normalises a trailing slash on the server URL', () => {
    const { url } = buildActualizeRequest({ ...OPTS, serverUrl: 'https://example.com///' });
    expect(url.startsWith('https://example.com/i/?')).toBe(true);
  });

  it('honours an explicit maxFeeds', () => {
    const { url } = buildActualizeRequest({ ...OPTS, maxFeeds: 1 });
    expect(new URL(url).searchParams.get('maxFeeds')).toBe('1');
  });
});

describe('refreshMaxFeeds', () => {
  it('defaults to 1000', () => {
    expect(refreshMaxFeeds({})).toBe(DEFAULT_MAX_FEEDS);
  });

  it('reads FRIRSS_REFRESH_MAX_FEEDS', () => {
    expect(refreshMaxFeeds({ FRIRSS_REFRESH_MAX_FEEDS: '25' })).toBe(25);
  });

  it('falls back on junk, zero and negative values', () => {
    for (const v of ['', 'abc', '0', '-3', '2.5']) {
      expect(refreshMaxFeeds({ FRIRSS_REFRESH_MAX_FEEDS: v }), v).toBe(DEFAULT_MAX_FEEDS);
    }
  });
});
