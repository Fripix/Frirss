import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import client from './client';
import { fetchStreamPage } from './feeds';

const get = vi.mocked(client.get);

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: { items: [{ id: 'a' }], continuation: 'CONT1' } } as never);
});

describe('fetchStreamPage', () => {
  it('demande la taille de page et le périmètre voulus', async () => {
    await fetchStreamPage('feed/21', 1000, null);
    const [url, config] = get.mock.calls[0] as [string, { params: Record<string, unknown> }];
    expect(url).toContain('/stream/contents/');
    expect(config.params.n).toBe(1000);
    expect(config.params.output).toBe('json');
  });

  it("n'envoie PAS de q : l'API greader n'en a pas, c'est ce paramètre qui a fait croire à une recherche", async () => {
    await fetchStreamPage('feed/21', 1000, null);
    const [, config] = get.mock.calls[0] as [string, { params: Record<string, unknown> }];
    expect(config.params).not.toHaveProperty('q');
  });

  it('transmet la continuation quand il y en a une, et rien sinon', async () => {
    await fetchStreamPage('feed/21', 1000, 'CONT1');
    const [, withCont] = get.mock.calls[0] as [string, { params: Record<string, unknown> }];
    expect(withCont.params.c).toBe('CONT1');

    get.mockClear();
    await fetchStreamPage('feed/21', 1000, null);
    const [, without] = get.mock.calls[0] as [string, { params: Record<string, unknown> }];
    expect(without.params).not.toHaveProperty('c');
  });

  it('rend une page vide plutôt que des trous quand la réponse est muette', async () => {
    get.mockResolvedValue({ data: {} } as never);
    await expect(fetchStreamPage('feed/21', 1000, null)).resolves.toEqual({ items: [], continuation: null });
  });
});
