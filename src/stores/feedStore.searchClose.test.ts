// @vitest-environment jsdom
//
// Revue finale (C1/C2) : un changement de vue pendant un balayage laissait
// `searchScan.running` bloqué à vrai pour toujours (squelette sans fin,
// `listBodyState`) et la barre d'état flottait au-dessus d'un autre flux. Et
// `loadMore`, se fiant à `searchQuery` seul, remplaçait la liste de la
// nouvelle vue par les résultats de l'ancienne recherche. Les quatre actions
// de changement de vue (et `markAllAsRead`, via `dropSearchCorpus`) doivent
// donc refermer la recherche du même geste : `scanToken` périmé,
// `searchQuery`/`searchResults`/`searchScan` à leur état neutre.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/feeds', async () => {
  const actual = await vi.importActual<typeof import('../api/feeds')>('../api/feeds');
  return {
    ...actual,
    fetchStreamPage: vi.fn(),
    getStreamContents: vi.fn(),
    markAllAsRead: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock('../lib/offlineStore', () => ({
  listGet: vi.fn(() => Promise.resolve(undefined)),
  listPut: vi.fn(() => Promise.resolve()),
  listEvictOlderThan: vi.fn(() => Promise.resolve()),
  subsGet: vi.fn(() => Promise.resolve(undefined)),
  subsPut: vi.fn(() => Promise.resolve()),
  queueGet: vi.fn(() => Promise.resolve([])),
  queuePut: vi.fn(() => Promise.resolve()),
}));

import { fetchStreamPage, getStreamContents } from '../api/feeds';
import { useFeedStore, __resetSearchStateForTests } from './feedStore';
import { useAuthStore } from './authStore';

const page = vi.mocked(fetchStreamPage);
const streamContents = vi.mocked(getStreamContents);

const item = (id: string, title: string) => ({
  id, title, origin: { streamId: 'feed/1', title: 'Flux' }, published: 0, categories: [], summary: { content: '' },
});

beforeEach(() => {
  vi.clearAllMocks();
  __resetSearchStateForTests();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  useAuthStore.setState({ activeServerId: 7 } as never);
  streamContents.mockResolvedValue({ items: [], continuation: null } as never);
  useFeedStore.setState({
    subscriptions: [],
    selectedFeed: { id: 'feed/1', title: 'Flux' },
    filter: 'all',
    articles: [],
    searchQuery: '',
    searchResults: [],
  } as never);
});

describe('changer de vue referme la recherche', () => {
  it('C1 — selectFeed pendant un balayage referme la barre d’état au lieu de la laisser tourner sans fin', async () => {
    // La page ne se règle jamais dans ce test : le balayage reste « en vol ».
    page.mockImplementationOnce(() => new Promise(() => {}));
    void useFeedStore.getState().search('moteur');
    await vi.waitFor(() => expect(useFeedStore.getState().searchScan.running).toBe(true));

    useFeedStore.getState().selectFeed({ id: 'feed/2', title: 'Autre' });

    const s = useFeedStore.getState();
    expect(s.searchQuery).toBe('');
    expect(s.searchScan.running).toBe(false);
    expect(s.searchResults).toEqual([]);
  });

  it('C1 — setFilter pendant un balayage referme la recherche', async () => {
    page.mockImplementationOnce(() => new Promise(() => {}));
    void useFeedStore.getState().search('moteur');
    await vi.waitFor(() => expect(useFeedStore.getState().searchScan.running).toBe(true));

    useFeedStore.getState().setFilter('unread');

    expect(useFeedStore.getState().searchQuery).toBe('');
    expect(useFeedStore.getState().searchScan.running).toBe(false);
  });

  it('C1 — selectCategory pendant un balayage referme la recherche (via selectView)', async () => {
    page.mockImplementationOnce(() => new Promise(() => {}));
    void useFeedStore.getState().search('moteur');
    await vi.waitFor(() => expect(useFeedStore.getState().searchScan.running).toBe(true));

    useFeedStore.getState().selectCategory({ id: 'user/-/label/News', label: 'News' });

    expect(useFeedStore.getState().searchQuery).toBe('');
    expect(useFeedStore.getState().searchScan.running).toBe(false);
  });

  it('C1 — « tout marquer comme lu » pendant un balayage referme aussi la recherche', async () => {
    page.mockImplementationOnce(() => new Promise(() => {}));
    void useFeedStore.getState().search('moteur');
    await vi.waitFor(() => expect(useFeedStore.getState().searchScan.running).toBe(true));

    await useFeedStore.getState().markAllAsRead();

    const s = useFeedStore.getState();
    expect(s.searchQuery).toBe('');
    expect(s.searchScan.running).toBe(false);
  });

  it('C2 — loadMore après un changement de vue ne réinjecte pas les résultats de l’ancienne recherche', async () => {
    const many = Array.from({ length: 120 }, (_, i) => item(`a${i}`, 'alpha moteur'));
    page.mockResolvedValueOnce({ items: many, continuation: null });
    await useFeedStore.getState().search('moteur');
    expect(useFeedStore.getState().articles).toHaveLength(50);

    // L'utilisateur change de flux : la nouvelle vue est vide pour l'instant.
    useFeedStore.getState().selectFeed({ id: 'feed/2', title: 'Autre' });
    useFeedStore.setState({ articles: [], continuation: 'C-flux-2', loadingMore: false, revalidating: false } as never);
    streamContents.mockResolvedValueOnce({ items: [item('z', 'zêta')], continuation: null } as never);

    await useFeedStore.getState().loadMore();

    const ids = useFeedStore.getState().articles.map((a: { id: string }) => a.id);
    expect(ids).not.toContain('a0'); // rien de l'ancienne recherche
    expect(useFeedStore.getState().searchQuery).toBe('');
  });

  it('inoffensif au démarrage / à la restauration de la dernière vue : aucune recherche en cours', () => {
    expect(() => useFeedStore.getState().selectView({ id: 'feed/3', title: 'X' })).not.toThrow();
    expect(useFeedStore.getState().searchQuery).toBe('');
  });
});
