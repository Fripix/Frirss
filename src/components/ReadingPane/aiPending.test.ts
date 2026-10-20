import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sharedSummaryRequest, __resetPendingSummariesForTests } from './aiPending';

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
