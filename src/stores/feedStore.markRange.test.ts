// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/feeds', async () => {
  const actual = await vi.importActual<typeof import('../api/feeds')>('../api/feeds');
  return {
    ...actual,
    markAllAsRead: vi.fn().mockResolvedValue(undefined),
    markAsRead: vi.fn().mockResolvedValue(undefined),
    itemIdsNewerThan: vi.fn().mockResolvedValue([]),
    getUnreadCounts: vi.fn().mockResolvedValue([]),
    fetchStreamPage: vi.fn(),
  };
});

// Stub i18n so toast text is deterministic: t(key) → key. Mirrors feedStore.test.ts.
vi.mock('../i18n', () => ({
  default: { t: (k: string) => k },
}));

import { markAllAsRead, markAsRead, itemIdsNewerThan, getUnreadCounts, fetchStreamPage } from '../api/feeds';
import { useFeedStore, __resetSearchStateForTests } from './feedStore';
import { useAuthStore } from './authStore';
import { useUiStore } from './uiStore';
import type { Article, GReaderItem } from '../types';

const article = (id: string, publishedMs: number): Article => ({
  id, title: id, summary: '', content: '', author: '', url: `https://example.com/${id}`,
  source: 'Flux', sourceId: 'feed/1', published: publishedMs, read: false, starred: false,
  labels: [], tags: [],
});

const vieux = article('vieux', 1_000);
const pivot = article('pivot', 2_000);
const neuf = article('neuf', 3_000);

const page = vi.mocked(fetchStreamPage);

// `published` en secondes, comme le rend l'API greader — `normalizeArticle`
// le multiplie par 1000. `categories` porte le marqueur `.../state/com.google/read`
// pour simuler un article déjà lu côté serveur.
const item = (id: string, title: string, publishedSec: number, categories: string[] = []): GReaderItem => ({
  id,
  title,
  origin: { streamId: 'stream', title: 'Flux' },
  published: publishedSec,
  categories,
  summary: { content: title },
});

beforeEach(() => {
  vi.clearAllMocks();
  __resetSearchStateForTests();
  useUiStore.setState({ toasts: [] });
  useAuthStore.setState({ activeServerId: 7 } as never);
  useFeedStore.setState({
    selectedFeed: { id: 'feed/1', title: 'Flux' },
    filter: 'all',
    articles: [neuf, pivot, vieux],
    searchQuery: '',
    searchResults: [],
  } as never);
});

describe('markReadRelative — en dessous', () => {
  it('marque en un seul appel, borné juste avant l’article cliqué', async () => {
    await useFeedStore.getState().markReadRelative(pivot, 'below');

    expect(markAllAsRead).toHaveBeenCalledTimes(1);
    expect(markAllAsRead).toHaveBeenCalledWith('feed/1', '1999999');
    expect(itemIdsNewerThan).not.toHaveBeenCalled();
  });

  it('met à jour les lignes plus anciennes, et elles seules', async () => {
    await useFeedStore.getState().markReadRelative(pivot, 'below');

    expect(useFeedStore.getState().articles.map((a) => [a.id, a.read])).toEqual([
      ['neuf', false], ['pivot', false], ['vieux', true],
    ]);
  });
});

describe('markReadRelative — au-dessus', () => {
  it('relève les identifiants plus récents puis les marque par lots de 100', async () => {
    vi.mocked(itemIdsNewerThan).mockResolvedValue(Array.from({ length: 150 }, (_, i) => `id${i}`));

    await useFeedStore.getState().markReadRelative(pivot, 'above');

    expect(itemIdsNewerThan).toHaveBeenCalledWith('feed/1', 3);
    expect(markAsRead).toHaveBeenCalledTimes(2);
    expect((vi.mocked(markAsRead).mock.calls[0][0] as string[]).length).toBe(100);
    expect((vi.mocked(markAsRead).mock.calls[1][0] as string[]).length).toBe(50);
    expect(markAllAsRead).not.toHaveBeenCalled();
  });

  it('met à jour les lignes plus récentes, et elles seules', async () => {
    await useFeedStore.getState().markReadRelative(pivot, 'above');

    expect(useFeedStore.getState().articles.map((a) => [a.id, a.read])).toEqual([
      ['neuf', true], ['pivot', false], ['vieux', false],
    ]);
  });

  it('n’appelle rien quand il n’y a rien de plus récent', async () => {
    vi.mocked(itemIdsNewerThan).mockResolvedValue([]);

    await useFeedStore.getState().markReadRelative(neuf, 'above');

    expect(markAsRead).not.toHaveBeenCalled();
  });
});

describe('markReadRelative — la vue et les pannes', () => {
  it('suit la vue courante : sans flux sélectionné, c’est toute la liste de lecture', async () => {
    useFeedStore.setState({ selectedFeed: null } as never);

    await useFeedStore.getState().markReadRelative(pivot, 'below');

    expect(markAllAsRead).toHaveBeenCalledWith('user/-/state/com.google/reading-list', '1999999');
  });

  it('rend les lignes à leur état quand le serveur refuse', async () => {
    vi.mocked(markAllAsRead).mockRejectedValueOnce(new Error('refus'));

    await useFeedStore.getState().markReadRelative(pivot, 'below');

    expect(useFeedStore.getState().articles.map((a) => a.read)).toEqual([false, false, false]);
  });
});

