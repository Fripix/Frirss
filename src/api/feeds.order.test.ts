import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import client from './client';
import { getStreamContents } from './feeds';

const get = vi.mocked(client.get);

/** Les paramètres de requête réellement envoyés par le n-ième appel. */
const sentParams = (call = 0): Record<string, unknown> =>
  (get.mock.calls[call][1] as { params: Record<string, unknown> }).params;

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ status: 200, data: { items: [], continuation: null } } as never);
});

describe('getStreamContents — ordre des articles', () => {
  it("n'envoie pas de paramètre r par défaut : FreshRSS livre les plus récents d'abord", async () => {
    await getStreamContents('feed/1', 20, null, null);
    expect(sentParams()).not.toHaveProperty('r');
  });

  it("demande les plus anciens d'abord avec r=o", async () => {
    await getStreamContents('feed/1', 20, null, null, { order: 'oldest' });
    expect(sentParams().r).toBe('o');
  });

  it("garde la continuation et le filtre d'exclusion avec l'ordre inverse", async () => {
    await getStreamContents('feed/1', 20, 'c1', 'user/-/state/com.google/read', { order: 'oldest' });
    expect(sentParams()).toMatchObject({ c: 'c1', xt: 'user/-/state/com.google/read', r: 'o' });
  });
});
