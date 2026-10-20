import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from 'vitest';
import request from 'supertest';
import app from '../index.js';
import db, { getSetting, setSetting } from '../db.js';

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
  it('passes a valid ratio to the prompt and falls back to 20 for anything else, never 400', async () => {
    const fetchMock = stubProvider();
    const post = (articleId: string, ratio: unknown) => request(app).post('/api/ai/summary').set('Authorization', `Bearer ${userToken}`)
      .send({ articleId, title: 't', html: longHtml, ratio });
    const system = (i: number) => JSON.parse(fetchMock.mock.calls[i][1].body).messages[0].content as string;
    // Six appels payés par la clé admin : le plafond (5) n'est pas ce qu'on teste ici.
    const usage = db.prepare('SELECT user_id, day, count FROM ai_usage').all() as { user_id: number; day: string; count: number }[];
    const cap = getSetting('ai_daily_cap');
    setSetting('ai_daily_cap', '0');
    expect((await post('ratio-ok', 35)).status).toBe(200);
    expect(system(0)).toContain('about 35%');
    const bad: unknown[] = [3, 55, 12.5, '30', null];
    for (const [i, r] of bad.entries()) {
      const res = await post(`ratio-bad-${i}`, r);
      expect(res.status, String(r)).toBe(200);
      expect(system(i + 1), String(r)).toContain('about 20%');
    }
    setSetting('ai_daily_cap', cap ?? '50');
    db.exec('DELETE FROM ai_usage');
    const ins = db.prepare('INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, ?)');
    for (const u of usage) ins.run(u.user_id, u.day, u.count);
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

describe('ai base URL validation', () => {
  it('refuses a base URL that is not a parseable http(s) URL with a host', async () => {
    const post = (baseUrl: string) => request(app).post('/api/admin/ai/providers').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Bad', type: 'openai', baseUrl, model: 'm' });
    for (const bad of ['http://', 'https://', 'ftp://example.com', 'example.com', 'http//example.com']) {
      const res = await post(bad);
      expect(res.status, bad).toBe(400);
      expect(res.body.error).toBe('invalid_provider');
    }
  });
});

describe('ai admin role', () => {
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const sum = (t: string, articleId: string) => request(app).post('/api/ai/summary').set(auth(t))
    .send({ articleId, title: 't', html: longHtml });

  it('caps a plain user on a shared admin-paid provider, never the admin', async () => {
    db.exec('DELETE FROM ai_usage; DELETE FROM ai_cache;');
    const created = await request(app).post('/api/admin/ai/providers').set(auth(adminToken))
      .send({ name: 'Shared', type: 'openai', baseUrl: 'https://shared.example.com', model: 'm', adminKey: 'k-shared', shared: true });
    const id = created.body.provider.id as number;
    expect((await request(app).put('/api/admin/ai/settings').set(auth(adminToken)).send({ enabled: true, dailyCap: 1, defaultProvider: id })).status).toBe(200);
    stubProvider();

    expect((await sum(userToken, 'cap-u1')).status).toBe(200);
    const capped = await sum(userToken, 'cap-u2');
    expect(capped.status).toBe(429);
    expect(capped.body).toMatchObject({ error: 'ai_daily_cap', cap: 1 });
    const reset = Date.parse(capped.body.resetAt);
    expect(Number.isNaN(reset)).toBe(false);
    expect(reset).toBeGreaterThan(Date.now());
    expect(reset - Date.now()).toBeLessThanOrEqual(25 * 3600 * 1000);

    expect((await sum(adminToken, 'cap-a1')).status).toBe(200);
    expect((await sum(adminToken, 'cap-a2')).status).toBe(200);
    expect(await cfgUsage(adminToken)).toBe(0);

    expect((await request(app).delete(`/api/admin/ai/providers/${id}`).set(auth(adminToken))).status).toBe(200);
  });
  it('an unshared provider with an admin key serves the admin only', async () => {
    const created = await request(app).post('/api/admin/ai/providers').set(auth(adminToken))
      .send({ name: 'Private', type: 'openai', baseUrl: 'https://private.example.com', model: 'm', adminKey: 'k-private', shared: false });
    const id = created.body.provider.id as number;
    stubProvider();

    const user = await sum(userToken, 'priv-u');
    expect(user.status).toBe(409);
    expect(user.body.error).toBe('no_provider');
    const admin = await sum(adminToken, 'priv-a');
    expect(admin.status).toBe(200);
    expect(admin.body.providerName).toBe('Private');

    expect((await request(app).delete(`/api/admin/ai/providers/${id}`).set(auth(adminToken))).status).toBe(200);
  });
});

async function cfgUsage(token: string): Promise<number> {
  const cfg = await request(app).get('/api/ai/config').set('Authorization', `Bearer ${token}`);
  return cfg.body.usageToday as number;
}

describe('ai model listing', () => {
  const auth = () => ({ Authorization: `Bearer ${adminToken}` });
  const list = (body: object) => request(app).post('/api/admin/ai/models').set(auth()).send(body);
  function stubModels(body: unknown = { data: [{ id: 'gpt-5-mini', created: 2 }, { id: 'text-embedding-3-small', created: 3 }, { id: 'gpt-5', created: 1 }] }, status = 200) {
    const fetchMock = vi.fn().mockResolvedValue({ ok: status < 300, status, headers: new Headers(), text: async () => JSON.stringify(body), json: async () => body });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }
  const bearer = (m: ReturnType<typeof stubModels>) => ((m.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>).Authorization;
  afterEach(() => vi.unstubAllGlobals());

  it('is closed to a plain user', async () => {
    const res = await request(app).post('/api/admin/ai/models').set('Authorization', `Bearer ${userToken}`).send({ type: 'openai', baseUrl: 'https://api.example.com' });
    expect(res.status).toBe(403);
  });
  it('refuses an unknown type or a URL that is not http(s)', async () => {
    expect((await list({ type: 'gemini', baseUrl: 'https://api.example.com' })).status).toBe(400);
    expect((await list({ type: 'openai', baseUrl: 'ftp://api.example.com' })).status).toBe(400);
    expect((await list({ type: 'openai' })).status).toBe(400);
  });
  it('lists the text models of a draft with the key typed in the form', async () => {
    const m = stubModels();
    const res = await list({ type: 'openai', baseUrl: 'https://api.example.com/v1/', adminKey: 'typed-key' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, models: ['gpt-5-mini', 'gpt-5'] });
    expect(m.mock.calls[0][0]).toBe('https://api.example.com/v1/models');
    expect(bearer(m)).toBe('Bearer typed-key');
  });
  it('reuses the stored key for the saved URL only, and never returns it', async () => {
    const created = await request(app).post('/api/admin/ai/providers').set(auth())
      .send({ name: 'GPT', type: 'openai', baseUrl: 'https://api.example.com', model: 'gpt-5', adminKey: 'stored-key', shared: true });
    const id = created.body.provider.id;
    let m = stubModels();
    const same = await list({ type: 'openai', baseUrl: 'https://api.example.com/', providerId: id });
    expect(bearer(m)).toBe('Bearer stored-key');
    expect(JSON.stringify(same.body)).not.toContain('stored-key');
    // Une autre URL ou un autre type : la clé enregistrée ne part pas.
    m = stubModels();
    await list({ type: 'openai', baseUrl: 'https://elsewhere.example.com', providerId: id });
    expect(bearer(m)).toBeUndefined();
    m = stubModels({ data: [] });
    await list({ type: 'anthropic', baseUrl: 'https://api.example.com', providerId: id });
    expect(((m.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>)['x-api-key']).toBeUndefined();
    expect((await request(app).delete(`/api/admin/ai/providers/${id}`).set(auth())).status).toBe(200);
  });
  it('reports a refused key as ok:false kind:auth, without the key', async () => {
    stubModels({ error: 'bad typed-key' }, 401);
    const res = await list({ type: 'openai', baseUrl: 'https://api.example.com', adminKey: 'typed-key' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: false, kind: 'auth' });
    expect(JSON.stringify(res.body)).not.toContain('typed-key');
  });
});

describe('ai personal keys', () => {
  const admin = () => ({ Authorization: `Bearer ${adminToken}` });
  const user = () => ({ Authorization: `Bearer ${userToken}` });
  const put = (providerId: number | string, body: unknown) => request(app).put(`/api/ai/keys/${providerId}`).set(user()).send(body as object);
  const config = async () => (await request(app).get('/api/ai/config').set(user())).body;
  const mine = async (id: number) => (await config()).providers.find((p: { id: number }) => p.id === id);
  const allow = (userKeysAllowed: boolean) => request(app).put('/api/admin/ai/settings').set(admin()).send({ userKeysAllowed });
  const summarise = (articleId: string) => request(app).post('/api/ai/summary').set(user())
    .send({ articleId, title: 't', html: longHtml, fallback: false });
  const bearer = (m: ReturnType<typeof stubProvider>) => ((m.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>).Authorization;

  let id: number;
  let wasEnabled: boolean;
  let wasAllowed: boolean;
  let wasCap: string | null;
  beforeAll(async () => {
    const before = (await request(app).get('/api/admin/ai/providers').set(admin())).body.settings;
    wasEnabled = before.enabled;
    wasAllowed = before.userKeysAllowed;
    wasCap = getSetting('ai_daily_cap');
    // Plafond neutralisé : la clé admin est payante, ce qu'on teste ici est quelle clé part, pas le quota.
    setSetting('ai_daily_cap', '0');
    await request(app).put('/api/admin/ai/settings').set(admin()).send({ enabled: true, userKeysAllowed: false });
    const created = await request(app).post('/api/admin/ai/providers').set(admin())
      .send({ name: 'Perso', type: 'openai', baseUrl: 'https://personal.example.com', model: 'm', adminKey: 'admin-key', shared: true });
    id = created.body.provider.id;
  });
  afterAll(async () => {
    await request(app).delete(`/api/admin/ai/providers/${id}`).set(admin());
    await request(app).put('/api/admin/ai/settings').set(admin()).send({ enabled: wasEnabled, userKeysAllowed: wasAllowed });
    setSetting('ai_daily_cap', wasCap ?? '50');
  });

  it('refuses while user keys are not allowed, then stores, reports and clears a key', async () => {
    expect((await put(id, { key: 'mine' })).status).toBe(403);
    expect((await put(id, { key: 'mine' })).body).toEqual({ error: 'user_keys_disabled' });
    await allow(true);
    const ok = await put(id, { key: '  mine  ' });
    expect(ok.body).toEqual({ ok: true, hasUserKey: true });
    expect(JSON.stringify(ok.body)).not.toContain('mine');
    expect((await mine(id)).hasUserKey).toBe(true);
    expect(JSON.stringify(await config())).not.toContain('mine');
    expect((await put(id, { key: null })).body).toEqual({ ok: true, hasUserKey: false });
    expect((await mine(id)).hasUserKey).toBe(false);
    await put(id, { key: 'mine' });
    expect((await put(id, { key: '' })).body.hasUserKey).toBe(false);
    await put(id, { key: 'mine' });
    expect((await put(id, { key: '   ' })).body.hasUserKey).toBe(false);
  });
  it('validates the body and the provider', async () => {
    await allow(true);
    expect((await put(id, { key: 42 })).status).toBe(400);
    expect((await put(id, { key: 42 })).body).toEqual({ error: 'invalid_key' });
    expect((await put(id, {})).status).toBe(400);
    expect((await put(id, { key: 'x'.repeat(4097) })).status).toBe(400);
    expect((await put(id, { key: 'x'.repeat(4096) })).status).toBe(200);
    await put(id, { key: null });
    expect((await put(999999, { key: 'k' })).status).toBe(404);
    expect((await put(999999, { key: 'k' })).body).toEqual({ error: 'not_found' });
    expect((await put('abc', { key: 'k' })).status).toBe(404);
  });
  it('answers 404 ai_disabled while the feature is off', async () => {
    await allow(true);
    await request(app).put('/api/admin/ai/settings').set(admin()).send({ enabled: false });
    const res = await put(id, { key: 'k' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'ai_disabled' });
    await request(app).put('/api/admin/ai/settings').set(admin()).send({ enabled: true });
  });
  it('ignores stored personal keys while the admin disallows them, and restores them after', async () => {
    await allow(true);
    await put(id, { key: 'mine' });
    await allow(false);
    expect((await mine(id)).hasUserKey).toBe(false);
    let m = stubProvider();
    expect((await summarise('own-key-off')).status).toBe(200);
    expect(bearer(m)).toBe('Bearer admin-key');
    await allow(true);
    expect((await mine(id)).hasUserKey).toBe(true);
    m = stubProvider();
    expect((await summarise('own-key-on')).status).toBe(200);
    expect(bearer(m)).toBe('Bearer mine');
    await put(id, { key: null });
  });
  it('says ownKey when the refused key was the user\'s own, and only then', async () => {
    const refuse = () => vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, headers: new Headers(), text: async () => 'nope', json: async () => ({}) }));
    await allow(true);
    await put(id, { key: 'mine' });
    refuse();
    const own = await summarise('own-refused');
    expect(own.status).toBe(502);
    expect(own.body).toEqual({ error: 'ai_failed', kind: 'auth', ownKey: true });
    await put(id, { key: null });
    refuse();
    const shared = await summarise('shared-refused');
    expect(shared.status).toBe(502);
    expect(shared.body).toEqual({ error: 'ai_failed', kind: 'auth' });
  });
});
