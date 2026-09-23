// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/feeds', async () => {
  const actual = await vi.importActual<typeof import('../api/feeds')>('../api/feeds');
  return { ...actual, fetchStreamPage: vi.fn() };
});
vi.mock('../lib/offlineStore', () => ({
  listGet: vi.fn(),
  listPut: vi.fn(),
  subsGet: vi.fn(),
  subsPut: vi.fn(),
  queueGet: vi.fn(),
  queuePut: vi.fn(),
  listEvictOlderThan: vi.fn(),
}));

import { fetchStreamPage } from '../api/feeds';
import { listGet } from '../lib/offlineStore';
import { useFeedStore, __resetSearchStateForTests } from './feedStore';

const page = vi.mocked(fetchStreamPage);
const cached = vi.mocked(listGet);

const article = (id: string, title: string) => ({
  id,
  title,
  summary: '',
  content: '',
  author: '',
  url: `https://example.com/${id}`,
  source: 'Flux',
  sourceId: 'feed/1',
  published: 0,
  read: false,
  starred: false,
  labels: [],
  tags: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  __resetSearchStateForTests();
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  useFeedStore.setState({
    selectedFeed: { id: 'feed/1', title: 'Flux' },
    filter: 'unread',
    articles: [],
    searchResults: [],
  } as never);
});

describe('search hors ligne', () => {
  it('ne balaye pas, filtre ce qui est disponible, et le dit', async () => {
    cached.mockResolvedValue({
      key: 'k',
      articles: [article('a', 'alpha moteur'), article('b', 'beta')],
      continuation: null,
      cachedAt: 0,
    } as never);

    await useFeedStore.getState().search('moteur');

    expect(page).not.toHaveBeenCalled();
    const s = useFeedStore.getState();
    expect(s.searchResults.map((a) => a.id)).toEqual(['a']);
    expect(s.searchScan).toMatchObject({ running: false, error: 'offline', done: true });
  });

  it('filtre aussi la liste déjà en mémoire quand le cache hors ligne est vide', async () => {
    cached.mockResolvedValue(undefined);
    useFeedStore.setState({ articles: [article('a', 'alpha moteur'), article('b', 'beta')] } as never);

    await useFeedStore.getState().search('moteur');

    const s = useFeedStore.getState();
    expect(s.searchResults.map((a) => a.id)).toEqual(['a']);
    expect(s.searchScan).toMatchObject({ running: false, error: 'offline', done: true, scanned: 2 });
  });

  it('dédoublonne un article présent à la fois en mémoire et dans le cache hors ligne', async () => {
    // Même article des deux côtés (ex. rechargement après un premier passage) :
    // il ne doit compter, et n'apparaître, qu'une seule fois.
    useFeedStore.setState({ articles: [article('a', 'alpha moteur')] } as never);
    cached.mockResolvedValue({
      key: 'k',
      articles: [article('a', 'alpha moteur'), article('b', 'beta moteur')],
      continuation: null,
      cachedAt: 0,
    } as never);

    await useFeedStore.getState().search('moteur');

    const s = useFeedStore.getState();
    expect(s.searchResults.map((a) => a.id)).toEqual(['a', 'b']);
    // `scanned` compte les articles distincts réellement fouillés, pas la
    // somme brute des deux sources (qui vaudrait 3 ici) : le doublon ne doit
    // pas gonfler artificiellement ce qui a été regardé.
    expect(s.searchScan.scanned).toBe(2);
  });
});
