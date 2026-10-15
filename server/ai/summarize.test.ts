// server/ai/summarize.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import db, { setSetting } from '../db.js';
import { usageToday, bumpUsage } from './store.js';
import { summarize } from './summarize.js';
import { AiError } from './errors.js';
import type { Availability } from './resolve.js';
import type { AiProvider } from './store.js';

const P = (id: number, name: string): AiProvider => ({ id, name, type: 'openai', baseUrl: 'https://x', model: 'm', hasAdminKey: false, shared: false, position: id });
const A = (id: number, name: string, paidByAdmin = false): Availability => ({ provider: P(id, name), key: paidByAdmin ? 'admin' : null, paidByAdmin });
const html = '<p>' + 'mot '.repeat(60) + '</p>';
const base = { userId: 41, articleId: 'art-1', title: 'T', html, resolution: { adminDefault: 1 }, fallback: true };

beforeEach(() => {
  db.exec('DELETE FROM ai_usage; DELETE FROM ai_cache;');
  db.prepare("INSERT OR IGNORE INTO users (id, username, role) VALUES (41, 'sum-user', 'user')").run();
  setSetting('ai_daily_cap', '2');
});

describe('summarize', () => {
  it('calls the resolved provider with the article text and strips the lang line', async () => {
    const call = vi.fn().mockResolvedValue({ text: 'lang: fr\n\nRésumé.', model: 'm', inputTokens: 1, outputTokens: 1, durationMs: 5 });
    const r = await summarize({ ...base, available: [A(1, 'Ollama')] }, { call });
    expect(r).toMatchObject({ text: 'Résumé.', lang: 'fr', providerId: 1, providerName: 'Ollama', fromCache: false });
    expect(call.mock.calls[0][2].user).toContain('mot mot');
    expect(call.mock.calls[0][2].user).toContain('Title: T');
    expect(call.mock.calls[0][2].user.startsWith('<article>')).toBe(true);
    expect(call.mock.calls[0][2].user.endsWith('Summarise the article above.')).toBe(true);
  });
  it('puts the requested ratio in the system prompt, 20 % by default', async () => {
    const call = vi.fn().mockResolvedValue({ text: 'lang: fr\n\nR.', model: 'm', inputTokens: 1, outputTokens: 1, durationMs: 1 });
    await summarize({ ...base, articleId: 'r-def', available: [A(1, 'A')] }, { call });
    expect(call.mock.calls[0][2].system).toContain('about 20%');
    await summarize({ ...base, articleId: 'r-40', ratio: 40, available: [A(1, 'A')] }, { call });
    expect(call.mock.calls[1][2].system).toContain('about 40%');
  });
  it('does not share a cache entry between two ratios', async () => {
    const call = vi.fn().mockResolvedValue({ text: 'lang: fr\n\nR.', model: 'm', inputTokens: 1, outputTokens: 1, durationMs: 1 });
    await summarize({ ...base, ratio: 10, available: [A(1, 'A')] }, { call });
    const other = await summarize({ ...base, ratio: 30, available: [A(1, 'A')] }, { call });
    expect(other.fromCache).toBe(false);
    expect(call).toHaveBeenCalledTimes(2);
    const again = await summarize({ ...base, ratio: 10, available: [A(1, 'A')] }, { call });
    expect(again.fromCache).toBe(true);
    const keys = (db.prepare('SELECT key FROM ai_cache').all() as { key: string }[]).map((r) => r.key);
    expect(keys.some((k) => k.includes(':r10:'))).toBe(true);
    expect(keys.some((k) => k.includes(':r30:'))).toBe(true);
  });
  it('serves the cache on the second call without calling the provider', async () => {
    const call = vi.fn().mockResolvedValue({ text: 'lang: fr\n\nRésumé.', model: 'm', inputTokens: 1, outputTokens: 1, durationMs: 5 });
    await summarize({ ...base, available: [A(1, 'Ollama')] }, { call });
    const again = await summarize({ ...base, available: [A(1, 'Ollama')] }, { call });
    expect(again.fromCache).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('falls back on a technical error and reports where it came from', async () => {
    const call = vi.fn()
      .mockRejectedValueOnce(new AiError('technical', 'down'))
      .mockResolvedValueOnce({ text: 'lang: en\n\nOk.', model: 'm', inputTokens: 1, outputTokens: 1, durationMs: 5 });
    const r = await summarize({ ...base, available: [A(1, 'Claude'), A(2, 'Ollama')] }, { call });
    expect(r.providerName).toBe('Ollama');
    expect(r.fellBackFrom).toBe('Claude');
  });
  it('never falls back after a refusal, nor when fallback is off', async () => {
    const refusing = vi.fn().mockRejectedValue(new AiError('refused', 'no'));
    await expect(summarize({ ...base, available: [A(1, 'A'), A(2, 'B')] }, { call: refusing })).rejects.toMatchObject({ kind: 'refused' });
    expect(refusing).toHaveBeenCalledTimes(1);
    const failing = vi.fn().mockRejectedValue(new AiError('technical', 'down'));
    await expect(summarize({ ...base, fallback: false, available: [A(1, 'A'), A(2, 'B')] }, { call: failing })).rejects.toMatchObject({ kind: 'technical' });
    expect(failing).toHaveBeenCalledTimes(1);
  });
  it('counts the daily cap only when the admin key pays', async () => {
    const call = vi.fn().mockResolvedValue({ text: 'lang: fr\n\nR.', model: 'm', inputTokens: 1, outputTokens: 1, durationMs: 1 });
    for (const id of ['x1', 'x2']) await summarize({ ...base, articleId: id, available: [A(1, 'Paid', true)] }, { call });
    await expect(summarize({ ...base, articleId: 'x3', available: [A(1, 'Paid', true)] }, { call })).rejects.toMatchObject({ kind: 'quota', message: 'ai_daily_cap' });
    await expect(summarize({ ...base, articleId: 'x4', available: [A(2, 'Free')] }, { call })).resolves.toBeTruthy();
  });
  it('refuses a too-short article before any call', async () => {
    const call = vi.fn();
    await expect(summarize({ ...base, html: '<p>trop court</p>', available: [A(1, 'A')] }, { call })).rejects.toMatchObject({ message: 'article_too_short' });
    expect(call).not.toHaveBeenCalled();
  });
  const ok = () => vi.fn().mockResolvedValue({ text: 'lang: fr\n\nR.', model: 'm', inputTokens: 1, outputTokens: 1, durationMs: 1 });
  const reachCap = () => { bumpUsage(41); bumpUsage(41); };

  it('skips a capped admin-paid candidate and falls through to an unpaid one without reporting a fallback', async () => {
    reachCap();
    const call = ok();
    const r = await summarize({ ...base, available: [A(1, 'Paid', true), A(2, 'Own')] }, { call });
    expect(r.providerName).toBe('Own');
    expect(r.fellBackFrom).toBeUndefined();
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('rejects ai_daily_cap when every candidate is paid and capped, or when fallback is off', async () => {
    reachCap();
    const call = ok();
    await expect(summarize({ ...base, available: [A(1, 'P1', true), A(2, 'P2', true)] }, { call })).rejects.toMatchObject({ kind: 'quota', message: 'ai_daily_cap' });
    await expect(summarize({ ...base, fallback: false, available: [A(1, 'Paid', true), A(2, 'Own')] }, { call })).rejects.toMatchObject({ message: 'ai_daily_cap' });
    expect(call).not.toHaveBeenCalled();
  });
  it('prefers a real provider error over the cap marker', async () => {
    reachCap();
    const call = vi.fn().mockRejectedValue(new AiError('technical', 'down'));
    await expect(summarize({ ...base, available: [A(1, 'Paid', true), A(2, 'Own')] }, { call })).rejects.toMatchObject({ message: 'down' });
  });
  it('does not bump usage for an unpaid provider', async () => {
    await summarize({ ...base, available: [A(2, 'Own')] }, { call: ok() });
    expect(usageToday(41)).toBe(0);
  });
  it('serves a cached summary for free under the cap', async () => {
    await summarize({ ...base, available: [A(1, 'Paid', true)] }, { call: ok() });
    reachCap();
    const call = ok();
    const r = await summarize({ ...base, available: [A(1, 'Paid', true)] }, { call });
    expect(r.fromCache).toBe(true);
    expect(call).not.toHaveBeenCalled();
  });
  it('does not share a cache entry between two bodies under the same articleId', async () => {
    const call = ok();
    await summarize({ ...base, available: [A(1, 'A')] }, { call });
    await summarize({ ...base, html: '<p>' + 'autre '.repeat(60) + '</p>', available: [A(1, 'A')] }, { call });
    expect(call).toHaveBeenCalledTimes(2);
  });
  it('does not share a cache entry between two titles for the same body', async () => {
    const call = ok();
    await summarize({ ...base, title: 'Premier titre', available: [A(1, 'A')] }, { call });
    await summarize({ ...base, title: 'Second titre', available: [A(1, 'A')] }, { call });
    expect(call).toHaveBeenCalledTimes(2);
  });
  it('does not serve a summary cached under another model of the same provider', async () => {
    const call = ok();
    await summarize({ ...base, available: [A(1, 'A')] }, { call });
    const other = { ...A(1, 'A'), provider: { ...P(1, 'A'), model: 'm2' } };
    const r = await summarize({ ...base, available: [other] }, { call });
    expect(r.fromCache).toBe(false);
    expect(call).toHaveBeenCalledTimes(2);
  });
  it('wraps a non-AiError with a fixed message, falls back, and logs only strings', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // L'erreur porte la requête (en-têtes, clé) comme le ferait une erreur de client HTTP.
      const boom = () => Object.assign(new Error('network exploded'), { config: { headers: { 'x-api-key': 'sk-123' } } });
      const call = vi.fn()
        .mockRejectedValueOnce(boom())
        .mockResolvedValueOnce({ text: 'lang: en\n\nOk.', model: 'm', inputTokens: 1, outputTokens: 1, durationMs: 1 });
      const r = await summarize({ ...base, available: [{ ...A(1, 'A'), key: 'sk-123' }, A(2, 'B')] }, { call });
      expect(r.providerName).toBe('B');
      const solo = vi.fn().mockRejectedValue(boom());
      await expect(summarize({ ...base, fallback: false, available: [{ ...A(1, 'A'), key: 'sk-123' }] }, { call: solo })).rejects.toMatchObject({ kind: 'technical', message: 'provider_error' });
      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls[0]).toEqual(['AI provider error:', 'A', 'Error', 'network exploded']);
      expect(JSON.stringify(spy.mock.calls)).not.toContain('sk-123');
    } finally {
      spy.mockRestore();
    }
  });
});
