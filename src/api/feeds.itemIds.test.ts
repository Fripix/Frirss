import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import client from './client';
import { itemIdsNewerThanEntry } from './feeds';

const get = vi.mocked(client.get);

const ID = (hex: string) => `tag:google.com,2005:reader/item/${hex}`;

beforeEach(() => { vi.clearAllMocks(); });

describe('itemIdsNewerThanEntry', () => {
  it('demande le flux, exclut les articles déjà lus, et ne pose aucune borne de date', async () => {
    get.mockResolvedValue({ data: { itemRefs: [], continuation: null } } as never);

    await itemIdsNewerThanEntry('feed/21', ID('00065a872a755226'));

    const [url, config] = get.mock.calls[0] as [string, { params: Record<string, unknown> }];
    expect(url).toContain('/stream/items/ids');
    expect(config.params.s).toBe('feed/21');
    expect(config.params.xt).toBe('user/-/state/com.google/read');
    expect(config.params).not.toHaveProperty('ot');
  });

  it('s’arrête à l’article cliqué et ne rend que ce qui est au-dessus', async () => {
    get.mockResolvedValue({
      data: {
        itemRefs: [{ id: '1788386439680600' }, { id: '1788386439680560' }, { id: '1788386439680550' }, { id: '1788386439680500' }],
        continuation: 'C1',
      },
    } as never);

    const ids = await itemIdsNewerThanEntry('feed/21', ID('00065a872a755226'));

    expect(ids).toEqual(['1788386439680600', '1788386439680560']);
    expect(get).toHaveBeenCalledTimes(1); // inutile de demander la suite : elle est plus ancienne
  });

  it('suit la continuation tant que la page entière est plus récente', async () => {
    get
      .mockResolvedValueOnce({ data: { itemRefs: [{ id: '1788386439680600' }], continuation: 'C1' } } as never)
      .mockResolvedValueOnce({ data: { itemRefs: [{ id: '1788386439680550' }], continuation: null } } as never);

    const ids = await itemIdsNewerThanEntry('feed/21', ID('00065a872a755226'));

    expect(ids).toEqual(['1788386439680600']);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('rend une liste vide quand l’identifiant de l’article est illisible', async () => {
    await expect(itemIdsNewerThanEntry('feed/21', 'inconnu')).resolves.toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it('rend une liste vide plutôt que des trous quand la réponse est muette', async () => {
    get.mockResolvedValue({ data: {} } as never);
    await expect(itemIdsNewerThanEntry('feed/21', ID('00065a872a755226'))).resolves.toEqual([]);
  });

  it("s'arrête quand la continuation ne progresse plus — sinon la boucle serait sans fin", async () => {
    get.mockResolvedValue({ data: { itemRefs: [{ id: '1788386439680600' }], continuation: 'MÊME' } } as never);

    const ids = await itemIdsNewerThanEntry('feed/21', ID('00065a872a755226'));

    expect(ids).toEqual(['1788386439680600', '1788386439680600']);
    expect(get).toHaveBeenCalledTimes(2);
  });
});
