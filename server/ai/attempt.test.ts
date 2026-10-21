// server/ai/attempt.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import db, { setSetting } from '../db.js';
import { usageToday, bumpUsage, aiCacheSet } from './store.js';
import { runWithFallback, type Attempt } from './attempt.js';
import { AiError } from './errors.js';
import type { Availability } from './resolve.js';
import type { AiProvider } from './store.js';

const P = (id: number, name: string): AiProvider => ({ id, name, type: 'openai', baseUrl: 'https://x', model: 'm', hasAdminKey: false, shared: false, position: id });
const A = (id: number, name: string, paidByAdmin = false): Availability => ({ provider: P(id, name), key: paidByAdmin ? 'admin' : null, paidByAdmin, own: false });

function attempt(over: Partial<Attempt<string>>): Attempt<string> {
  return {
    userId: 43, resolution: {}, available: [A(1, 'One'), A(2, 'Two')], fallback: true,
    deadline: Date.now() + 50_000, now: Date.now,
    cacheKeyFor: (cand) => `attempt-test:${cand.provider.id}`,
    call: vi.fn().mockResolvedValue('ok'),
    ...over,
  };
}

beforeEach(() => {
  db.exec('DELETE FROM ai_usage; DELETE FROM ai_cache;');
  db.prepare("INSERT OR IGNORE INTO users (id, username, role) VALUES (43, 'attempt-user', 'user')").run();
  setSetting('ai_daily_cap', '2');
});

