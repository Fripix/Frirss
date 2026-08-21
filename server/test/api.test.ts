import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import app from '../index.js';
import db from '../db.js';
import { encrypt, decrypt } from '../crypto.js';
import { cacheEnabled, cacheGet, trimStreamJson } from '../cache.js';
import { redactUrl } from '../routes/proxy.js';

// The actualize route now goes through fetchUpstream, which resolves the
// target host before allowing the request (SSRF guard). The fictional
// rssN.example.com test hosts below don't actually resolve, so stub DNS to
// answer with a public address for any host — EXCEPT the bare sentinel host
// `example.com`, which resolves to a private address. That lets the SSRF
// tests below exercise the real resolve-based guard (not just the literal
// pre-check) without weakening this mock for every other test in the file:
// no other test in this file targets `example.com` itself (only subdomains
// like `rss.example.com`).
vi.mock('dns', () => {
  const addrFor = (host: string) => (host === 'example.com' ? '10.0.0.1' : '93.184.216.34');
  const lookup = vi.fn((host: string, _opts: unknown, cb?: (err: null, addr: string, family: number) => void) => {
    if (typeof cb === 'function') cb(null, addrFor(host), 4);
  });
  const promises = { lookup: vi.fn((host: string) => Promise.resolve([{ address: addrFor(host), family: 4 }])) };
  return { default: { lookup, promises }, lookup, promises };
});

let adminToken: string;
let secondUserId: number;

describe('health', () => {
  it('reports ok with db up', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.db).toBe('up');
  });
});

describe('crypto', () => {
  it('round-trips a value', () => {
    const enc = encrypt('secret-token');
    expect(enc!.startsWith('enc:v1:')).toBe(true);
    expect(decrypt(enc)).toBe('secret-token');
  });
  it('passes through plaintext and null', () => {
    expect(decrypt('plain')).toBe('plain');
    expect(decrypt(null)).toBe(null);
  });
});

describe('auth', () => {
  it('reports no users on a fresh database', async () => {
    const res = await request(app).get('/api/auth/status');
    expect(res.body.hasUsers).toBe(false);
  });

  it('rejects registration with an invalid email', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'admin', password: 'secret123', email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  it('registers the first user as admin', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'admin', password: 'secret123', email: 'admin@example.com', displayName: 'Admin' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('admin');
    expect(res.body.token).toBeTruthy();
    adminToken = res.body.token;
  });

  it('rejects a duplicate username', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'admin', password: 'secret123', email: 'other@example.com' });
    expect(res.status).toBe(409);
  });

  it('logs in with correct credentials', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ username: 'admin', password: 'secret123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('rejects a wrong password', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ username: 'admin', password: 'wrong-password' });
    expect(res.status).toBe(401);
  });
});

