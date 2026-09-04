import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../index.js';
import db, { setSetting } from '../db.js';
import { encrypt, decrypt } from '../crypto.js';
import { cacheEnabled, cacheGet, trimStreamJson } from '../cache.js';
import { redactUrl } from '../routes/proxy.js';
import { readBoundedText } from '../routes/extract.js';
import { __settleJobs } from '../refreshJobs.js';
import { getDiscovery, clearDiscoveryCache } from '../oidc.js';

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

  // L'inscription est fermée par défaut : le premier compte passe (il n'y a
  // personne pour l'autoriser), les suivants demandent un geste explicite de
  // l'administrateur. Le test « registers the first user as admin » ci-dessus
  // prouve l'exemption du premier compte — il tourne sur une base neuve, donc
  // avec l'inscription déjà fermée.
  it('refuses a second registration by default', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'stranger', password: 'secret123', email: 'stranger@example.com' });
    expect(res.status).toBe(403);
  });

  it('reports registration as closed once the first account exists', async () => {
    const res = await request(app).get('/api/auth/status');
    expect(res.body.hasUsers).toBe(true);
    expect(res.body.registrationEnabled).toBe(false);
  });

  it('rejects a duplicate username', async () => {
    // Ce test porte sur la détection de doublon, pas sur l'interrupteur : il
    // faut donc ouvrir l'inscription, sinon le 403 arrive avant le 409.
    setSetting('registration_enabled', 'true');
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'admin', password: 'secret123', email: 'other@example.com' });
    setSetting('registration_enabled', 'false');
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

  afterEach(async () => {
    // `startJob` lance son travail SANS l'attendre — c'est voulu en
    // production. Sans ce drainage, un `fetch` de relève encore en vol se
    // posait dans le `stubGlobal('fetch')` d'un test ULTÉRIEUR et devenait son
    // `mock.calls[0]` : « attaches the token to the server's own API URL »
    // échouait alors par intermittence, en lisant les en-têtes d'une requête
    // qui n'était pas la sienne.
    await __settleJobs();
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
    const targets = [
      'http://10.0.0.5:3306/',
      'http://localhost:6379/',
      'http://169.254.169.254/latest/meta-data/',
      // A LAN-hosted FreshRSS: refused like any other private target. This is
      // the majority self-hosting case, not an exotic one.
      'http://192.168.1.7:82/api/greader.php/accounts/ClientLogin',
    ];
    for (const target of targets) {
      const res = await request(app).get('/api/proxy')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Proxy-Target', target);
      expect(res.status, target).toBe(403);
      // The body is a contract, not a detail: the login screen reads this
      // exact phrase to tell the user their host was blocked and to name
      // PROXY_INTERNAL_HOSTS (src/lib/loginErrors.ts). Reword it here and the
      // screen silently falls back to "connection failed".
      expect(res.body, target).toEqual({ error: 'Target host not allowed' });
    }
  });

  // `https://` franchit le filtre `^https?://` mais `new URL()` s'y casse. Les
  // deux routes sortantes doivent en dire la même chose — `docs/FEATURES.md`
  // promet qu'`/api/extract` classe ses échecs « comme sur `/api/proxy` », et
  // une URL indécodable est une cible qu'on refuse, pas une panne amont.
  it("classe une URL malformée en 403 sur les DEUX routes sortantes", async () => {
    const proxyRes = await request(app).get('/api/proxy')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Proxy-Target', 'https://');
    const extractRes = await request(app).get('/api/extract')
      .query({ url: 'https://' }).set('Authorization', `Bearer ${adminToken}`);

    expect(proxyRes.status).toBe(403);
    expect(extractRes.status).toBe(403);
    expect(extractRes.body).toEqual(proxyRes.body);
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

describe('proxy — injection du jeton FreshRSS', () => {
  let serverId: number;
  const SERVER_URL = 'https://rss20.example.com';
  const TOKEN = 'tok-must-not-leak';

  const proxyGet = (target: string) => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers(), body: null,
    });
    vi.stubGlobal('fetch', fetchMock);
    return request(app).get('/api/proxy')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Server-Id', String(serverId))
      .set('X-Proxy-Target', target)
      .then(() => {
        // On cherche l'appel qui vise CETTE cible, au lieu de prendre le
        // premier venu : un appel étranger arrivé entre-temps donnerait des
        // en-têtes qui ne sont pas ceux qu'on teste. Un appel absent est
        // signalé plutôt que confondu avec « pas d'en-tête Authorization »,
        // qui est justement ce que la moitié de ces tests attendent.
        const call = fetchMock.mock.calls.find((c) => String(c[0]) === target);
        if (!call) return { __noCall: 'true' } as Record<string, string>;
        return (call[1] as { headers?: Record<string, string> })?.headers ?? {};
      });
  };

  beforeAll(async () => {
    const add = await request(app).post('/api/servers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'InjectionScope', url: SERVER_URL, freshrssUser: 'admin', freshrssToken: TOKEN });
    serverId = add.body.server.id;
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  // Le corps était analysé (jusqu'à 5 Mo) AVANT le contrôle d'authentification :
  // un inconnu pouvait donc faire allouer 5 Mo par requête pour finir sur un
  // 401. Un 413 est la signature de ce défaut — il ne peut être produit que par
  // l'analyseur de corps, donc après avoir lu ce corps. Une fois le contrôle
  // remis en tête, la réponse est 401, ou la connexion tombe parce que le
  // serveur a refermé pendant que le client émettait encore : les deux disent
  // la même chose, le corps n'a pas été lu.
  it('never answers 413 to an unauthenticated request — the body is read after the check', async () => {
    const outcome = await request(app).post('/api/proxy')
      .set('Content-Type', 'application/octet-stream')
      .set('X-Proxy-Target', `${SERVER_URL}/api/greader.php/reader/api/0/edit-tag`)
      .send(Buffer.alloc(6 * 1024 * 1024))
      .then((r) => r.status as number | string)
      .catch(() => 'connection-closed');
    expect(outcome).not.toBe(413);
    expect([401, 'connection-closed']).toContain(outcome);
  });

  it('attaches the token to the server’s own API URL', async () => {
    const headers = await proxyGet(`${SERVER_URL}/api/greader.php/reader/api/0/subscription/list`);
    expect(headers.Authorization).toBe(`GoogleLogin auth=${TOKEN}`);
  });

  // Le proxy acceptait un en-tête X-Freshrss-Auth que PLUS PERSONNE n'envoyait :
  // le flux d'installation passe les identifiants dans le corps du ClientLogin,
  // puis enregistre le jeton par /api/servers. Le repli laissait donc n'importe
  // quel compte authentifié faire attacher un Authorization de son choix à
  // n'importe quelle cible autorisée. Ce test garde la porte fermée.
  it('ignores a client-supplied X-Freshrss-Auth header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers(), body: null,
    });
    vi.stubGlobal('fetch', fetchMock);
    await request(app).get('/api/proxy')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Freshrss-Auth', 'attacker-chosen-token')
      .set('X-Proxy-Target', 'https://elsewhere.example.com/collect');
    const headers = (fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string> })?.headers ?? {};
    expect(headers.Authorization).toBeUndefined();
  });

  // Une comparaison par préfixe de chaîne accepte un hôte qui COMMENCE par
  // l'URL du serveur. Les URL d'images et de favicons viennent du contenu des
  // flux : celui qui publie un flux choisit donc la cible.
  it('never attaches the token to a look-alike host', async () => {
    const headers = await proxyGet(`${SERVER_URL}.attacker.tld/pixel.png`);
    expect(headers.Authorization).toBeUndefined();
  });

  // `https://rss20.example.com@attacker.tld/` a pour hôte réel attacker.tld :
  // tout ce qui précède le « @ » est un userinfo, pas un nom d'hôte.
  it('never attaches the token when the server URL is only a userinfo part', async () => {
    const headers = await proxyGet(`${SERVER_URL}@attacker.tld/pixel.png`);
    expect(headers.Authorization).toBeUndefined();
  });

  // Un sous-chemin doit rester une frontière : le serveur déclaré sous
  // /freshrss ne couvre pas /freshrss-public.
  it('never attaches the token to a sibling path outside the server’s subpath', async () => {
    const add = await request(app).post('/api/servers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Subpath', url: 'https://rss21.example.com/freshrss', freshrssUser: 'admin', freshrssToken: TOKEN });
    const subId = add.body.server.id;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(), body: null });
    vi.stubGlobal('fetch', fetchMock);
    await request(app).get('/api/proxy')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Server-Id', String(subId))
      .set('X-Proxy-Target', 'https://rss21.example.com/freshrss-public/leak');
    const headers = (fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string> })?.headers ?? {};
    expect(headers.Authorization).toBeUndefined();
  });
});

