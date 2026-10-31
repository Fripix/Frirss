import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import client from './client';
import { getItemsByIds, getStreamIdsSince } from './feeds';

const get = vi.mocked(client.get);
const post = vi.mocked(client.post);
const refs = (...ids: number[]) => ids.map((id) => ({ id: String(id) }));

beforeEach(() => vi.clearAllMocks());

describe('getStreamIdsSince', () => {
  it('suit les pages jusqu’au bout', async () => {
    get.mockResolvedValueOnce({ data: { itemRefs: refs(9, 8), continuation: 'c2' } } as never);
    get.mockResolvedValueOnce({ data: { itemRefs: refs(7) } } as never);
    expect(await getStreamIdsSince('feed/1', { excludeRead: false, cutoffUsec: null, max: 100 })).toEqual(['9', '8', '7']);
    expect(get.mock.calls[1][1]).toMatchObject({ params: { c: 'c2', s: 'feed/1' } });
  });

  it('n’exclut les lus que sous Non lus, et ne demande jamais `ot`', async () => {
    get.mockResolvedValue({ data: { itemRefs: [] } } as never);
    await getStreamIdsSince('feed/1', { excludeRead: true, cutoffUsec: 5n, max: 100 });
    await getStreamIdsSince('feed/1', { excludeRead: false, cutoffUsec: null, max: 100 });
    const [first, second] = get.mock.calls.map((c) => (c[1] as { params: Record<string, unknown> }).params);
    expect(first.xt).toBe('user/-/state/com.google/read');
    expect(second.xt).toBeUndefined();
    expect(first.ot).toBeUndefined();
  });

  // Ils arrivent du plus récent au plus ancien : le premier trop vieux clôt le relevé.
  it('s’arrête au seuil, sans page de plus', async () => {
    get.mockResolvedValueOnce({ data: { itemRefs: refs(30, 20, 10), continuation: 'c2' } } as never);
    expect(await getStreamIdsSince('feed/1', { excludeRead: false, cutoffUsec: 20n, max: 100 })).toEqual(['30', '20']);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('s’arrête au plafond', async () => {
    get.mockResolvedValue({ data: { itemRefs: refs(5, 4, 3), continuation: 'suite' } } as never);
    expect(await getStreamIdsSince('feed/1', { excludeRead: false, cutoffUsec: null, max: 2 })).toEqual(['5', '4']);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('une continuation qui revient ne tourne pas sans fin', async () => {
    get.mockResolvedValue({ data: { itemRefs: refs(5), continuation: 'même' } } as never);
    await getStreamIdsSince('feed/1', { excludeRead: false, cutoffUsec: null, max: 10_000 });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('rejette une réponse qui n’est pas du JSON', async () => {
    get.mockResolvedValue({ data: '<html>login</html>' } as never);
    await expect(getStreamIdsSince('feed/1', { excludeRead: false, cutoffUsec: null, max: 10 })).rejects.toThrow();
  });
});

describe('getItemsByIds', () => {
  const ids = Array.from({ length: 250 }, (_, i) => String(i + 1));

  it('charge par lots de 100, sans jeton d’écriture', async () => {
    post.mockResolvedValue({ data: { items: [{ id: 'x' }] } } as never);
    const items = await getItemsByIds(ids);
    expect(post).toHaveBeenCalledTimes(3);
    const [url, body] = post.mock.calls[0] as [string, URLSearchParams];
    expect(url).toMatch(/\/stream\/items\/contents$/);
    expect(body.getAll('i')).toEqual(ids.slice(0, 100));
    expect(body.has('T')).toBe(false);
    expect(items).toHaveLength(3);
  });

  it('rien à charger, aucun appel', async () => {
    expect(await getItemsByIds([])).toEqual([]);
    expect(post).not.toHaveBeenCalled();
  });

  it('rejette une réponse qui n’est pas du JSON', async () => {
    post.mockResolvedValue({ data: '<html>login</html>' } as never);
    await expect(getItemsByIds(['1'])).rejects.toThrow();
  });
});
