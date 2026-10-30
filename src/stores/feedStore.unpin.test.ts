// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/offlineStore', () => ({
  listsPatch: vi.fn(async () => {}),
  listGet: vi.fn(async () => undefined), listPut: vi.fn(async () => {}), listEvictOlderThan: vi.fn(async () => {}),
  subsGet: vi.fn(async () => undefined), subsPut: vi.fn(async () => {}),
  queueGet: vi.fn(async () => []), queuePut: vi.fn(async () => {}), clearOfflineViews: vi.fn(async () => {}),
}));
vi.mock('../lib/extractCache', () => ({
  peekExtract: vi.fn(() => ({ content: 'x' })), getExtract: vi.fn(async () => undefined), putExtract: vi.fn(async () => {}),
  pinExtract: vi.fn(async () => {}), unpinExtractsExcept: vi.fn(async () => {}),
}));
vi.mock('../api/feeds', async () => {
  const actual = await vi.importActual<typeof import('../api/feeds')>('../api/feeds');
  return { ...actual, getStarredItems: vi.fn(), getStreamContents: vi.fn() };
});
vi.mock('../i18n', () => ({ default: { t: (k: string) => k } }));

import { getStarredItems, getStreamContents } from '../api/feeds';
import { pinExtract, unpinExtractsExcept } from '../lib/extractCache';
import { listPut } from '../lib/offlineStore';
import { useFeedStore } from './feedStore';
import { useAuthStore } from './authStore';

/*
 * Un extrait est épinglé (jamais évincé) tant que l'article est en favori ou
 * à lire plus tard. Rien ne retirait l'épingle : un article sorti des favoris
 * gardait son extrait pour toujours.
 */
const item = (id: string) => ({ id, title: id, alternate: [{ href: `https://example.com/${id}` }], origin: { streamId: 'feed/1' } });

describe('warmOfflineCache — épingles des extraits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 } as never, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true });
  });

  it('désépingle ce qui n’est plus ni favori ni à lire plus tard — pour sa portée seulement', async () => {
    vi.mocked(getStarredItems).mockResolvedValue({ items: [item('s1')], continuation: null } as never);
    vi.mocked(getStreamContents).mockResolvedValue({ items: [item('r1')], continuation: null } as never);
    await useFeedStore.getState().warmOfflineCache();
    // Le magasin d'extraits est commun : sans portée, le réchauffage d'un
    // serveur désépinglait les favoris de tous les autres.
    expect(unpinExtractsExcept).toHaveBeenCalledWith(new Set(['s1', 'r1']), '7@1');
    expect(pinExtract).toHaveBeenCalledWith('s1', '7@1');
  });

  it('bascule de serveur pendant la lecture des favoris : rien n’est écrit sous la nouvelle portée (B7)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    vi.mocked(getStarredItems).mockImplementation(async () => { await gate; return { items: [item('s1')], continuation: null } as never; });
    vi.mocked(getStreamContents).mockResolvedValue({ items: [], continuation: null } as never);
    const p = useFeedStore.getState().warmOfflineCache();
    await new Promise((r) => setTimeout(r, 0));
    useAuthStore.getState().setFreshrssAuth('2', 'https://b.example');
    release();
    await p;
    expect(listPut).not.toHaveBeenCalled();
    expect(unpinExtractsExcept).not.toHaveBeenCalled();
    expect(pinExtract).not.toHaveBeenCalled();
  });

  it('ne désépingle rien quand une liste est tronquée ou n’a pas pu être lue', async () => {
    vi.mocked(getStarredItems).mockResolvedValue({ items: [item('s1')], continuation: 'suite' } as never);
    vi.mocked(getStreamContents).mockResolvedValue({ items: [item('r1')], continuation: null } as never);
    await useFeedStore.getState().warmOfflineCache();
    vi.mocked(getStarredItems).mockRejectedValue(new Error('réseau'));
    await useFeedStore.getState().warmOfflineCache();
    expect(unpinExtractsExcept).not.toHaveBeenCalled();
  });
});
