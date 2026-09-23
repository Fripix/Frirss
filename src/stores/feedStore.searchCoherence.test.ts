// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/feeds', async () => {
  const actual = await vi.importActual<typeof import('../api/feeds')>('../api/feeds');
  return {
    ...actual,
    fetchStreamPage: vi.fn(),
    markAsRead: vi.fn().mockResolvedValue(undefined),
    markAsUnread: vi.fn().mockResolvedValue(undefined),
    markAllAsRead: vi.fn().mockResolvedValue(undefined),
  };
});

import { fetchStreamPage, markAsRead } from '../api/feeds';
import { useFeedStore, __resetSearchStateForTests } from './feedStore';
import { useAuthStore } from './authStore';

const page = vi.mocked(fetchStreamPage);
const item = (id: string, title: string) => ({
  id, title, origin: { streamId: 'feed/1', title: 'Flux' }, published: 0, categories: [], summary: { content: '' },
});

beforeEach(() => {
  vi.clearAllMocks();
  __resetSearchStateForTests();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  useAuthStore.setState({ activeServerId: 7 } as never);
  useFeedStore.setState({ selectedFeed: { id: 'feed/1', title: 'Flux' }, filter: 'all', articles: [], searchResults: [] } as never);
});

describe('corpus et écritures', () => {
  it('un article coché lu pendant une recherche ne redevient pas non lu à la recherche suivante', async () => {
    page.mockResolvedValueOnce({ items: [item('a', 'alpha moteur')], continuation: null });
    await useFeedStore.getState().search('moteur');

    await useFeedStore.getState().toggleRead(useFeedStore.getState().searchResults[0]);
    page.mockClear();

    await useFeedStore.getState().search('moteur');

    expect(page).not.toHaveBeenCalled();
    expect(useFeedStore.getState().searchResults[0].read).toBe(true);
  });

  it('un refus du serveur sur un ✓ pendant une recherche remet le corpus dans son état d’avant (rollback)', async () => {
    page.mockResolvedValueOnce({ items: [item('a', 'alpha moteur')], continuation: null });
    await useFeedStore.getState().search('moteur');

    vi.mocked(markAsRead).mockRejectedValueOnce({ response: { status: 400 } });
    await useFeedStore.getState().toggleRead(useFeedStore.getState().searchResults[0]);
    page.mockClear();
    page.mockResolvedValueOnce({ items: [item('a', 'alpha moteur')], continuation: null });

    await useFeedStore.getState().search('moteur');

    // Le corpus gardé est réutilisé (même périmètre, toujours complet) et
    // doit refléter le rollback : toujours non lu.
    expect(page).not.toHaveBeenCalled();
    expect(useFeedStore.getState().searchResults[0].read).toBe(false);
  });

  it('« tout marquer comme lu » jette le corpus au lieu de le laisser mentir', async () => {
    page.mockResolvedValueOnce({ items: [item('a', 'alpha moteur')], continuation: null });
    await useFeedStore.getState().search('moteur');
    page.mockClear();
    page.mockResolvedValueOnce({ items: [item('a', 'alpha moteur')], continuation: null });

    await useFeedStore.getState().markAllAsRead();
    await useFeedStore.getState().search('moteur');

    expect(page).toHaveBeenCalledTimes(1);
  });
});