describe('preferences — bornes', () => {
  // Rien ne bornait ces écritures : ni la longueur des clés, ni la taille des
  // valeurs, ni leur nombre. Un compte authentifié pouvait donc remplir le
  // volume SQLite, 5 Mo par requête, indéfiniment.

  it('accepts a realistic sync payload — 31 clés, logo compris', async () => {
    const prefs: Record<string, unknown> = { appLogo: `data:image/png;base64,${'A'.repeat(300 * 1024)}` };
    for (let i = 0; i < 30; i++) prefs[`syncKey${i}`] = { some: 'value', n: i };
    const res = await request(app).put('/api/preferences')
      .set('Authorization', `Bearer ${adminToken}`).send(prefs);
    expect(res.status).toBe(200);

    const read = await request(app).get('/api/preferences')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(read.body.preferences.syncKey7).toEqual({ some: 'value', n: 7 });
  });

  it('rejects an over-long key', async () => {
    const res = await request(app).put('/api/preferences')
      .set('Authorization', `Bearer ${adminToken}`).send({ ['k'.repeat(200)]: 1 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('key_too_long');
  });

  it('rejects an over-large value', async () => {
    const res = await request(app).put('/api/preferences')
      .set('Authorization', `Bearer ${adminToken}`).send({ huge: 'x'.repeat(2 * 1024 * 1024) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('value_too_large');
  });

  it('rejects too many keys in one request', async () => {
    const prefs: Record<string, number> = {};
    for (let i = 0; i < 300; i++) prefs[`bulk${i}`] = i;
    const res = await request(app).put('/api/preferences')
      .set('Authorization', `Bearer ${adminToken}`).send(prefs);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('too_many_keys');
  });

  it('caps the total number of stored keys per user', async () => {
    for (let round = 0; round < 4; round++) {
      const prefs: Record<string, number> = {};
      for (let i = 0; i < 200; i++) prefs[`r${round}k${i}`] = i;
      const res = await request(app).put('/api/preferences')
        .set('Authorization', `Bearer ${adminToken}`).send(prefs);
      if (res.status === 400) {
        expect(res.body.code).toBe('too_many_preferences');
        return;
      }
    }
    throw new Error('the per-user ceiling never triggered');
  });

  it('applies the same bounds to the single-key route', async () => {
    const res = await request(app).put('/api/preferences/single')
      .set('Authorization', `Bearer ${adminToken}`).send({ value: 'x'.repeat(2 * 1024 * 1024) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('value_too_large');
  });

  it('leaves the stored preferences untouched when a request is rejected', async () => {
    await request(app).put('/api/preferences/keeper')
      .set('Authorization', `Bearer ${adminToken}`).send({ value: 'intact' });
    await request(app).put('/api/preferences')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ keeper: 'clobbered', huge: 'x'.repeat(2 * 1024 * 1024) });
    const read = await request(app).get('/api/preferences')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(read.body.preferences.keeper).toBe('intact');
  });
});

describe('oidc discovery', () => {
  // C'était le seul `fetch` sortant du serveur à ne pas passer par le garde
  // anti-SSRF, sur une URL que l'administrateur fixe librement.
  afterEach(() => {
    vi.unstubAllGlobals();
    clearDiscoveryCache();
    setSetting('oidc_issuer', '');
  });

  const okDoc = (authEndpoint: string) => vi.fn().mockResolvedValue({
    ok: true, status: 200, headers: new Headers(),
    json: async () => ({ authorization_endpoint: authEndpoint }),
  });

  it('refuses an issuer aimed at the internal network', async () => {
    setSetting('oidc_issuer', 'http://10.0.0.7/application/o/frirss/');
    clearDiscoveryCache();
    vi.stubGlobal('fetch', okDoc('http://10.0.0.7/authorize'));
    await expect(getDiscovery()).rejects.toThrow();
  });

  it('still fetches a public issuer, at the well-known path', async () => {
    setSetting('oidc_issuer', 'https://auth.example.com/application/o/frirss/');
    clearDiscoveryCache();
    const fetchMock = okDoc('https://auth.example.com/authorize');
    vi.stubGlobal('fetch', fetchMock);

    const doc = await getDiscovery();
    expect(doc.authorization_endpoint).toBe('https://auth.example.com/authorize');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://auth.example.com/application/o/frirss/.well-known/openid-configuration');
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

// ── /api/extract ─────────────────────────────────────────────────────
// La route rejoue les gardes du proxy (JWT, anti-SSRF, classification des
// échecs) sur un chemin distinct : ce sont donc bien deux jeux de gardes à
// vérifier, pas un. Le mock DNS en tête de fichier s'applique ici aussi —
// `example.com` nu résout vers une adresse privée, les sous-domaines vers une
// adresse publique.
describe('extract', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const ARTICLE = `<!doctype html><html><head><title>Titre de la page</title></head>
<body><article><h1>Un vrai titre</h1>
<p>Un premier paragraphe suffisamment long pour que Readability le retienne comme corps de l'article, avec assez de mots pour dépasser son seuil.</p>
<p>Un second paragraphe, lui aussi assez fourni pour peser dans la balance du score de lisibilité calculé par Readability.</p>
</article></body></html>`;

  const streamOf = (chunks: Uint8Array[], onCancel?: () => void) => {
    let i = 0;
    return new ReadableStream<Uint8Array>({
      pull(c) { if (i < chunks.length) c.enqueue(chunks[i++]); else c.close(); },
      cancel() { onCancel?.(); },
    });
  };
  const htmlStream = (html: string) => streamOf([new TextEncoder().encode(html)]);

  const stubUpstream = (body: ReadableStream<Uint8Array>, ctype = 'text/html; charset=utf-8') =>
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ 'content-type': ctype }), body,
    }));

  const get = (url: string) => request(app).get('/api/extract')
    .query({ url }).set('Authorization', `Bearer ${adminToken}`);

  it('rejects requests without a JWT', async () => {
    const res = await request(app).get('/api/extract').query({ url: 'https://news.example.com/a' });
    expect(res.status).toBe(401);
  });

  // Le partage du seau de cadence avec `/api/proxy` est vérifié pour de vrai —
  // deux requêtes proxifiées puis une extraction, plafond abaissé à 2 — dans
  // `server/test/proxyRateLimit.test.ts` : abaisser le plafond demande de
  // stabiliser l'environnement AVANT le chargement des modules, ce que ce
  // fichier-ci ne peut pas faire (il importe `../index.js` en tête).

  // Le message doit couvrir les deux cas qu'il refuse : `file:///etc/passwd`
  // est bien PRÉSENT, et un « Missing url » enverrait chercher le défaut là
  // où il n'est pas.
  it('rejects a missing or non-http url', async () => {
    for (const q of [{}, { url: '' }, { url: 'file:///etc/passwd' }]) {
      const res = await request(app).get('/api/extract')
        .query(q).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status, JSON.stringify(q)).toBe(400);
      expect(res.body, JSON.stringify(q)).toEqual({ error: 'Invalid or missing url' });
    }
  });

  it('blocks an internal/private target (SSRF guard)', async () => {
    const targets = [
      'http://10.0.0.5/a',
      'http://localhost:6379/a',
      'http://169.254.169.254/latest/meta-data/',
      // `example.com` nu est la sentinelle que le mock DNS résout en privé :
      // celle-ci ne passe PAS par le pré-contrôle littéral, elle exerce la
      // garde par résolution, et donc la classification de `finishError`.
      'https://example.com/a',
    ];
    for (const target of targets) {
      const res = await get(target);
      expect(res.status, target).toBe(403);
      expect(res.body, target).toEqual({ error: 'Target host not allowed' });
    }
  });

  it('returns the extracted article', async () => {
    stubUpstream(htmlStream(ARTICLE));
    const res = await get('https://news.example.com/a');
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Titre de la page');
    expect(res.body.content).toContain('premier paragraphe');
  });

  // Un 200 au corps vide priverait le client de son repli : il ne saurait pas
  // distinguer « rien à extraire » de « article vide ».
  it('answers 422, not an empty 200, when the page has no article', async () => {
    stubUpstream(htmlStream('<html><body></body></html>'));
    const res = await get('https://news.example.com/vide');
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: 'Not extractable' });
  });

  it('refuses a non-HTML response without reading its body', async () => {
    let cancelled = false;
    const body = streamOf([new Uint8Array(1024)], () => { cancelled = true; });
    stubUpstream(body, 'application/pdf');
    const res = await get('https://news.example.com/doc.pdf');
    expect(res.status).toBe(415);
    expect(res.body).toEqual({ error: 'Unsupported content type' });
    expect(cancelled).toBe(true);
  });

  // Sous undici, une socket reste retenue tant que le flux n'est ni lu ni
  // annulé : un amont qui répond 500 en boucle accumulerait les connexions.
  it('cancels the body of a failed upstream response', async () => {
    let cancelled = false;
    const body = streamOf([new Uint8Array(1024)], () => { cancelled = true; });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 500, headers: new Headers({ 'content-type': 'text/html' }), body,
    }));
    const res = await get('https://news.example.com/500');
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'Upstream request failed' });
    expect(cancelled).toBe(true);
  });

  // Une réponse SANS `Content-Type` tombe dans le refus 415, comme un type
  // non-HTML : plus étroit que l'ancien chemin par le proxy, et assumé.
  it('refuses a response with no Content-Type at all', async () => {
    let cancelled = false;
    const body = streamOf([new Uint8Array(1024)], () => { cancelled = true; });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers(), body,
    }));
    const res = await get('https://news.example.com/sans-type');
    expect(res.status).toBe(415);
    expect(res.body).toEqual({ error: 'Unsupported content type' });
    expect(cancelled).toBe(true);
  });

  it('refuses a body larger than the cap', async () => {
    // 1 Mo par morceau, 20 morceaux : le plafond (5 Mo) tombe bien avant.
    const chunks = Array.from({ length: 20 }, () => new Uint8Array(1_000_000).fill(0x20));
    stubUpstream(streamOf(chunks));
    const res = await get('https://news.example.com/enorme');
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'Upstream response too large' });
  });

  // Bornes testées directement : les vraies valeurs (5 Mo / 20 s) rendraient
  // le test du délai insupportablement lent.
  describe('readBoundedText', () => {
    const respOf = (body: ReadableStream<Uint8Array>) =>
      ({ body, text: async () => '' }) as unknown as Response;

    it('reads a body that stays within both bounds', async () => {
      const out = await readBoundedText(respOf(htmlStream('<p>ok</p>')), 1000, 1000);
      expect(out).toBe('<p>ok</p>');
    });

    it('rejects past the byte cap', async () => {
      const chunks = [new Uint8Array(50), new Uint8Array(50)];
      await expect(readBoundedText(respOf(streamOf(chunks)), 60, 1000)).rejects.toThrow();
    });

    // Le minuteur de `fetchUpstream` est désarmé à l'arrivée des en-têtes : un
    // amont qui n'envoie jamais la suite du corps tiendrait le gestionnaire
    // pour toujours. L'échec porte `AbortError`, donc un 504 comme sur le proxy.
    it('rejects with AbortError past the time cap', async () => {
      const stalled = new ReadableStream<Uint8Array>({
        start(c) { c.enqueue(new TextEncoder().encode('<p>')); },   // puis plus rien
      });
      await expect(readBoundedText(respOf(stalled), 1_000_000, 20))
        .rejects.toMatchObject({ name: 'AbortError' });
    });
  });
});
