import { describe, it, expect } from 'vitest';
import { buildActualizeRequest, refreshMaxFeeds, DEFAULT_MAX_FEEDS } from './actualizeRequest.js';

const OPTS = { serverUrl: 'https://example.com', freshrssUser: 'alice', token: 's3cr3t-token' };

describe('buildActualizeRequest', () => {
  it('puts only the controller and action in the URL', () => {
    const { url } = buildActualizeRequest(OPTS);
    expect(url).toBe('https://example.com/i/?c=feed&a=actualize');
  });

  it('never leaks the token or the user into the URL', () => {
    const { url } = buildActualizeRequest(OPTS);
    expect(url).not.toContain('s3cr3t-token');
    expect(url).not.toContain('alice');
    expect(url).not.toContain('token');
  });

  it('carries credentials and options in the POST body', () => {
    const { body } = buildActualizeRequest(OPTS);
    expect(body.get('user')).toBe('alice');
    expect(body.get('token')).toBe('s3cr3t-token');
    expect(body.get('ajax')).toBe('1');
    expect(body.get('maxFeeds')).toBe(String(DEFAULT_MAX_FEEDS));
  });

  it('normalises a trailing slash on the server URL', () => {
    const { url } = buildActualizeRequest({ ...OPTS, serverUrl: 'https://example.com///' });
    expect(url).toBe('https://example.com/i/?c=feed&a=actualize');
  });

  it('honours an explicit maxFeeds', () => {
    const { body } = buildActualizeRequest({ ...OPTS, maxFeeds: 1 });
    expect(body.get('maxFeeds')).toBe('1');
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
