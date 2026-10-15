import { describe, it, expect, beforeEach } from 'vitest';
import db from '../db.js';
import {
  listProviders, createProvider, updateProvider, deleteProvider, reorderProviders,
  adminKeyFor, setUserKey, userKeyFor, hasUserKey, usageToday, bumpUsage,
  aiCacheKey, aiCacheGet, aiCacheSet,
} from './store.js';

beforeEach(() => {
  db.exec('DELETE FROM ai_user_keys; DELETE FROM ai_providers; DELETE FROM ai_usage; DELETE FROM ai_cache;');
  db.prepare("INSERT OR IGNORE INTO users (id, username, role) VALUES (41, 'store-user', 'user')").run();
});

describe('providers', () => {
  it('creates with an encrypted admin key and never lists it', () => {
    const p = createProvider({ name: 'Claude', type: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5', adminKey: 'sk-ant-1', shared: true });
    expect(p.hasAdminKey).toBe(true);
    expect(JSON.stringify(listProviders())).not.toContain('sk-ant-1');
    const raw = db.prepare('SELECT admin_key FROM ai_providers WHERE id = ?').get(p.id) as { admin_key: string };
    expect(raw.admin_key.startsWith('enc:v1:')).toBe(true);
    expect(adminKeyFor(p.id)).toBe('sk-ant-1');
  });
  it('update: undefined keeps the key, empty string clears it', () => {
    const p = createProvider({ name: 'X', type: 'openai', baseUrl: 'http://ollama:11434', model: 'llama3', adminKey: 'k' });
    expect(updateProvider(p.id, { name: 'Y' })!.hasAdminKey).toBe(true);
    expect(updateProvider(p.id, { adminKey: '' })!.hasAdminKey).toBe(false);
  });
  it('orders by position and reorders', () => {
    const a = createProvider({ name: 'A', type: 'openai', baseUrl: 'http://a', model: 'm' });
    const b = createProvider({ name: 'B', type: 'openai', baseUrl: 'http://b', model: 'm' });
    reorderProviders([b.id, a.id]);
    expect(listProviders().map((p) => p.name)).toEqual(['B', 'A']);
    expect(deleteProvider(a.id)).toBe(true);
    expect(listProviders().map((p) => p.name)).toEqual(['B']);
  });
});

describe('user keys', () => {
  it('stores encrypted, reads back, clears with null', () => {
    const p = createProvider({ name: 'A', type: 'openai', baseUrl: 'http://a', model: 'm' });
    setUserKey(41, p.id, 'user-key');
    expect(hasUserKey(41, p.id)).toBe(true);
    expect(userKeyFor(41, p.id)).toBe('user-key');
    const raw = db.prepare('SELECT key FROM ai_user_keys WHERE user_id = 41').get() as { key: string };
    expect(raw.key.startsWith('enc:v1:')).toBe(true);
    setUserKey(41, p.id, null);
    expect(hasUserKey(41, p.id)).toBe(false);
  });
});

describe('usage', () => {
  it('counts per user per day', () => {
    expect(usageToday(41)).toBe(0);
    expect(bumpUsage(41)).toBe(1);
    expect(bumpUsage(41)).toBe(2);
    expect(usageToday(41)).toBe(2);
  });
});

describe('cache', () => {
  it('keys by article, op, provider, lang and prompt version', () => {
    const k1 = aiCacheKey({ articleId: 'tag:google.com,2005:reader/item/1', op: 'summary', providerId: 3 });
    const k2 = aiCacheKey({ articleId: 'tag:google.com,2005:reader/item/1', op: 'summary', providerId: 4 });
    expect(k1).not.toBe(k2);
    expect(k1).toContain(':v1:');
  });
  it('round-trips through SQLite when Redis is off', async () => {
    const k = aiCacheKey({ articleId: 'a', op: 'summary', providerId: 1 });
    expect(await aiCacheGet(k)).toBeNull();
    await aiCacheSet(k, { text: 'résumé', lang: 'fr' });
    expect(await aiCacheGet(k)).toEqual({ text: 'résumé', lang: 'fr' });
  });
});
