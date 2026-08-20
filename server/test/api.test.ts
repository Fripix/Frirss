import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import app from '../index.js';
import { encrypt, decrypt } from '../crypto.js';
import { cacheEnabled, cacheGet, trimStreamJson } from '../cache.js';

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

  it('starts a real refresh, keeping credentials out of the URL, and the job settles to done', async () => {
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
    expect(calledUrl).toBe('https://rss5.example.com/i/?c=feed&a=actualize');
    expect(calledInit.method).toBe('POST');
    expect(calledInit.redirect).toBe('manual');
    expect(calledInit.body.get('token')).toBe('master-tok-789');
    expect(calledInit.body.get('maxFeeds')).toBe('1000');

    await tick();
    const status = await request(app).get(`/api/servers/${id}/actualize`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(status.body.job.status).toBe('done');
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
      const [, calledInit] = fetchMock.mock.calls[0];
      expect(calledInit.body.get('maxFeeds')).toBe('1000');
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
    const [, calledInit] = fetchMock.mock.calls[0];
    expect(calledInit.body.get('maxFeeds')).toBe('5');
  });

  it('records a failed refresh without leaking the master token', async () => {
    const add = await request(app).post('/api/servers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Failing', url: 'https://rss8.example.com', freshrssUser: 'admin', freshrssToken: 'tok-123' });
    const id = add.body.server.id;
    await request(app).put(`/api/servers/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ refreshToken: 'master-tok-secret' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    await request(app).post(`/api/servers/${id}/actualize`)
      .set('Authorization', `Bearer ${adminToken}`);
    await tick();

    const status = await request(app).get(`/api/servers/${id}/actualize`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(status.body.job.status).toBe('failed');
    expect(status.body.job.error).not.toContain('master-tok-secret');
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
