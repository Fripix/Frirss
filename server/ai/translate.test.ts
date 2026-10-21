// server/ai/translate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import db, { setSetting } from '../db.js';
import { usageToday } from './store.js';
import { translate, translateDeadlineMs, TRANSLATE_DEADLINE_MAX_MS } from './translate.js';
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
  it('treats as same a source the model reports in the target language, even if it translated anyway', async () => {
    const call = vi.fn().mockResolvedValue(answer('lang: fr\n<s n="0">Bonjour</s>\n<s n="1">le monde</s>'));
    const req = { ...base, articleId: 'tr-same', segments: ['Bonjour', 'le monde'], available: [A(1, 'A')] };
    const r = await translate(req, { call });
    expect(r).toMatchObject({ same: true, segments: [], lang: 'fr', fromCache: false });
    const cached = db.prepare('SELECT text FROM ai_cache').all() as { text: string }[];
    expect(cached).toHaveLength(1);
    expect(cached[0].text).toContain('"same":true');
    const again = await translate(req, { call });
    expect(again).toMatchObject({ same: true, segments: [], lang: 'fr', fromCache: true });
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('treats a region-tagged source language as the target, scripts apart', async () => {
    const regional = vi.fn().mockResolvedValue(answer('lang: fr-CH\n<s n="0">Bonjour</s>'));
    expect(await translate({ ...base, articleId: 'tr-ch', available: [A(1, 'A')] }, { call: regional }))
      .toMatchObject({ same: true, segments: [], lang: 'fr-CH' });
    const traditional = vi.fn().mockResolvedValue(answer('lang: zh-TW\n<s n="0">你好</s>'));
    expect(await translate({ ...base, articleId: 'tr-tw', targetLang: 'zh-Hant', available: [A(1, 'A')] }, { call: traditional }))
      .toMatchObject({ same: true, segments: [] });
    expect(await translate({ ...base, articleId: 'tr-tw', targetLang: 'zh-Hans', available: [A(1, 'A')] }, { call: traditional }))
      .toMatchObject({ same: false, segments: ['你好'] });
  });
  it('returns the segments when the source language differs from the target or is unknown', async () => {
    const other = vi.fn().mockResolvedValue(answer('lang: en\n<s n="0">Bonjour</s>'));
    expect(await translate({ ...base, articleId: 'tr-en', available: [A(1, 'A')] }, { call: other }))
      .toMatchObject({ same: false, segments: ['Bonjour'], lang: 'en' });
    const unknown = vi.fn().mockResolvedValue(answer('<s n="0">Bonjour</s>'));
    expect(await translate({ ...base, articleId: 'tr-null', available: [A(1, 'A')] }, { call: unknown }))
      .toMatchObject({ same: false, segments: ['Bonjour'], lang: null });
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

describe('translate deadline, proportional to the batch', () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
  // Un lot de n mots, réparti sur plusieurs segments (avec du balisage, qui ne compte pas).
  const batch = (n: number) => [words(n / 2), `<em>${words(n / 2)}</em>`];
  const fixed = (t: number) => () => t;

  it('is base + per word, capped at 110 s (nginx gives /api/ 120 s)', () => {
    expect(TRANSLATE_DEADLINE_MAX_MS).toBe(110_000);
    expect(translateDeadlineMs(0)).toBe(20_000);
    expect(translateDeadlineMs(300)).toBe(42_500);
    expect(translateDeadlineMs(1_200)).toBe(110_000);
    expect(translateDeadlineMs(5_000)).toBe(110_000);
  });
  it('gives a 1 200-word batch 110 s for its call, beyond the 60 s default', async () => {
    const call = vi.fn().mockResolvedValue(answer('lang: en\n<s n="0">a</s>\n<s n="1">b</s>'));
    await translate({ ...base, articleId: 'dl-1200', segments: batch(1_200), available: [A(1, 'Ollama')] }, { call, now: fixed(0) });
    expect(call.mock.calls[0][2].timeoutMs).toBe(110_000);
  });
  it('gives a 300-word batch 42.5 s', async () => {
    const call = vi.fn().mockResolvedValue(answer('lang: en\n<s n="0">a</s>\n<s n="1">b</s>'));
    await translate({ ...base, articleId: 'dl-300', segments: batch(300), available: [A(1, 'Ollama')] }, { call, now: fixed(0) });
    expect(call.mock.calls[0][2].timeoutMs).toBe(42_500);
  });
  it('counts a spaceless script by pairs of characters, like the client', async () => {
    const call = vi.fn().mockResolvedValue(answer('lang: zh\n<s n="0">a</s>'));
    await translate({ ...base, articleId: 'dl-zh', segments: ['日'.repeat(1_000)], available: [A(1, 'Ollama')] }, { call, now: fixed(0) });
    expect(call.mock.calls[0][2].timeoutMs).toBe(20_000 + 500 * 75);
  });
  it('shrinks the next candidate\'s timeout to what is left of the budget', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      let t = 0;
      const call = vi.fn()
        .mockImplementationOnce(async () => { t += 70_000; throw new AiError('technical', 'slow'); })
        .mockResolvedValueOnce(answer('lang: en\n<s n="0">a</s>\n<s n="1">b</s>'));
      const r = await translate({ ...base, articleId: 'dl-shrink', segments: batch(1_200), available: [A(1, 'A'), A(2, 'B')] }, { call, now: () => t });
      expect(r).toMatchObject({ providerName: 'B', fellBackFrom: 'A' });
      expect(call.mock.calls.map((c) => c[2].timeoutMs)).toEqual([110_000, 40_000]);
    } finally {
      warn.mockRestore();
    }
  });
  it('still falls back when the first provider fails fast, with the whole budget', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const call = vi.fn()
        .mockRejectedValueOnce(new AiError('technical', 'down'))
        .mockResolvedValueOnce(answer('lang: en\n<s n="0">a</s>\n<s n="1">b</s>'));
      const r = await translate({ ...base, articleId: 'dl-fast', segments: batch(300), available: [A(1, 'A'), A(2, 'B')] }, { call, now: fixed(0) });
      expect(r).toMatchObject({ providerName: 'B', fellBackFrom: 'A' });
      expect(call.mock.calls.map((c) => c[2].timeoutMs)).toEqual([42_500, 42_500]);
    } finally {
      warn.mockRestore();
    }
  });
  it('stops below the 2 s floor: the timed-out error comes back, no further call', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      let t = 0;
      const call = vi.fn(async () => { t += 41_000; throw new AiError('technical', 'A: aborted (timeout)'); });
      await expect(translate({ ...base, articleId: 'dl-floor', segments: batch(300), available: [A(1, 'A'), A(2, 'B')] }, { call, now: () => t }))
        .rejects.toMatchObject({ message: 'A: aborted (timeout)' });
      expect(call).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
  it('bounds the malformed-answer replay by the same budget', async () => {
    let t = 0;
    const call = vi.fn()
      .mockImplementationOnce(async () => { t += 30_000; return answer('nope'); })
      .mockResolvedValueOnce(answer('lang: en\n<s n="0">a</s>\n<s n="1">b</s>'));
    await translate({ ...base, articleId: 'dl-replay', segments: batch(1_200), available: [A(1, 'A')] }, { call, now: () => t });
    expect(call.mock.calls.map((c) => c[2].timeoutMs)).toEqual([110_000, 80_000]);
  });
});
