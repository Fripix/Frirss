import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import request from 'supertest';
import app from '../index.js';
import db, { getSetting } from '../db.js';

let adminToken: string;
let userToken: string;

beforeAll(async () => {
  const reg = await request(app).post('/api/auth/register')
    .send({ username: 'root', password: 'secret123', email: 'root@example.com', displayName: 'Root' });
  adminToken = reg.body.token;
  await request(app).post('/api/admin/users').set('Authorization', `Bearer ${adminToken}`)
    .send({ username: 'alice', password: 'secret123', email: 'alice@example.com', role: 'user' });
  const login = await request(app).post('/api/auth/login').send({ username: 'alice', password: 'secret123' });
  userToken = login.body.token;
});

describe('ai schema', () => {
  it('creates the four ai_ tables', () => {
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ai_%'").all() as { name: string }[]).map((r) => r.name).sort();
    expect(names).toEqual(['ai_cache', 'ai_providers', 'ai_usage', 'ai_user_keys']);
  });
  it('ships disabled, keys admin-only, cap 50', () => {
    expect(getSetting('ai_enabled')).toBe('false');
    expect(getSetting('ai_user_keys_allowed')).toBe('false');
    expect(getSetting('ai_daily_cap')).toBe('50');
  });
});

function stubProvider(text = 'lang: fr\n\nRésumé long.') {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, status: 200, headers: new Headers(),
    text: async () => '', json: async () => ({ model: 'm', choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: {} }),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
afterEach(() => vi.unstubAllGlobals());
const longHtml = '<p>' + 'mot '.repeat(80) + '</p>';

describe('ai routes while disabled', () => {
  it('config says disabled and summary is 404', async () => {
    const cfg = await request(app).get('/api/ai/config').set('Authorization', `Bearer ${userToken}`);
    expect(cfg.body).toMatchObject({ enabled: false, providers: [] });
    const sum = await request(app).post('/api/ai/summary').set('Authorization', `Bearer ${userToken}`)
      .send({ articleId: 'a', title: 't', html: longHtml });
    expect(sum.status).toBe(404);
    expect(sum.body.error).toBe('ai_disabled');
  });
  it('admin routes refuse a plain user', async () => {
    const res = await request(app).get('/api/admin/ai/providers').set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });
});

describe('ai admin + summary', () => {
  let providerId: number;
  it('admin creates a provider, the key never comes back', async () => {
    const res = await request(app).post('/api/admin/ai/providers').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Ollama', type: 'openai', baseUrl: 'https://ollama.example.com/', model: 'llama3', adminKey: 'secret-k', shared: true });
    expect(res.status).toBe(201);
    providerId = res.body.provider.id;
    expect(res.body.provider.hasAdminKey).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('secret-k');
    expect(res.body.provider.baseUrl).toBe('https://ollama.example.com');
  });
  it('admin enables the feature and sets the default', async () => {
    const res = await request(app).put('/api/admin/ai/settings').set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: true, defaultProvider: providerId, dailyCap: 5 });
    expect(res.status).toBe(200);
    const cfg = await request(app).get('/api/ai/config').set('Authorization', `Bearer ${userToken}`);
    expect(cfg.body.enabled).toBe(true);
    expect(cfg.body.providers[0]).toMatchObject({ id: providerId, name: 'Ollama', available: true, hasUserKey: false });
    expect(JSON.stringify(cfg.body)).not.toContain('secret-k');
  });
  it('user gets a summary, then the cached one', async () => {
    const fetchMock = stubProvider();
    const first = await request(app).post('/api/ai/summary').set('Authorization', `Bearer ${userToken}`)
      .send({ articleId: 'art-route-1', title: 'Titre', html: longHtml });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ text: 'Résumé long.', lang: 'fr', providerName: 'Ollama', fromCache: false });
    const second = await request(app).post('/api/ai/summary').set('Authorization', `Bearer ${userToken}`)
      .send({ articleId: 'art-route-1', title: 'Titre', html: longHtml });
    expect(second.body.fromCache).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(cfgUsage(userToken)).resolves.toBe(1);
  });
  it('rejects a short article with 400 and a bad body with 400', async () => {
    const short = await request(app).post('/api/ai/summary').set('Authorization', `Bearer ${userToken}`)
      .send({ articleId: 'a2', title: 't', html: '<p>court</p>' });
    expect(short.status).toBe(400);
    expect(short.body.error).toBe('article_too_short');
    const bad = await request(app).post('/api/ai/summary').set('Authorization', `Bearer ${userToken}`).send({ title: 't' });
    expect(bad.status).toBe(400);
  });
  it('bounds articleId, title and html', async () => {
    const post = (b: object) => request(app).post('/api/ai/summary').set('Authorization', `Bearer ${userToken}`).send(b);
    const longId = await post({ articleId: 'x'.repeat(600), title: 't', html: longHtml });
    expect(longId.status).toBe(400);
    expect(longId.body.error).toBe('invalid_body');
    const big = await post({ articleId: 'big', title: 't', html: '<p>' + 'a'.repeat(201 * 1024) + '</p>' });
    expect(big.status).toBe(400);
    expect(big.body.error).toBe('invalid_body');
  });
  it('maps a provider 500 to 502 ai_failed and a content filter to 422 ai_refused', async () => {
    const post = (id: string) => request(app).post('/api/ai/summary').set('Authorization', `Bearer ${userToken}`)
      .send({ articleId: id, title: 't', html: longHtml, fallback: false });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, headers: new Headers(), text: async () => 'boom', json: async () => ({}) }));
    const fail = await post('art-502');
    expect(fail.status).toBe(502);
    expect(fail.body).toMatchObject({ error: 'ai_failed', kind: 'technical' });
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers(), text: async () => '',
      json: async () => ({ model: 'm', choices: [{ message: { content: '' }, finish_reason: 'content_filter' }], usage: {} }),
    }));
    const refused = await post('art-422');
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe('ai_refused');
  });
  it('rejects invalid settings atomically and strictly', async () => {
    const put = (b: object) => request(app).put('/api/admin/ai/settings').set('Authorization', `Bearer ${adminToken}`).send(b);
    expect(getSetting('ai_enabled')).toBe('true');
    const half = await put({ enabled: false, dailyCap: -1 });
    expect(half.status).toBe(400);
    expect(half.body.error).toBe('invalid_cap');
    expect(getSetting('ai_enabled')).toBe('true');
    const unknown = await put({ defaultProvider: 999 });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toBe('unknown_provider');
    expect((await put({ defaultProvider: String(providerId) })).status).toBe(400);
    expect((await put({ enabled: 'false' })).status).toBe(200);
    expect(getSetting('ai_enabled')).toBe('false');
    expect((await put({ enabled: true })).status).toBe(200);
    expect(getSetting('ai_enabled')).toBe('true');
  });
  it('lists without keys, validates partial updates, reorders exactly the existing ids', async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };
    const second = await request(app).post('/api/admin/ai/providers').set(auth)
      .send({ name: 'Second', type: 'anthropic', baseUrl: 'https://api.example.com', model: 'm2', adminKey: 'secret-2' });
    const id2 = second.body.provider.id as number;
    const list = await request(app).get('/api/admin/ai/providers').set(auth);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain('secret-k');
    expect(JSON.stringify(list.body)).not.toContain('secret-2');
    expect(list.body.providers.map((p: { id: number }) => p.id)).toEqual([providerId, id2]);

    expect((await request(app).put(`/api/admin/ai/providers/${id2}`).set(auth).send({ name: '  ' })).status).toBe(400);
    expect((await request(app).put(`/api/admin/ai/providers/${id2}`).set(auth).send({ adminKey: 42 })).status).toBe(400);

    const partial = await request(app).put('/api/admin/ai/providers/order').set(auth).send({ ids: [id2] });
    expect(partial.status).toBe(400);
    expect(partial.body.error).toBe('invalid_order');
    expect((await request(app).put('/api/admin/ai/providers/order').set(auth).send({ ids: [id2, id2] })).status).toBe(400);
    const ok = await request(app).put('/api/admin/ai/providers/order').set(auth).send({ ids: [id2, providerId] });
    expect(ok.status).toBe(200);
    const after = await request(app).get('/api/admin/ai/providers').set(auth);
    expect(after.body.providers.map((p: { id: number }) => p.id)).toEqual([id2, providerId]);

    expect((await request(app).delete(`/api/admin/ai/providers/${id2}`).set(auth)).status).toBe(200);
  });
  it('the test route reports a failure without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, headers: new Headers(), text: async () => 'nope', json: async () => ({}) }));
    const res = await request(app).post(`/api/admin/ai/providers/${providerId}/test`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: false, kind: 'auth' });
    expect(JSON.stringify(res.body)).not.toContain('secret-k');
  });
  it('deleting the default provider leaves config consistent', async () => {
    const del = await request(app).delete(`/api/admin/ai/providers/${providerId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(200);
    const cfg = await request(app).get('/api/ai/config').set('Authorization', `Bearer ${userToken}`);
    expect(cfg.body.providers).toEqual([]);
    expect(cfg.body.defaultProvider).toBeNull();
  });
});

async function cfgUsage(token: string): Promise<number> {
  const cfg = await request(app).get('/api/ai/config').set('Authorization', `Bearer ${token}`);
  return cfg.body.usageToday as number;
}
