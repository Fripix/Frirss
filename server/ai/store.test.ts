import { describe, it, expect, beforeEach } from 'vitest';
import db from '../db.js';
import {
  listProviders, createProvider, updateProvider, deleteProvider, reorderProviders,
  adminKeyFor, setUserKey, userKeyFor, hasUserKey, usageToday, bumpUsage, refundUsage,
  aiCacheKey, aiCacheGet, aiCacheSet, getProvider, normalizeBaseUrl, nextUsageReset,
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
  it('a new address or type forgets every stored key: they were given for the old host', () => {
    // Sinon la clé de l'admin et celles des utilisateurs partaient vers le nouvel hôte.
    const p = createProvider({ name: 'C', type: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'm', adminKey: 'sk-ant' });
    setUserKey(41, p.id, 'user-key');
    expect(updateProvider(p.id, { baseUrl: 'https://openrouter.ai/api' })!.hasAdminKey).toBe(false);
    expect(adminKeyFor(p.id)).toBeNull();
    expect(hasUserKey(41, p.id)).toBe(false);
  });
  it('a new address with a new key keeps that key only', () => {
    const p = createProvider({ name: 'C', type: 'openai', baseUrl: 'https://api.openai.com', model: 'm', adminKey: 'old' });
    setUserKey(41, p.id, 'user-key');
    updateProvider(p.id, { baseUrl: 'https://gateway.example.com', adminKey: 'new' });
    expect(adminKeyFor(p.id)).toBe('new');
    expect(hasUserKey(41, p.id)).toBe(false);
  });
  it('a new type forgets the keys too; the same address written differently keeps them', () => {
    const p = createProvider({ name: 'O', type: 'openai', baseUrl: 'http://ollama:11434', model: 'm', adminKey: 'k' });
    setUserKey(41, p.id, 'user-key');
    updateProvider(p.id, { baseUrl: 'http://ollama:11434/v1/', name: 'Ollama', model: 'm2' });
    expect(adminKeyFor(p.id)).toBe('k');
    expect(hasUserKey(41, p.id)).toBe(true);
    updateProvider(p.id, { type: 'anthropic' });
    expect(adminKeyFor(p.id)).toBeNull();
    expect(hasUserKey(41, p.id)).toBe(false);
  });
  it('normalises the base URL: trailing slashes, then a trailing /v1', () => {
    expect(normalizeBaseUrl('http://ollama:11434/v1/')).toBe('http://ollama:11434');
    expect(normalizeBaseUrl('https://api.openai.com/V1')).toBe('https://api.openai.com');
    expect(normalizeBaseUrl('https://api.anthropic.com//')).toBe('https://api.anthropic.com');
    expect(normalizeBaseUrl('https://host/proxy/v1beta')).toBe('https://host/proxy/v1beta');
    const p = createProvider({ name: 'O', type: 'openai', baseUrl: 'http://ollama:11434/v1/', model: 'm' });
    expect(p.baseUrl).toBe('http://ollama:11434');
    expect(updateProvider(p.id, { baseUrl: 'https://api.openai.com/v1' })!.baseUrl).toBe('https://api.openai.com');
    expect(getProvider(p.id)!.baseUrl).toBe('https://api.openai.com');
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
  it('gives a reservation back, never below zero', () => {
    bumpUsage(41);
    refundUsage(41);
    expect(usageToday(41)).toBe(0);
    refundUsage(41);
    expect(usageToday(41)).toBe(0);
  });
  it('resets at the next local midnight', () => {
    const now = new Date(2026, 9, 15, 18, 30);
    const reset = new Date(nextUsageReset(now));
    expect(reset.getTime()).toBe(new Date(2026, 9, 16, 0, 0).getTime());
  });
});

describe('cache', () => {
  it('keys by article, op, provider, lang and prompt version', () => {
    const k1 = aiCacheKey({ articleId: 'tag:google.com,2005:reader/item/1', op: 'summary', providerId: 3, model: 'm' });
    const k2 = aiCacheKey({ articleId: 'tag:google.com,2005:reader/item/1', op: 'summary', providerId: 4, model: 'm' });
    expect(k1).not.toBe(k2);
    expect(k1).toContain(':v4:');
    expect(aiCacheKey({ articleId: 'a', op: 'translate', providerId: 1, model: 'm', lang: 'fr', contentHash: 'h' })).toMatch(/^frirss:ai:v4:translate:/);
  });
  it('binds the key to the model', () => {
    const a = aiCacheKey({ articleId: 'a', op: 'summary', providerId: 1, model: 'llama3' });
    const b = aiCacheKey({ articleId: 'a', op: 'summary', providerId: 1, model: 'llama3.1' });
    expect(a).not.toBe(b);
  });
  it('binds the key to the length ratio', () => {
    const a = aiCacheKey({ articleId: 'a', op: 'summary', providerId: 1, model: 'm', ratio: 20 });
    const b = aiCacheKey({ articleId: 'a', op: 'summary', providerId: 1, model: 'm', ratio: 35 });
    expect(a).not.toBe(b);
    expect(a).toContain(':r20:');
  });
  it('binds the key to the content hash', () => {
    const a = aiCacheKey({ articleId: 'a', op: 'summary', providerId: 1, model: 'm', contentHash: 'h1' });
    const b = aiCacheKey({ articleId: 'a', op: 'summary', providerId: 1, model: 'm', contentHash: 'h2' });
    expect(a).not.toBe(b);
  });
  it('round-trips through SQLite when Redis is off', async () => {
    const k = aiCacheKey({ articleId: 'a', op: 'summary', providerId: 1, model: 'm' });
    expect(await aiCacheGet(k)).toBeNull();
    await aiCacheSet(k, { text: 'résumé', lang: 'fr' });
    expect(await aiCacheGet(k)).toEqual({ text: 'résumé', lang: 'fr' });
  });
  it('purges the oldest rows first, insertion order breaking created_at ties', async () => {
    const ins = db.prepare("INSERT INTO ai_cache (key, text, lang, created_at) VALUES (?, 't', NULL, '2026-01-01 00:00:00')");
    // Clés en ordre alphabétique inverse de l'insertion : seul le rowid désigne la plus ancienne.
    db.transaction(() => { for (let i = 0; i < 10_000; i++) ins.run(`z${String(99_999 - i).padStart(5, '0')}`); })();
    await aiCacheSet('newest', { text: 'n', lang: null });
    const n = (db.prepare('SELECT COUNT(*) AS n FROM ai_cache').get() as { n: number }).n;
    expect(n).toBe(10_000);
    expect(db.prepare("SELECT 1 FROM ai_cache WHERE key = 'z99999'").get()).toBeUndefined();
    expect(db.prepare("SELECT 1 FROM ai_cache WHERE key = 'z90000'").get()).toBeTruthy();
    expect(db.prepare("SELECT 1 FROM ai_cache WHERE key = 'newest'").get()).toBeTruthy();
  });
});
