// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/offlineStore', () => ({
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
import { unpinExtractsExcept } from '../lib/extractCache';
import { useFeedStore } from './feedStore';

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
  });

  it('désépingle ce qui n’est plus ni favori ni à lire plus tard', async () => {
    vi.mocked(getStarredItems).mockResolvedValue({ items: [item('s1')], continuation: null } as never);
    vi.mocked(getStreamContents).mockResolvedValue({ items: [item('r1')], continuation: null } as never);
    await useFeedStore.getState().warmOfflineCache();
    expect(unpinExtractsExcept).toHaveBeenCalledWith(new Set(['s1', 'r1']));
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