describe('runWithFallback', () => {
  it('falls back to the next candidate and says where it came from', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const call = vi.fn().mockRejectedValueOnce(new AiError('technical', 'down')).mockResolvedValueOnce('ok');
      const r = await runWithFallback(attempt({ call }));
      expect(r).toMatchObject({ result: 'ok', fromCache: false, fellBackFrom: 'One' });
      expect(r.cand.provider.name).toBe('Two');
      expect(warn.mock.calls).toEqual([['AI fallback:', 'One', 'technical', 'down']]);
    } finally {
      warn.mockRestore();
    }
  });
  it('skips a capped admin-paid candidate and gives its reservation back', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      bumpUsage(43); bumpUsage(43);
      const call = vi.fn().mockResolvedValue('ok');
      const r = await runWithFallback(attempt({ call, available: [A(1, 'Paid', true), A(2, 'Free')] }));
      expect(r.cand.provider.name).toBe('Free');
      expect(r.fellBackFrom).toBeUndefined();
      expect(call).toHaveBeenCalledTimes(1);
      expect(usageToday(43)).toBe(2);
      expect(warn.mock.calls).toEqual([['AI fallback:', 'Paid', 'quota', 'daily cap reached']]);
    } finally {
      warn.mockRestore();
    }
  });
  it('serves a cache hit without reserving anything or calling', async () => {
    await aiCacheSet('attempt-test:1', { text: 'cached', lang: 'fr' });
    const call = vi.fn();
    const r = await runWithFallback(attempt({ call, available: [A(1, 'Paid', true)] }));
    expect(r).toMatchObject({ result: { text: 'cached', lang: 'fr' }, fromCache: true });
    expect(call).not.toHaveBeenCalled();
    expect(usageToday(43)).toBe(0);
  });
  it('skips the cache read when asked, calls, counts, and replaces the cached value', async () => {
    await aiCacheSet('attempt-test:1', { text: 'old', lang: 'fr' });
    const call = vi.fn().mockResolvedValue('new');
    const r = await runWithFallback(attempt({ call, available: [A(1, 'Paid', true)], skipCacheRead: true, onSuccess: async (_c, v) => ({ text: v, lang: 'fr' }) }));
    expect(r).toMatchObject({ result: 'new', fromCache: false });
    expect(call).toHaveBeenCalledTimes(1);
    expect(usageToday(43)).toBe(1);
    const again = await runWithFallback(attempt({ call, available: [A(1, 'Paid', true)] }));
    expect(again).toMatchObject({ result: { text: 'new' }, fromCache: true });
  });
  it('cacheOnly: without a cache entry, throws not_cached without calling or reserving', async () => {
    const call = vi.fn();
    await expect(runWithFallback(attempt({ call, cacheOnly: true, available: [A(1, 'Paid', true), A(2, 'Other', true)] })))
      .rejects.toMatchObject({ kind: 'technical', message: 'not_cached' });
    expect(call).not.toHaveBeenCalled();
    expect(usageToday(43)).toBe(0);
  });
  it('cacheOnly: with a cache entry on the second candidate, serves it without a call', async () => {
    await aiCacheSet('attempt-test:2', { text: 'cached', lang: 'fr' });
    const call = vi.fn();
    const r = await runWithFallback(attempt({ call, cacheOnly: true, available: [A(1, 'Paid', true), A(2, 'Other', true)] }));
    expect(r).toMatchObject({ result: { text: 'cached', lang: 'fr' }, fromCache: true });
    expect(r.cand.provider.name).toBe('Other');
    expect(call).not.toHaveBeenCalled();
    expect(usageToday(43)).toBe(0);
  });
  it('cacheOnly: an exhausted deadline or a reached cap does not change the answer', async () => {
    bumpUsage(43); bumpUsage(43);
    const call = vi.fn();
    await expect(runWithFallback(attempt({ call, cacheOnly: true, deadline: Date.now() - 1, available: [A(1, 'Paid', true)] })))
      .rejects.toMatchObject({ message: 'not_cached' });
    await aiCacheSet('attempt-test:1', { text: 'cached', lang: 'fr' });
    const r = await runWithFallback(attempt({ call, cacheOnly: true, deadline: Date.now() - 1, available: [A(1, 'Paid', true)] }));
    expect(r.fromCache).toBe(true);
    expect(usageToday(43)).toBe(2);
    expect(call).not.toHaveBeenCalled();
  });
  it('throws the first error when fallback is off', async () => {
    const call = vi.fn().mockRejectedValue(new AiError('auth', 'HTTP 401', 401));
    await expect(runWithFallback(attempt({ call, fallback: false }))).rejects.toMatchObject({ kind: 'auth', message: 'HTTP 401', ownKey: false });
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('stores what onSuccess returns under the candidate key, and keeps a paid call counted', async () => {
    const r = await runWithFallback(attempt({
      available: [A(1, 'Paid', true)],
      onSuccess: async (_cand, result) => ({ text: result.toUpperCase(), lang: null }),
    }));
    expect(r.result).toBe('ok');
    expect(db.prepare('SELECT text FROM ai_cache WHERE key = ?').get('attempt-test:1')).toEqual({ text: 'OK' });
    expect(usageToday(43)).toBe(1);
  });
  it('refunds a failed paid call', async () => {
    const call = vi.fn().mockRejectedValue(new AiError('technical', 'down'));
    await expect(runWithFallback(attempt({ call, fallback: false, available: [A(1, 'Paid', true)] }))).rejects.toMatchObject({ message: 'down' });
    expect(usageToday(43)).toBe(0);
  });
  it('passes the time left, capped at the provider timeout, and stops at the deadline', async () => {
    let t = 0;
    const call = vi.fn(async (_cand: Availability, timeoutMs: number) => { t += 49_000; throw new AiError('technical', `t${timeoutMs}`); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(runWithFallback(attempt({ call, now: () => t, deadline: 50_000 }))).rejects.toMatchObject({ message: 't50000' });
    } finally {
      warn.mockRestore();
    }
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('throws a noFallback error at once: no next candidate, no fallback line, the reservation refunded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const call = vi.fn().mockRejectedValueOnce(Object.assign(new AiError('technical', 'segments'), { noFallback: true })).mockResolvedValueOnce('ok');
      await expect(runWithFallback(attempt({ call, available: [A(1, 'Paid', true), A(2, 'Two')] })))
        .rejects.toMatchObject({ kind: 'technical', message: 'segments', ownKey: false });
      expect(call).toHaveBeenCalledTimes(1);
      expect(usageToday(43)).toBe(0);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
  it('says no_provider when nothing is available', async () => {
    await expect(runWithFallback(attempt({ available: [] }))).rejects.toMatchObject({ kind: 'technical', message: 'no_provider' });
  });
});
