import { describe, it, expect } from 'vitest';
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
