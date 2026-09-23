// @vitest-environment jsdom
//
// I1 (revue finale) : le fichier porte deux notions concurrentes de « la même
// vue ». `runScan`/`loadMore` se gardent sur `viewIdentity` (flux + filtre +
// requête) ; `loadArticles` et `silentRefresh` se gardaient sur `viewKey`
// (flux + filtre seulement), qui ignore `searchQuery`. Un retour d'onglet
// (`silentRefresh`) ou un chargement de vue (`loadArticles`) écrivait donc
// par-dessus les résultats d'une recherche terminée ou en train de démarrer.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/feeds', async () => {
  const actual = await vi.importActual<typeof import('../api/feeds')>('../api/feeds');
  return {
    ...actual,
    fetchStreamPage: vi.fn(),
    getStreamContents: vi.fn(),
    getUnreadCounts: vi.fn().mockResolvedValue([]),
    getStarredItems: vi.fn().mockResolvedValue({ items: [], continuation: null }),
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
import type { GReaderStream } from '../types';

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
  useFeedStore.setState({
    subscriptions: [],
    selectedFeed: { id: 'feed/1', title: 'Flux' },
    filter: 'all',
    articles: [],
    searchQuery: '',
    searchResults: [],
  } as never);
});

describe('une recherche en cours n’est pas écrasée par un rechargement de vue', () => {
  it('silentRefresh renonce quand une recherche est active', async () => {
    page.mockResolvedValueOnce({ items: [item('a', 'alpha moteur')], continuation: null });
    await useFeedStore.getState().search('moteur');
    expect(useFeedStore.getState().articles.map((a: { id: string }) => a.id)).toEqual(['a']);

    // Le flux nu, lui, ne contient pas « a ».
    streamContents.mockResolvedValue({ items: [item('nu', 'sans rapport')], continuation: null } as never);

    await useFeedStore.getState().silentRefresh();

    const s = useFeedStore.getState();
    expect(s.searchQuery).toBe('moteur');
    expect(s.articles.map((a: { id: string }) => a.id)).toEqual(['a']);
  });

  it('loadArticles renonce si une recherche a démarré pendant son propre aller-retour réseau', async () => {
    // Le flux nu répond, mais seulement après qu'on ait laissé le temps à une
    // recherche de démarrer — exactement la course du bouton « chercher dans
    // tous les flux » de l'état vide (`ArticleList.tsx`), qui enchaîne
    // `selectView(null, 'all')` (→ `loadArticles`, non attendu) et
    // `search(query)` sans attendre le premier.
    let resolveFeed!: (v: GReaderStream) => void;
    streamContents.mockImplementation(() => new Promise<GReaderStream>((r) => { resolveFeed = r; }));
    page.mockResolvedValueOnce({ items: [item('hit', 'alpha moteur')], continuation: null });

    // `loadArticles` part, mais sa requête reste en vol (le flux nu ne
    // répond pas encore).
    const loadPromise = useFeedStore.getState().loadArticles();
    // Une recherche démarre — et se termine entièrement — pendant ce vol.
    await useFeedStore.getState().search('moteur');
    expect(useFeedStore.getState().articles.map((a: { id: string }) => a.id)).toEqual(['hit']);

    // Le flux nu répond enfin : `loadArticles` ne doit plus rien écrire, la
    // recherche a pris possession de la vue entre-temps.
    resolveFeed({ items: [item('nu', 'sans rapport')], continuation: null });
    await loadPromise;

    const s = useFeedStore.getState();
    expect(s.searchQuery).toBe('moteur');
    expect(s.articles.map((a: { id: string }) => a.id)).toEqual(['hit']);
  });
});
