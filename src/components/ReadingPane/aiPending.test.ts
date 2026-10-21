import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sharedSummaryRequest, sharedTranslationRequest, summaryRequestKey, summaryTranslationKey, articleBatchKey, __resetPendingSummariesForTests } from './aiPending';

const RESULT = { text: 'R', lang: 'fr', providerId: 1, providerName: 'P', model: 'm', fromCache: false };

beforeEach(() => { __resetPendingSummariesForTests(); });

describe('sharedSummaryRequest', () => {
  it('hands back the pending request for the same key, and starts one per key', async () => {
    const start = vi.fn(() => Promise.resolve(RESULT));
    const a = sharedSummaryRequest('u:a1:', start);
    expect(sharedSummaryRequest('u:a1:', start)).toBe(a);
    void sharedSummaryRequest('u:a1:2', start);
    expect(start).toHaveBeenCalledTimes(2);
    await a;
  });
  it('forgets a request once it has settled, success or failure', async () => {
    const ok = vi.fn(() => Promise.resolve(RESULT));
    await sharedSummaryRequest('k', ok);
    await sharedSummaryRequest('k', ok);
    expect(ok).toHaveBeenCalledTimes(2);
    const failing = vi.fn(() => Promise.reject(new Error('boom')));
    await sharedSummaryRequest('f', failing).catch(() => {});
    await sharedSummaryRequest('f', failing).catch(() => {});
    expect(failing).toHaveBeenCalledTimes(2);
  });
});

describe('sharedTranslationRequest', () => {
  const TRANSLATION = { segments: ['T'], lang: 'en', same: false, providerId: 1, providerName: 'P', model: 'm', fromCache: false };
  it('hands back the pending translation for the same key, apart from the summaries', async () => {
    const start = vi.fn(() => Promise.resolve(TRANSLATION));
    const a = sharedTranslationRequest('u:a1:en:', start);
    expect(sharedTranslationRequest('u:a1:en:', start)).toBe(a);
    void sharedTranslationRequest('u:a1:de:', start);
    expect(start).toHaveBeenCalledTimes(2);
    const summary = vi.fn(() => Promise.resolve(RESULT));
    void sharedSummaryRequest('u:a1:en:', summary);
    expect(summary).toHaveBeenCalledTimes(1);
    await a;
    await sharedTranslationRequest('u:a1:en:', start);
    expect(start).toHaveBeenCalledTimes(3);
  });
  it('tells the running request whether any caller still waits for it', async () => {
    let wanted: () => boolean = () => false;
    let release!: () => void;
    const start = vi.fn((w: () => boolean) => { wanted = w; return new Promise<typeof TRANSLATION>((res) => { release = () => res(TRANSLATION); }); });
    let first = true;
    let second = false;
    const a = sharedTranslationRequest('w', start, () => first);
    expect(wanted()).toBe(true);
    first = false;
    expect(wanted()).toBe(false);
    // Un appelant revenu entre-temps se rattache : la demande reste voulue.
    expect(sharedTranslationRequest('w', start, () => second)).toBe(a);
    second = true;
    expect(wanted()).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
    release();
    await a;
  });
  it('a caller without a check always wants the request', async () => {
    let wanted: () => boolean = () => false;
    const p = sharedTranslationRequest('n', (w) => { wanted = w; return Promise.resolve(TRANSLATION); });
    expect(wanted()).toBe(true);
    await p;
  });
});

describe('request keys: a regeneration never joins a normal request', () => {
  it('summary: a regeneration has its own key, and two identical regenerations share theirs', async () => {
    const normal = summaryRequestKey({ user: 2, articleId: 'a1', providerId: 1 });
    const regen = summaryRequestKey({ user: 2, articleId: 'a1', providerId: 1, regenerate: true });
    expect(regen).not.toBe(normal);
    expect(summaryRequestKey({ user: 2, articleId: 'a1', providerId: 1, regenerate: true })).toBe(regen);
    const start = vi.fn(() => new Promise<typeof RESULT>(() => {}));
    void sharedSummaryRequest(normal, start);
    const r1 = sharedSummaryRequest(regen, start);
    expect(sharedSummaryRequest(regen, start)).toBe(r1);
    expect(start).toHaveBeenCalledTimes(2);
  });
  it('translations: the summary and the article batches get a regeneration key of their own', () => {
    const t = { user: 2, articleId: 'a1', lang: 'de', providerId: 3, text: 'R' };
    expect(summaryTranslationKey({ ...t, regenerate: true })).not.toBe(summaryTranslationKey(t));
    expect(summaryTranslationKey({ ...t, regenerate: true })).toBe(summaryTranslationKey({ ...t, regenerate: true }));
    const b = { user: 2, articleId: 'a1', lang: 'de', providerId: 3, hash: 'h', batch: 0 };
    expect(articleBatchKey({ ...b, regenerate: true })).not.toBe(articleBatchKey(b));
    expect(articleBatchKey({ ...b, regenerate: true })).toBe(articleBatchKey({ ...b, regenerate: true }));
  });
});
