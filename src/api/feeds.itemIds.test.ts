import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import client from './client';
import { itemIdsNewerThan } from './feeds';

const get = vi.mocked(client.get);

beforeEach(() => { vi.clearAllMocks(); });

describe('itemIdsNewerThan', () => {
  it('demande le bon flux, la borne basse et une grande page', async () => {
    get.mockResolvedValue({ data: { itemRefs: [{ id: '1' }], continuation: null } } as never);

    await itemIdsNewerThan('feed/21', 1_700_000_001);

    const [url, config] = get.mock.calls[0] as [string, { params: Record<string, unknown> }];
    expect(url).toContain('/stream/items/ids');
    expect(config.params.s).toBe('feed/21');
    expect(config.params.ot).toBe(1_700_000_001);
    expect(config.params.n).toBe(1000);
  });

  it('suit la continuation jusqu’à épuisement et rend tous les identifiants', async () => {
    get
      .mockResolvedValueOnce({ data: { itemRefs: [{ id: '1' }, { id: '2' }], continuation: 'C1' } } as never)
      .mockResolvedValueOnce({ data: { itemRefs: [{ id: '3' }], continuation: null } } as never);

    await expect(itemIdsNewerThan('feed/21', 1)).resolves.toEqual(['1', '2', '3']);
    expect((get.mock.calls[1][1] as { params: Record<string, unknown> }).params.c).toBe('C1');
  });

  it("n'envoie pas de continuation au premier appel, et demande bien du JSON", async () => {
    get.mockResolvedValue({ data: { itemRefs: [], continuation: null } } as never);

    await itemIdsNewerThan('feed/21', 1);

    const [, config] = get.mock.calls[0] as [string, { params: Record<string, unknown> }];
    expect(config.params).not.toHaveProperty('c');
    expect(config.params.output).toBe('json');
  });

  it("s'arrête quand la continuation ne progresse plus — sinon la boucle serait sans fin", async () => {
    get.mockResolvedValue({ data: { itemRefs: [{ id: '1' }], continuation: 'MÊME' } } as never);

    await expect(itemIdsNewerThan('feed/21', 1)).resolves.toEqual(['1', '1']);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('rend une liste vide plutôt que des trous quand la réponse est muette', async () => {
    get.mockResolvedValue({ data: {} } as never);
    await expect(itemIdsNewerThan('feed/21', 1)).resolves.toEqual([]);
  });
});
