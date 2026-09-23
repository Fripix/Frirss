// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/feeds', async () => {
  const actual = await vi.importActual<typeof import('../api/feeds')>('../api/feeds');
  return { ...actual, fetchStreamPage: vi.fn() };
});

import { fetchStreamPage } from '../api/feeds';
import { useFeedStore, __resetSearchStateForTests, dropSearchCorpus } from './feedStore';
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

  // C1 — un changement de vue pendant l'attente réseau ne doit rien laisser
  // écrire : la page arrivée après coup appartient à l'ancien flux.
  it('annule le balayage si la vue change pendant l’attente réseau', async () => {
    page.mockImplementationOnce(async () => {
      // La réponse arrive après que l'utilisateur a quitté le flux balayé.
      useFeedStore.setState({ selectedFeed: { id: 'feed/9', title: 'Autre' }, articles: ['SENTINELLE'] } as never);
      return { items: [item('a', 'alpha moteur')], continuation: null };
    });

    await useFeedStore.getState().search('moteur');

    // La nouvelle vue garde ce qu'elle avait ; la page en retard n'y a rien ajouté.
    expect(useFeedStore.getState().articles).toEqual(['SENTINELLE']);
  });

  // C2 — retrySearch doit vérifier que le corpus gardé appartient toujours au
  // périmètre courant avant de reprendre sa continuation.
  it('retrySearch repart d’une recherche neuve si le périmètre a changé entre-temps', async () => {
    page
      .mockResolvedValueOnce({ items: [item('a', 'alpha moteur')], continuation: 'C1' })
      .mockRejectedValueOnce(new Error('offline'));
    await useFeedStore.getState().search('moteur');
    page.mockClear();

    // L'utilisateur change de flux avant de cliquer « réessayer ».
    useFeedStore.setState({ selectedFeed: { id: 'feed/2', title: 'Autre' } } as never);
    page.mockResolvedValueOnce({ items: [item('z', 'zêta moteur')], continuation: null });

    await useFeedStore.getState().retrySearch();

    // Pas de reprise sur la continuation de feed/1 : une recherche neuve, sans continuation.
    expect(page.mock.calls[0][2]).toBeNull();
    expect(useFeedStore.getState().searchResults.map((a) => a.id)).toEqual(['z']);
  });

  // I1 — la pagination locale ne doit jamais faire reculer `searchVisible`.
  it('showMoreSearchResults ne fait jamais reculer searchVisible', async () => {
    page.mockResolvedValueOnce({ items: [item('a', 'alpha moteur')], continuation: null });
    await useFeedStore.getState().search('moteur');
    expect(useFeedStore.getState().searchVisible).toBe(50); // PAGE_SIZE, un seul résultat trouvé

    useFeedStore.getState().showMoreSearchResults();

    expect(useFeedStore.getState().searchVisible).toBeGreaterThanOrEqual(50);
    expect(useFeedStore.getState().articles.map((a) => a.id)).toEqual(['a']);
  });

  // I2 — search() doit remettre `continuation` à null : sinon la pagination
  // locale des résultats hérite de celle, périmée, de la vue nue.
  it('search() remet la continuation de la vue nue à null', async () => {
    useFeedStore.setState({ continuation: 'ancienne-continuation-de-la-vue-nue' } as never);
    page.mockResolvedValueOnce({ items: [item('a', 'alpha moteur')], continuation: null });

    await useFeedStore.getState().search('moteur');

    expect(useFeedStore.getState().continuation).toBeNull();
  });

  // I3 — un balayage interrompu ne doit jamais laisser un corpus réutilisable :
  // la requête suivante, même dans le même périmètre, doit retoucher le réseau.
  it('un balayage arrêté ne laisse pas de corpus réutilisable — la recherche suivante repart au réseau', async () => {
    page.mockImplementationOnce(async () => {
      useFeedStore.getState().stopSearch();
      return { items: [item('a', 'alpha moteur')], continuation: 'C1' };
    });
    await useFeedStore.getState().search('moteur');
    page.mockClear();
    page.mockResolvedValueOnce({ items: [item('a', 'alpha moteur')], continuation: null });

    await useFeedStore.getState().search('moteur');

    expect(page).toHaveBeenCalled();
  });

  // I5 — dropSearchCorpus (appelé par resetAndReload au changement de serveur)
  // doit empêcher une page en retard d'écrire dans le nouveau contexte, et
  // laisser la recherche suivante repartir au réseau.
  it('un changement de serveur en plein balayage annule la page en retard', async () => {
    page.mockImplementationOnce(async () => {
      dropSearchCorpus();
      return { items: [item('a', 'alpha moteur')], continuation: 'C1' };
    });

    await useFeedStore.getState().search('moteur');

    // La page en retard n'a rien écrit.
    expect(useFeedStore.getState().searchResults).toEqual([]);
    expect(useFeedStore.getState().articles).toEqual([]);

    page.mockClear();
    page.mockResolvedValueOnce({ items: [item('a', 'alpha moteur')], continuation: null });
    await useFeedStore.getState().search('moteur');

    expect(page).toHaveBeenCalled(); // pas de corpus périmé réutilisé
  });
});