// C1 : un aller-retour réseau peut durer assez longtemps pour que
// l'utilisateur change de vue pendant qu'il est en vol. `avant` appartient
// alors à une liste qui n'est plus affichée : l'y remettre écraserait
// l'en-tête et les lignes du NOUVEAU flux avec celles de l'ancien.
describe('markReadRelative — vue changée pendant l’appel', () => {
  it('ignore un refus une fois la vue changée : ne réécrit pas l’écran d’un autre flux', async () => {
    let rejeter!: (err: unknown) => void;
    vi.mocked(markAllAsRead).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejeter = reject; }));

    const promesse = useFeedStore.getState().markReadRelative(pivot, 'below');

    // L'utilisateur bascule sur un autre flux PENDANT l'aller-retour.
    const autreFlux = article('autre', 5_000);
    useFeedStore.setState({
      selectedFeed: { id: 'feed/2', title: 'Autre' },
      articles: [autreFlux],
    } as never);

    rejeter(new Error('refus'));
    await promesse;

    // L'écran garde ce qui appartient au flux affiché — rien de l'ancienne
    // liste ne revient.
    expect(useFeedStore.getState().articles).toEqual([autreFlux]);
  });
});

// I2 : un lot en échec laisse les lots précédents acceptés côté serveur.
// Le compteur local doit être resynchronisé même après un échec, pas
// seulement après un succès.
describe('markReadRelative — panne partielle par lots', () => {
  it('resynchronise les compteurs et avertit, même si un lot intermédiaire échoue', async () => {
    vi.mocked(itemIdsNewerThan).mockResolvedValue(Array.from({ length: 250 }, (_, i) => `id${i}`));
    vi.mocked(markAsRead)
      .mockResolvedValueOnce(undefined) // premier lot : accepté par le serveur
      .mockRejectedValueOnce(new Error('refus')); // deuxième lot : refusé

    await useFeedStore.getState().markReadRelative(pivot, 'above');

    // Le troisième lot n'est jamais tenté après l'échec du deuxième.
    expect(markAsRead).toHaveBeenCalledTimes(2);
    // Le serveur a le dernier mot sur les compteurs, quoi qu'il soit arrivé
    // aux lots : le relevé tourne malgré l'échec.
    expect(getUnreadCounts).toHaveBeenCalledTimes(1);
    const [toast] = useUiStore.getState().toasts;
    expect(toast).toMatchObject({ message: 'toast.markRangeFailed', tone: 'error' });
  });
});

// I3 / I4 : le corpus de recherche gardé (`searchCorpus`) est repatché par
// simple comparaison de dates. Ces tests installent un vrai corpus via
// `search()`, comme `feedStore.search.test.ts`.
describe('markReadRelative — corpus de recherche', () => {
  const buildCorpus = async () => {
    page.mockResolvedValueOnce({
      items: [
        item('neuf', 'neuf terme', 3),
        item('pivot', 'pivot terme', 2),
        item('vieux', 'vieux terme', 1),
      ],
      continuation: null,
    });
    await useFeedStore.getState().search('terme');
    return useFeedStore.getState().searchResults.find((a) => a.id === 'pivot')!;
  };

  it('répercute le marquage sur le corpus tenu : une recherche ultérieure le ressort lu', async () => {
    const pivotHit = await buildCorpus();

    await useFeedStore.getState().markReadRelative(pivotHit, 'below');

    page.mockClear();
    await useFeedStore.getState().search('terme'); // même périmètre : réutilise le corpus
    expect(page).not.toHaveBeenCalled();
    const vieuxHit = useFeedStore.getState().searchResults.find((a) => a.id === 'vieux')!;
    expect(vieuxHit.read).toBe(true);
  });

  it('défait le corpus quand le serveur refuse', async () => {
    const pivotHit = await buildCorpus();
    vi.mocked(markAllAsRead).mockRejectedValueOnce(new Error('refus'));

    await useFeedStore.getState().markReadRelative(pivotHit, 'below');

    page.mockClear();
    await useFeedStore.getState().search('terme');
    expect(page).not.toHaveBeenCalled();
    const vieuxHit = useFeedStore.getState().searchResults.find((a) => a.id === 'vieux')!;
    expect(vieuxHit.read).toBe(false);
  });

  // I3 : une recherche neuve, dans un AUTRE périmètre, démarre pendant que
  // l'appel est en vol. Elle remplace `searchCorpus` par un objet différent
  // AVANT que le refus n'arrive — le rollback ne doit pas y toucher, sinon
  // c'est le corpus de ce périmètre-là qui se ferait patcher par une
  // simple comparaison de dates, sans rapport avec ce qu'il contient.
  it('ignore un corpus qui n’est plus le même : une recherche neuve entre-temps garde ses résultats intacts', async () => {
    const pivotHit = await buildCorpus();

    let rejeter!: (err: unknown) => void;
    vi.mocked(markAllAsRead).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejeter = reject; }));
    const promesse = useFeedStore.getState().markReadRelative(pivotHit, 'below');

    // Nouveau périmètre : un autre flux, avec un article déjà lu côté
    // serveur et plus ancien que `pivot` — exactement ce que le rollback
    // du premier corpus, mal gardé, patcherait à tort en non-lu.
    useFeedStore.setState({ selectedFeed: { id: 'feed/2', title: 'Autre' } } as never);
    page.mockResolvedValueOnce({
      items: [item('impostor', 'impostor terme', 1, ['user/-/state/com.google/read'])],
      continuation: null,
    });
    await useFeedStore.getState().search('terme');

    rejeter(new Error('refus'));
    await promesse;

    page.mockClear();
    await useFeedStore.getState().search('terme'); // même périmètre (feed/2) : pas de réseau si le corpus est intact
    expect(page).not.toHaveBeenCalled();
    const impostorHit = useFeedStore.getState().searchResults.find((a) => a.id === 'impostor')!;
    expect(impostorHit.read).toBe(true);
  });
});