describe('admin', () => {
  it('rejects admin routes without a token', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
  });

  it('creates a user', async () => {
    const res = await request(app).post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'bob', password: 'secret123', email: 'bob@example.com', role: 'user' });
    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe('bob');
    secondUserId = res.body.user.id;
  });

  it('lists both users', async () => {
    const res = await request(app).get('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.users.length).toBe(2);
  });

  it('updates a user profile (email + display name)', async () => {
    const res = await request(app).put(`/api/admin/users/${secondUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'bob2@example.com', displayName: 'Bob 2' });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('bob2@example.com');
    expect(res.body.user.display_name).toBe('Bob 2');
  });

  it('resets a user password and the new one works', async () => {
    const res = await request(app).put(`/api/admin/users/${secondUserId}/password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ password: 'newsecret' });
    expect(res.status).toBe(200);
    const login = await request(app).post('/api/auth/login')
      .send({ username: 'bob', password: 'newsecret' });
    expect(login.status).toBe(200);
  });

  it('deletes a user', async () => {
    const res = await request(app).delete(`/api/admin/users/${secondUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});

describe('servers', () => {
  it('stores the FreshRSS token encrypted, returns it decrypted', async () => {
    const add = await request(app).post('/api/servers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Test', url: 'https://rss.example.com', freshrssUser: 'admin', freshrssToken: 'tok-123' });
    expect(add.status).toBe(201);

    const list = await request(app).get('/api/servers')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    // The token must NOT be exposed to the client — only its presence.
    expect(list.body.servers[0].freshrss_token).toBeUndefined();
    expect(list.body.servers[0].has_token).toBe(true);
  });

  it('stores the refresh (master) token encrypted, exposes only its presence, clears on empty string', async () => {
    const add = await request(app).post('/api/servers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'RefreshTest', url: 'https://rss2.example.com', freshrssUser: 'admin', freshrssToken: 'tok-123' });
    expect(add.status).toBe(201);
    const id = add.body.server.id;

    const put = await request(app).put(`/api/servers/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ refreshToken: 'master-tok-456' });
    expect(put.status).toBe(200);
    expect(put.body.server.refresh_token).toBeUndefined();

    const list = await request(app).get('/api/servers')
      .set('Authorization', `Bearer ${adminToken}`);
    const row = list.body.servers.find((s: { id: number }) => s.id === id);
    expect(row.refresh_token).toBeUndefined();
    expect(row.has_refresh_token).toBe(true);

    const clear = await request(app).put(`/api/servers/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ refreshToken: '' });
    expect(clear.status).toBe(200);

    const list2 = await request(app).get('/api/servers')
      .set('Authorization', `Bearer ${adminToken}`);
    const row2 = list2.body.servers.find((s: { id: number }) => s.id === id);
    expect(row2.has_refresh_token).toBe(false);
  });
});

describe('servers actualize', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('404s for a server that does not exist', async () => {
    const res = await request(app).post('/api/servers/999999/actualize')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('404s the status route for a server that does not exist', async () => {
    const res = await request(app).get('/api/servers/999999/actualize')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('rejects a refresh when the server has no master token', async () => {
    const add = await request(app).post('/api/servers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'NoRefresh', url: 'https://rss3.example.com', freshrssUser: 'admin', freshrssToken: 'tok-123' });
    const id = add.body.server.id;

    const res = await request(app).post(`/api/servers/${id}/actualize`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('no_refresh_token');
  });

  it('reports no job before any refresh has been started', async () => {
    const add = await request(app).post('/api/servers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Idle', url: 'https://rss4.example.com', freshrssUser: 'admin', freshrssToken: 'tok-123' });
    const id = add.body.server.id;

    const res = await request(app).get(`/api/servers/${id}/actualize`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.job).toBe(null);
  });

  it('starts a real refresh as a GET carrying the credentials, and the job settles to done', async () => {
    const add = await request(app).post('/api/servers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Refreshable', url: 'https://rss5.example.com', freshrssUser: 'admin', freshrssToken: 'tok-123' });
    const id = add.body.server.id;
    await request(app).put(`/api/servers/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ refreshToken: 'master-tok-789' });

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app).post(`/api/servers/${id}/actualize`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(202);
    expect(res.body.job.status).toBe('running');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    // GET with the credentials in the query string is the ONLY form FreshRSS
    // accepts: its global CSRF gate (app/FreshRSS.php::initAuth) 302s every
    // POST for this action. See server/actualizeRequest.ts.
    expect(calledInit.method).toBe('GET');
    expect(calledInit.body).toBeUndefined();
    expect(calledInit.redirect).toBe('manual');
    const called = new URL(calledUrl as string);
    expect(called.origin + called.pathname).toBe('https://rss5.example.com/i/');
    expect(called.searchParams.get('c')).toBe('feed');
    expect(called.searchParams.get('a')).toBe('actualize');
    expect(called.searchParams.get('user')).toBe('admin');
    expect(called.searchParams.get('token')).toBe('master-tok-789');
    expect(called.searchParams.get('ajax')).toBe('1');
    expect(called.searchParams.get('maxFeeds')).toBe('1000');

    await tick();
    const status = await request(app).get(`/api/servers/${id}/actualize`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(status.body.job.status).toBe('done');
  });

  it('forwards an AbortSignal to the outgoing request', async () => {
    const add = await request(app).post('/api/servers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'SignalCheck', url: 'https://rss9.example.com', freshrssUser: 'admin', freshrssToken: 'tok-123' });
    const id = add.body.server.id;
    await request(app).put(`/api/servers/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ refreshToken: 'master-tok-789' });

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await request(app).post(`/api/servers/${id}/actualize`)
      .set('Authorization', `Bearer ${adminToken}`);

    const [, calledInit] = fetchMock.mock.calls[0];
    expect(calledInit.signal).toBeInstanceOf(AbortSignal);
    expect(calledInit.signal.aborted).toBe(false);
  });

  it('clamps a client-supplied maxFeeds above the ceiling', async () => {
    const add = await request(app).post('/api/servers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'HugeMaxFeeds', url: 'https://rss10.example.com', freshrssUser: 'admin', freshrssToken: 'tok-123' });
    const id = add.body.server.id;
    await request(app).put(`/api/servers/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ refreshToken: 'master-tok-789' });

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await request(app).post(`/api/servers/${id}/actualize`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ maxFeeds: 50000 });

    const [calledUrl] = fetchMock.mock.calls[0];
    const params = new URL(calledUrl as string).searchParams;
    expect(params.get('maxFeeds')).toBe('1000');
  });

  it('rejects a junk client-supplied maxFeeds and falls back to the default', async () => {
    const add = await request(app).post('/api/servers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'JunkMaxFeeds', url: 'https://rss6.example.com', freshrssUser: 'admin', freshrssToken: 'tok-123' });
    const id = add.body.server.id;
    await request(app).put(`/api/servers/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ refreshToken: 'master-tok-789' });

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    for (const junk of ['not-a-number', -5, 2.5]) {
      fetchMock.mockClear();
      await request(app).post(`/api/servers/${id}/actualize`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ maxFeeds: junk });
      await tick();
      const [calledUrl] = fetchMock.mock.calls[0];
      const params = new URL(calledUrl as string).searchParams;
      expect(params.get('maxFeeds')).toBe('1000');
    }
  });

  it('honours a valid client-supplied maxFeeds', async () => {
    const add = await request(app).post('/api/servers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'ValidMaxFeeds', url: 'https://rss7.example.com', freshrssUser: 'admin', freshrssToken: 'tok-123' });
    const id = add.body.server.id;
    await request(app).put(`/api/servers/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ refreshToken: 'master-tok-789' });

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await request(app).post(`/api/servers/${id}/actualize`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ maxFeeds: 5 });
    const [calledUrl] = fetchMock.mock.calls[0];
    const params = new URL(calledUrl as string).searchParams;
    expect(params.get('maxFeeds')).toBe('5');
  });

  it('records a failed refresh without leaking the master token', async () => {
    const add = await request(app).post('/api/servers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Failing', url: 'https://rss8.example.com', freshrssUser: 'admin', freshrssToken: 'tok-123' });
    const id = add.body.server.id;
    await request(app).put(`/api/servers/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ refreshToken: 'master-tok-secret' });

    // The failure must carry the secret in its message for this test to prove
    // anything about redaction — an error that never contained the token
    // (e.g. a bare status-code message) would pass even with no redaction at all.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
      new Error('connect ECONNREFUSED while POSTing token=master-tok-secret to upstream')
    ));

    await request(app).post(`/api/servers/${id}/actualize`)
      .set('Authorization', `Bearer ${adminToken}`);
    await tick();

    const status = await request(app).get(`/api/servers/${id}/actualize`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(status.body.job.status).toBe('failed');
    expect(status.body.job.error).not.toContain('master-tok-secret');
    expect(status.body.job.error).toContain('«redacted»');
  });

  it('does not follow a redirect from the actualize upstream, and fails the job', async () => {
    const add = await request(app).post('/api/servers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'RedirectCheck', url: 'https://rss11.example.com', freshrssUser: 'admin', freshrssToken: 'tok-123' });
    const id = add.body.server.id;
    await request(app).put(`/api/servers/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ refreshToken: 'master-tok-789' });

    // A body-reading spy: if the redirect were chased, fetchUpstream would
    // return the *second* hop's response instead of this one, so this spy
    // being called at all would already prove the redirect wasn't refused
    // as-is. Also asserted directly: the route never inspects the body of a
    // non-ok response, redirect or otherwise.
    const readBody = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 302,
      headers: { get: (h: string) => (h.toLowerCase() === 'location' ? 'https://evil.example.com/steal' : null) },
      text: readBody,
      json: readBody,
      arrayBuffer: readBody,
    });
    vi.stubGlobal('fetch', fetchMock);

    await request(app).post(`/api/servers/${id}/actualize`)
      .set('Authorization', `Bearer ${adminToken}`);
    await tick();

    // A single call, to the original host only — a chased redirect would add
    // a second call to evil.example.com.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatch(/^https:\/\/rss11\.example\.com\/i\/\?c=feed&a=actualize&/);
    expect(readBody).not.toHaveBeenCalled();

    const status = await request(app).get(`/api/servers/${id}/actualize`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(status.body.job.status).toBe('failed');
  });

  it('refuses an internal/private server.url, never reaching the upstream', async () => {
    // `example.com` is the sentinel the DNS mock above resolves to a private
    // address (10.0.0.1) — everything else in this file resolves publicly.
    const add = await request(app).post('/api/servers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'InternalTarget', url: 'https://example.com', freshrssUser: 'admin', freshrssToken: 'tok-123' });
    const id = add.body.server.id;
    await request(app).put(`/api/servers/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ refreshToken: 'master-tok-789' });

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await request(app).post(`/api/servers/${id}/actualize`)
      .set('Authorization', `Bearer ${adminToken}`);
    await tick();

    // The SSRF guard must reject before any outgoing request is made.
    expect(fetchMock).not.toHaveBeenCalled();

    const status = await request(app).get(`/api/servers/${id}/actualize`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(status.body.job.status).toBe('failed');
  });

  it('honours a lowered FRIRSS_REFRESH_MAX_FEEDS ceiling, not the compiled-in default', async () => {
    const add = await request(app).post('/api/servers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'EnvMaxFeeds', url: 'https://rss12.example.com', freshrssUser: 'admin', freshrssToken: 'tok-123' });
    const id = add.body.server.id;
    await request(app).put(`/api/servers/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ refreshToken: 'master-tok-789' });

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const prevEnv = process.env.FRIRSS_REFRESH_MAX_FEEDS;
    process.env.FRIRSS_REFRESH_MAX_FEEDS = '50';
    try {
      await request(app).post(`/api/servers/${id}/actualize`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ maxFeeds: 50000 });
    } finally {
      if (prevEnv === undefined) delete process.env.FRIRSS_REFRESH_MAX_FEEDS;
      else process.env.FRIRSS_REFRESH_MAX_FEEDS = prevEnv;
    }

    const [calledUrl] = fetchMock.mock.calls[0];
    const params = new URL(calledUrl as string).searchParams;
    // Clamped to the operator's lowered ceiling (50), not the compiled-in
    // default (1000) that the un-set-env test above already covers.
    expect(params.get('maxFeeds')).toBe('50');
  });

  describe('one-shot test token', () => {
    it('uses a supplied token for kind=test instead of the stored one, and never persists it', async () => {
      const add = await request(app).post('/api/servers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'OneShotTest', url: 'https://rss13.example.com', freshrssUser: 'admin', freshrssToken: 'tok-123' });
      const id = add.body.server.id;
      await request(app).put(`/api/servers/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ refreshToken: 'stored-master-tok' });

      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', fetchMock);

      const res = await request(app).post(`/api/servers/${id}/actualize`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ kind: 'test', maxFeeds: 1, token: 'freshly-typed-tok' });
      expect(res.status).toBe(202);

      const [calledUrl] = fetchMock.mock.calls[0];
      const params = new URL(calledUrl as string).searchParams;
      // The typed token reached the outgoing request, not the stored one.
      expect(params.get('token')).toBe('freshly-typed-tok');
      await tick();

      // Re-read the row directly: the stored token must be exactly what it
      // was before this call, never overwritten by the one-shot value.
      const row = db.prepare('SELECT refresh_token FROM servers WHERE id = ?').get(id) as { refresh_token: string };
      expect(decrypt(row.refresh_token)).toBe('stored-master-tok');
    });

    it('lets a supplied test token succeed even when no token is stored at all', async () => {
      const add = await request(app).post('/api/servers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'OneShotNoStored', url: 'https://rss14.example.com', freshrssUser: 'admin', freshrssToken: 'tok-123' });
      const id = add.body.server.id;
      // No PUT with refreshToken: this server has no stored master token.

      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', fetchMock);

      const res = await request(app).post(`/api/servers/${id}/actualize`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ kind: 'test', maxFeeds: 1, token: 'unsaved-tok' });
      // Would be 409 (no_refresh_token) without the one-shot-token fallback.
      expect(res.status).toBe(202);

      const [calledUrl] = fetchMock.mock.calls[0];
      const params = new URL(calledUrl as string).searchParams;
      expect(params.get('token')).toBe('unsaved-tok');
    });

    it('ignores a supplied token for kind=refresh and uses the stored one', async () => {
      const add = await request(app).post('/api/servers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'OneShotIgnoredOnRefresh', url: 'https://rss15.example.com', freshrssUser: 'admin', freshrssToken: 'tok-123' });
      const id = add.body.server.id;
      await request(app).put(`/api/servers/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ refreshToken: 'stored-master-tok-2' });

      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', fetchMock);

      const res = await request(app).post(`/api/servers/${id}/actualize`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ kind: 'refresh', token: 'should-be-ignored' });
      expect(res.status).toBe(202);

      const [calledUrl] = fetchMock.mock.calls[0];
      const params = new URL(calledUrl as string).searchParams;
      expect(params.get('token')).toBe('stored-master-tok-2');
    });

    it('rejects an empty or oversized test token instead of forwarding it', async () => {
      const add = await request(app).post('/api/servers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'OneShotInvalid', url: 'https://rss16.example.com', freshrssUser: 'admin', freshrssToken: 'tok-123' });
      const id = add.body.server.id;
      await request(app).put(`/api/servers/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ refreshToken: 'stored-master-tok-3' });

      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', fetchMock);

      const empty = await request(app).post(`/api/servers/${id}/actualize`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ kind: 'test', token: '' });
      expect(empty.status).toBe(400);
      expect(empty.body.error).toBe('invalid_token');

      const oversized = await request(app).post(`/api/servers/${id}/actualize`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ kind: 'test', token: 'x'.repeat(2000) });
      expect(oversized.status).toBe(400);
      expect(oversized.body.error).toBe('invalid_token');

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('never leaks a supplied test token into a failed job error', async () => {
      const add = await request(app).post('/api/servers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'OneShotFailRedact', url: 'https://rss17.example.com', freshrssUser: 'admin', freshrssToken: 'tok-123' });
      const id = add.body.server.id;

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
        new Error('connect ECONNREFUSED while GETting token=one-shot-secret to upstream')
      ));

      await request(app).post(`/api/servers/${id}/actualize`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ kind: 'test', token: 'one-shot-secret' });
      await tick();

      const status = await request(app).get(`/api/servers/${id}/actualize`)
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ kind: 'test' });
      expect(status.body.job.status).toBe('failed');
      expect(status.body.job.error).not.toContain('one-shot-secret');
      expect(status.body.job.error).toContain('«redacted»');
    });

    it('redacts a supplied test token from a logged URL just like the stored one', () => {
      const url = redactUrl('https://rss.example.com/i/?c=feed&a=actualize&user=alice&token=one-shot-secret&maxFeeds=1&ajax=1');
      expect(url).not.toContain('one-shot-secret');
      expect(url).toContain('token=REDACTED');
    });
  });
});

describe('proxy', () => {
  it('rejects requests without a JWT', async () => {
    const res = await request(app).get('/api/proxy');
    expect(res.status).toBe(401);
  });

  it('rejects a missing/invalid target', async () => {
    const res = await request(app).get('/api/proxy')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it('blocks an internal/private target (SSRF guard)', async () => {
    for (const target of ['http://10.0.0.5:3306/', 'http://localhost:6379/', 'http://169.254.169.254/latest/meta-data/']) {
      const res = await request(app).get('/api/proxy')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Proxy-Target', target);
      expect(res.status).toBe(403);
    }
  });
});

describe('cache', () => {
  it('is disabled without REDIS_URL', () => {
    expect(cacheEnabled).toBe(false);
  });

  it('cacheGet is a no-op when disabled', async () => {
    expect(await cacheGet('frirss:c:1:whatever')).toBe(null);
  });

  it('trimStreamJson keeps at most N items', () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ id: i }));
    const out = JSON.parse(trimStreamJson(JSON.stringify({ items }), 50));
    expect(out.items.length).toBe(50);
  });

  it('trimStreamJson passes non-JSON through', () => {
    expect(trimStreamJson('<html>', 50)).toBe('<html>');
  });

  it('cache-only proxy read returns 204 when cache is off', async () => {
    const res = await request(app).get('/api/proxy')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Cache-Only', '1')
      .set('X-Proxy-Target', 'https://rss.example.com/api/greader.php/reader/api/0/stream/contents/x?output=json&n=50');
    expect(res.status).toBe(204);
  });
});

describe('rate limiting', () => {
  it('blocks after too many failed logins', async () => {
    let got429 = false;
    for (let i = 0; i < 15; i++) {
      const res = await request(app).post('/api/auth/login')
        .send({ username: 'nobody', password: 'x' });
      if (res.status === 429) { got429 = true; break; }
    }
    expect(got429).toBe(true);
  });
});
