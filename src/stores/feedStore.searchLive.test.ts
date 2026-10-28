// @vitest-environment jsdom
//
// La recherche reste vivante : ce qu'on fait sur ses résultats (lu,
// étiquette) y reste, « Tout lu » rend la vue nue, Rafraîchir y ajoute les
// nouveaux articles qui correspondent, et la fin de la session FriRSS libère
// le corpus gardé en mémoire.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/feeds', async () => {
  const actual = await vi.importActual<typeof import('../api/feeds')>('../api/feeds');
  return {
    ...actual,
    fetchStreamPage: vi.fn(),
    getStreamContents: vi.fn(),
    getStarredItems: vi.fn().mockResolvedValue({ items: [], continuation: null }),
    getUnreadCounts: vi.fn().mockResolvedValue([]),
    getUnreadItemIds: vi.fn().mockResolvedValue({ ids: [], complete: true }),
    getTagList: vi.fn().mockResolvedValue([]),
    markAsRead: vi.fn().mockResolvedValue(undefined),
    markAllAsRead: vi.fn().mockResolvedValue(undefined),
    setArticleLabel: vi.fn().mockResolvedValue(undefined),
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
vi.mock('../i18n', () => ({ default: { t: (k: string) => k } }));

import { fetchStreamPage, getStreamContents } from '../api/feeds';
import { useFeedStore, __resetSearchStateForTests } from './feedStore';
import { useAuthStore } from './authStore';

const page = vi.mocked(fetchStreamPage);
const streamContents = vi.mocked(getStreamContents);

const item = (id: string, title: string) => ({
  id, title, origin: { streamId: 'feed/1', title: 'Flux' }, published: 0, categories: [], summary: { content: '' },
});
const ids = (list: { id: string }[]) => list.map((a) => a.id);
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks` laisse les réponses « Once » non consommées : un test qui
  // échoue avant son appel les léguerait au suivant.
  page.mockReset();
  __resetSearchStateForTests();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  useAuthStore.setState({ activeServerId: 7, backendToken: 'jwt' } as never);
  streamContents.mockResolvedValue({ items: [], continuation: null } as never);
  useFeedStore.setState({
    subscriptions: [],
    selectedFeed: { id: 'feed/1', title: 'Flux' },
    filter: 'all',
    articles: [],
    continuation: null,
    selectedArticle: null,
    loading: false,
    revalidating: false,
    searchQuery: '',
    searchResults: [],
    hasRefreshToken: false,
    refreshPhase: 'idle',
  } as never);
});

describe('la recherche reste vivante', () => {
  it('a check in search results survives the next slice', async () => {
    const hits = Array.from({ length: 60 }, (_, i) => item(`m${i}`, `moteur ${i}`));
    page.mockResolvedValueOnce({ items: hits, continuation: null });
    await useFeedStore.getState().search('moteur');
    expect(useFeedStore.getState().articles).toHaveLength(50);

    await useFeedStore.getState().toggleRead(useFeedStore.getState().articles[0]);
    useFeedStore.getState().showMoreSearchResults();

    const s = useFeedStore.getState();
    expect(s.articles).toHaveLength(60);
    expect(s.articles[0].read).toBe(true);
    expect(s.searchResults[0].read).toBe(true);
  });

  it('a label toggled during a search is in the corpus', async () => {
    page.mockResolvedValueOnce({ items: [item('a', 'alpha moteur')], continuation: null });
    await useFeedStore.getState().search('moteur');

    await useFeedStore.getState().toggleArticleLabel(useFeedStore.getState().articles[0], 'user/-/label/Projet');
    // Même périmètre, corpus frais : la recherche suivante répond depuis la
    // mémoire — c'est là que l'étiquette perdue revenait.
    await useFeedStore.getState().search('alpha');

    expect(page).toHaveBeenCalledTimes(1);
    expect(useFeedStore.getState().searchResults[0].labels).toContain('user/-/label/Projet');
  });

  it('mark all read during a search reloads the bare view', async () => {
    page.mockResolvedValueOnce({ items: [item('a', 'alpha moteur')], continuation: null });
    await useFeedStore.getState().search('moteur');
    streamContents.mockResolvedValue({ items: [item('nu1', 'vue nue'), item('nu2', 'vue nue')], continuation: 'K2' } as never);

    await useFeedStore.getState().markAllAsRead();
    await vi.waitFor(() => expect(ids(useFeedStore.getState().articles)).toEqual(['nu1', 'nu2']));

    const s = useFeedStore.getState();
    expect(s.searchQuery).toBe('');
    expect(s.continuation).toBe('K2');
  });

  it('refresh during a search adds newer matching articles and stops spinning', async () => {
    page.mockResolvedValueOnce({ items: [item('a', 'alpha moteur'), item('b', 'beta')], continuation: null });
    await useFeedStore.getState().search('moteur');
    useFeedStore.setState({ loadSubscriptions: vi.fn(() => Promise.resolve()) as never });
    page.mockClear();
    // Le haut du flux : deux nouveaux, puis des articles déjà balayés.
    page.mockResolvedValueOnce({
      items: [item('n1', 'neuf moteur'), item('n2', 'neuf sans rapport'), item('a', 'alpha moteur'), item('b', 'beta')],
      continuation: 'C-suite',
    });

    await useFeedStore.getState().refresh();

    // Une seule page, depuis le haut — pas de rebalayage complet.
    expect(page).toHaveBeenCalledTimes(1);
    expect(page.mock.calls[0][2]).toBeNull();
    const s = useFeedStore.getState();
    expect(ids(s.searchResults)).toEqual(['n1', 'a']);
    expect(ids(s.articles)).toEqual(['n1', 'a']);
    // Le corpus n'a reçu que les deux nouveaux.
    expect(s.searchScan.scanned).toBe(4);
    expect(s.loading).toBe(false);
    expect(s.revalidating).toBe(false);
    expect(s.searchQuery).toBe('moteur');
  });

  it('un chargement de vue doublé par une recherche relève ses drapeaux', async () => {
    let resolveFeed!: (v: unknown) => void;
    streamContents.mockImplementation(() => new Promise((r) => { resolveFeed = r; }) as never);
    page.mockResolvedValueOnce({ items: [item('hit', 'alpha moteur')], continuation: null });

    const loading = useFeedStore.getState().loadArticles();
    await useFeedStore.getState().search('moteur');
    resolveFeed({ items: [item('nu', 'sans rapport')], continuation: null });
    await loading;

    const s = useFeedStore.getState();
    expect(ids(s.articles)).toEqual(['hit']);
    expect(s.loading).toBe(false);
    expect(s.revalidating).toBe(false);
  });

  it('tirer pour rafraîchir pendant une recherche ajoute aussi les nouveaux', async () => {
    page.mockResolvedValueOnce({ items: [item('a', 'alpha moteur')], continuation: null });
    await useFeedStore.getState().search('moteur');
    page.mockResolvedValueOnce({ items: [item('n1', 'neuf moteur'), item('a', 'alpha moteur')], continuation: null });

    await useFeedStore.getState().silentRefresh();

    expect(ids(useFeedStore.getState().articles)).toEqual(['n1', 'a']);
  });

  it('logout drops the corpus', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null))));
    try {
      page.mockResolvedValue({ items: [item('a', 'alpha moteur')], continuation: null });
      await useFeedStore.getState().search('moteur');
      page.mockClear();

      useAuthStore.getState().logout();
      await flush();
      // Un autre compte se connecte dans le même navigateur, sur un serveur
      // qui porte le même identifiant.
      useAuthStore.setState({ activeServerId: 7, backendToken: 'autre' } as never);
      await useFeedStore.getState().search('moteur');

      expect(page).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
