import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const { preference, fetchMock, assertSafeMock } = vi.hoisted(() => ({
  preference: { value: JSON.stringify(['wsj.com', 'ft.com']) as string | undefined },
  fetchMock: vi.fn(),
  assertSafeMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../db.js', () => ({
  default: { prepare: () => ({ get: () => preference.value ? { value: preference.value } : undefined }) },
}));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { user: { id: number } }).user = { id: 1 } as never;
    next();
  },
}));
vi.mock('../routes/proxy.js', () => ({
  assertTargetSafe: assertSafeMock,
  fetchUpstream: fetchMock,
  proxyRateLimiter: null,
}));
vi.mock('../cache.js', () => ({
  cacheEnabled: false,
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheKey: (_userId: number, key: string) => key,
}));

const { default: archiveRoutes, parseTimeMap, looksLikeChallengePage } = await import('../routes/archive.js');
const app = express();
app.use('/api/archive', archiveRoutes);

const timemap = (url: string) => [
  `<${url}>; rel="original"`,
  `<http://archive.md/20261016021348/${url}>; rel="first memento"; datetime="Fri, 16 Oct 2026 02:13:48 GMT"`,
  `<http://archive.md/20261017140859/${url}>; rel="last memento"; datetime="Sat, 17 Oct 2026 14:08:59 GMT"`,
].join('\n');

function response(body: string, contentType: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

describe('Archive.is snapshot resolver', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    assertSafeMock.mockClear();
    preference.value = JSON.stringify(['wsj.com', 'ft.com']);
  });

  it('skips a latest challenge snapshot and selects the newest usable older capture', async () => {
    const original = 'https://www.wsj.com/world/article-a';
    fetchMock.mockImplementation(async (url: string) => {
      const target = String(url);
      if (target.includes('/timemap/')) return response(timemap(original), 'application/link-format');
      if (target.includes('/20261017140859/')) {
        return response('<!doctype html><html><head><title>wsj.com</title></head><body>Please enable JS and disable any ad blocker</body></html>', 'text/html');
      }
      if (target.includes('/20261016021348/')) {
        return response('<!doctype html><html><head><title>The Defector: A Russian story</title></head><body><article><p>This archived article contains readable body text beyond the basic challenge-page threshold.</p><p>Another paragraph provides enough visible text to distinguish this from an error page.</p></article></body></html>', 'text/html');
      }
      throw new Error(`Unexpected archive fetch: ${target}`);
    });

    const result = await request(app).get('/api/archive/resolve').query({ url: original });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      status: 'ok',
      url: 'https://archive.is/20261016021348/https://www.wsj.com/world/article-a',
      timestamp: '20261016021348',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('treats an HTML spinner as a soft block even when the status is 200', async () => {
    fetchMock.mockResolvedValue(response('<html><body>Loading...<img src="spinner.gif"></body></html>', 'text/html'));
    const result = await request(app).get('/api/archive/resolve').query({ url: 'https://www.ft.com/content/article-spinner' });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ status: 'soft_block' });
  });

  it('rejects hosts outside the saved allowlist', async () => {
    const result = await request(app).get('/api/archive/resolve').query({ url: 'https://notft.com/article' });
    expect(result.body).toEqual({ status: 'not_allowed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('parses relation tokens and orders multiple mementos newest first', () => {
    const original = 'https://www.wsj.com/world/article-a';
    const body = [
      `<${original}>; rel="original"`,
      `<http://archive.md/20261016021348/${original}>; rel="first memento"; datetime="Fri, 16 Oct 2026 02:13:48 GMT"`,
      `<http://archive.li/20261017140859/${original}>; rel="last memento alternate"; datetime="Sat, 17 Oct 2026 14:08:59 GMT"`,
    ].join('\n');
    expect(parseTimeMap(body).map((item) => item.timestamp)).toEqual(['20261017140859', '20261016021348']);
    expect(parseTimeMap(body)[0].url).toBe('https://archive.is/20261017140859/https://www.wsj.com/world/article-a');
  });

  it('does not reject a snapshot merely because HTML contains a captcha attribute', () => {
    const html = '<html><head><title>A genuine article headline</title></head><body><article data-captcha-site-key="abc"><p>A short but real article excerpt.</p></article></body></html>';
    expect(looksLikeChallengePage(html, 'www.wsj.com')).toBe(false);
  });
});
