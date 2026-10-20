// server/ai/translate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import db, { setSetting } from '../db.js';
import { usageToday } from './store.js';
import { translate } from './translate.js';
import { SUMMARY_DEADLINE_MS } from './summarize.js';
import { AiError } from './errors.js';
import type { Availability } from './resolve.js';
import type { AiProvider, ProviderType } from './store.js';

const P = (id: number, name: string, type: ProviderType = 'openai'): AiProvider => ({ id, name, type, baseUrl: 'https://x', model: 'm', hasAdminKey: false, shared: false, position: id });
const A = (id: number, name: string, paidByAdmin = false, type: ProviderType = 'openai'): Availability => ({ provider: P(id, name, type), key: paidByAdmin ? 'admin' : null, paidByAdmin, own: false });
const base = { userId: 44, articleId: 'tr-1', scope: 'article' as const, targetLang: 'fr' as const, segments: ['Hello'], resolution: { adminDefault: 1 }, fallback: true };
const answer = (text: string) => ({ text, model: 'm', inputTokens: 1, outputTokens: 1, durationMs: 1 });
const ok = () => vi.fn().mockResolvedValue(answer('lang: en\n<s n="0">Bonjour</s>'));

beforeEach(() => {
  db.exec('DELETE FROM ai_usage; DELETE FROM ai_cache;');
  db.prepare("INSERT OR IGNORE INTO users (id, username, role) VALUES (44, 'tr-user', 'user')").run();
  setSetting('ai_daily_cap', '2');
});

describe('translate', () => {
  it('translates one batch with the strict format and a translate cache key', async () => {
    const call = ok();
    const r = await translate({ ...base, available: [A(1, 'Ollama')] }, { call });
    expect(r).toMatchObject({ segments: ['Bonjour'], lang: 'en', same: false, providerId: 1, providerName: 'Ollama', fromCache: false });
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][2].user).toBe('<s n="0">Hello</s>');
    expect(call.mock.calls[0][2].system).toMatch(/\bfr\b/);
    const keys = (db.prepare('SELECT key FROM ai_cache').all() as { key: string }[]).map((k) => k.key);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain(':translate:');
    expect(keys[0]).toContain(':fr:');
    const again = await translate({ ...base, available: [A(1, 'Ollama')] }, { call });
    expect(again).toMatchObject({ segments: ['Bonjour'], lang: 'en', same: false, fromCache: true });
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('replays once a malformed answer, then fails with segments', async () => {
    const call = vi.fn()
      .mockResolvedValueOnce(answer('lang: en\n<s n="1">Monde</s>'))
      .mockResolvedValueOnce(answer('lang: en\n<s n="0">Bonjour</s>\n<s n="1">Monde</s>'));
    const r = await translate({ ...base, segments: ['Hello', 'World'], available: [A(1, 'A')] }, { call });
    expect(r.segments).toEqual(['Bonjour', 'Monde']);
    expect(call).toHaveBeenCalledTimes(2);

    const bad = vi.fn().mockResolvedValue(answer('Bonjour'));
    await expect(translate({ ...base, articleId: 'tr-bad', fallback: false, available: [A(1, 'A')] }, { call: bad }))
      .rejects.toMatchObject({ kind: 'technical', message: 'segments' });
    expect(bad).toHaveBeenCalledTimes(2);
  });
  it('does not replay when the deadline leaves no room', async () => {
    let t = 0;
    const bad = vi.fn(async () => { t = SUMMARY_DEADLINE_MS - 1_000; return answer('nope'); });
    await expect(translate({ ...base, fallback: false, available: [A(1, 'A')] }, { call: bad, now: () => t }))
      .rejects.toMatchObject({ kind: 'technical', message: 'segments' });
    expect(bad).toHaveBeenCalledTimes(1);
  });
  it('falls back to the next provider after two malformed answers', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const call = vi.fn()
        .mockResolvedValueOnce(answer('x'))
        .mockResolvedValueOnce(answer('y'))
        .mockResolvedValueOnce(answer('lang: en\n<s n="0">Bonjour</s>'));
      const r = await translate({ ...base, available: [A(1, 'A'), A(2, 'B')] }, { call });
      expect(r).toMatchObject({ providerName: 'B', fellBackFrom: 'A', segments: ['Bonjour'] });
      expect(warn.mock.calls).toEqual([['AI fallback:', 'A', 'technical', 'segments']]);
    } finally {
      warn.mockRestore();
    }
  });
  it('answers same without text and caches it', async () => {
    const call = vi.fn().mockResolvedValue(answer('lang: fr\nsame'));
    const r = await translate({ ...base, segments: ['Bonjour'], available: [A(1, 'A')] }, { call });
    expect(r).toMatchObject({ same: true, segments: [], lang: 'fr', fromCache: false });
    const again = await translate({ ...base, segments: ['Bonjour'], available: [A(1, 'A')] }, { call });
    expect(again).toMatchObject({ same: true, segments: [], lang: 'fr', fromCache: true });
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('passes maxTokens 8192 to an anthropic provider only', async () => {
    const call = ok();
    await translate({ ...base, available: [A(1, 'Claude', false, 'anthropic')] }, { call });
    expect(call.mock.calls[0][2].maxTokens).toBe(8192);
    await translate({ ...base, available: [A(2, 'Ollama')] }, { call });
    expect(call.mock.calls[1][2].maxTokens).toBeUndefined();
  });
  it('charges one cap unit per batch and refunds a failed one', async () => {
    await translate({ ...base, articleId: 'b1', available: [A(1, 'Paid', true)] }, { call: ok() });
    expect(usageToday(44)).toBe(1);
    // Un rejeu ne compte pas double : c'est le même lot.
    const replayed = vi.fn().mockResolvedValueOnce(answer('x')).mockResolvedValueOnce(answer('<s n="0">Bonjour</s>'));
    await translate({ ...base, articleId: 'b2', available: [A(1, 'Paid', true)] }, { call: replayed });
    expect(usageToday(44)).toBe(2);
    setSetting('ai_daily_cap', '5');
    const failing = vi.fn().mockRejectedValue(new AiError('technical', 'down'));
    await expect(translate({ ...base, articleId: 'b3', fallback: false, available: [A(1, 'Paid', true)] }, { call: failing })).rejects.toMatchObject({ message: 'down' });
    const malformed = vi.fn().mockResolvedValue(answer('x'));
    await expect(translate({ ...base, articleId: 'b4', fallback: false, available: [A(1, 'Paid', true)] }, { call: malformed })).rejects.toMatchObject({ message: 'segments' });
    expect(usageToday(44)).toBe(2);
  });
  it('does not share a cache entry between two targets, two scopes or two batches', async () => {
    const call = ok();
    const avail = [A(1, 'A')];
    await translate({ ...base, available: avail }, { call });
    await translate({ ...base, targetLang: 'de', available: avail }, { call });
    await translate({ ...base, scope: 'summary', available: avail }, { call });
    await translate({ ...base, segments: ['Hi'], available: avail }, { call });
    expect(call).toHaveBeenCalledTimes(4);
  });
  it('uses the translation stage after a force', async () => {
    const call = ok();
    const r = await translate({ ...base, resolution: { translation: 2, feed: 1 }, available: [A(1, 'A'), A(2, 'B')] }, { call });
    expect(r.providerName).toBe('B');
  });
});
