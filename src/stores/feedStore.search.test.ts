// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/feeds', async () => {
  const actual = await vi.importActual<typeof import('../api/feeds')>('../api/feeds');
  return { ...actual, fetchStreamPage: vi.fn() };
});

import { fetchStreamPage } from '../api/feeds';
import { useFeedStore, __resetSearchStateForTests } from './feedStore';
import { useAuthStore } from './authStore';

const page = vi.mocked(fetchStreamPage);

const item = (id: string, title: string) => ({
  id,
  title,
  origin: { streamId: 'feed/1', title: 'Flux' },
  published: 0,
  categories: [],
  summary: { content: '' },
});

beforeEach(() => {
  vi.clearAllMocks();
  __resetSearchStateForTests();
  useAuthStore.setState({ activeServerId: 7 } as never);
  useFeedStore.setState({
    selectedFeed: { id: 'feed/1', title: 'Flux' },
    filter: 'unread',
    articles: [],
    searchQuery: '',
    searchResults: [],
  } as never);
});

describe('search — balayage', () => {
  it('suit la continuation jusqu’au bout et ne garde que les correspondances', async () => {
    page
      .mockResolvedValueOnce({ items: [item('a', 'alpha moteur'), item('b', 'beta')], continuation: 'C1' })
      .mockResolvedValueOnce({ items: [item('c', 'gamma moteur')], continuation: null });

    await useFeedStore.getState().search('moteur');

    expect(page).toHaveBeenCalledTimes(2);
    expect(page.mock.calls[1][2]).toBe('C1');
    const s = useFeedStore.getState();
    expect(s.searchResults.map((a) => a.id)).toEqual(['a', 'c']);
    expect(s.articles.map((a) => a.id)).toEqual(['a', 'c']);
    expect(s.searchScan).toMatchObject({ running: false, done: true, scanned: 3, error: null });
  });

  it('réutilise le corpus : une seconde requête dans le même périmètre ne touche pas au réseau', async () => {
    page.mockResolvedValueOnce({ items: [item('a', 'alpha moteur'), item('b', 'beta diesel')], continuation: null });
    await useFeedStore.getState().search('moteur');
    page.mockClear();

    await useFeedStore.getState().search('diesel');

    expect(page).not.toHaveBeenCalled();
    expect(useFeedStore.getState().searchResults.map((a) => a.id)).toEqual(['b']);
  });

  it('rebalaye quand le périmètre change', async () => {
    page.mockResolvedValue({ items: [item('a', 'alpha moteur')], continuation: null });
    await useFeedStore.getState().search('moteur');
    page.mockClear();

    useFeedStore.setState({ selectedFeed: { id: 'feed/2', title: 'Autre' } } as never);
    await useFeedStore.getState().search('moteur');

    expect(page).toHaveBeenCalledTimes(1);
  });

  it('garde ce qui est trouvé et nomme la panne quand une page échoue', async () => {
    page
      .mockResolvedValueOnce({ items: [item('a', 'alpha moteur')], continuation: 'C1' })
      .mockRejectedValueOnce({ response: { status: 429 } });

    await useFeedStore.getState().search('moteur');

    const s = useFeedStore.getState();
    expect(s.searchResults.map((a) => a.id)).toEqual(['a']);
    expect(s.searchScan).toMatchObject({ running: false, done: false, error: 'rate-limit' });
  });

  it('reprend à la continuation en cours, sans refaire la première page', async () => {
    page
      .mockResolvedValueOnce({ items: [item('a', 'alpha moteur')], continuation: 'C1' })
      .mockRejectedValueOnce(new Error('offline'));
    await useFeedStore.getState().search('moteur');
    page.mockClear();
    page.mockResolvedValueOnce({ items: [item('c', 'gamma moteur')], continuation: null });

    await useFeedStore.getState().retrySearch();

    expect(page).toHaveBeenCalledTimes(1);
    expect(page.mock.calls[0][2]).toBe('C1');
    expect(useFeedStore.getState().searchResults.map((a) => a.id)).toEqual(['a', 'c']);
  });

  it('arrête le balayage sans perdre les résultats', async () => {
    page.mockImplementationOnce(async () => {
      useFeedStore.getState().stopSearch();
      return { items: [item('a', 'alpha moteur')], continuation: 'C1' };
    });

    await useFeedStore.getState().search('moteur');

    expect(page).toHaveBeenCalledTimes(1);
    expect(useFeedStore.getState().searchScan).toMatchObject({ running: false, stopped: true, done: false });
  });

  it('déduplique un article livré deux fois', async () => {
    page
      .mockResolvedValueOnce({ items: [item('a', 'alpha moteur')], continuation: 'C1' })
      .mockResolvedValueOnce({ items: [item('a', 'alpha moteur')], continuation: null });

    await useFeedStore.getState().search('moteur');

    expect(useFeedStore.getState().searchResults.map((a) => a.id)).toEqual(['a']);
  });

  it('pagine localement, par tranches, sans réseau', async () => {
    const many = Array.from({ length: 120 }, (_, i) => item(`a${i}`, 'alpha moteur'));
    page.mockResolvedValueOnce({ items: many, continuation: null });
    await useFeedStore.getState().search('moteur');
    expect(useFeedStore.getState().articles).toHaveLength(50);
    page.mockClear();

    useFeedStore.getState().showMoreSearchResults();

    expect(page).not.toHaveBeenCalled();
    expect(useFeedStore.getState().articles).toHaveLength(100);
  });

  it('une requête blanche referme la recherche', async () => {
    const loadArticles = vi.fn().mockResolvedValue(undefined);
    useFeedStore.setState({ searchQuery: 'moteur', loadArticles } as never);

    await useFeedStore.getState().search('   ');

    expect(useFeedStore.getState().searchQuery).toBe('');
    expect(loadArticles).toHaveBeenCalled();
  });
});
