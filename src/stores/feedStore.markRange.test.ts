// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../api/feeds', async () => {
  const actual = await vi.importActual<typeof import('../api/feeds')>('../api/feeds');
  return {
    ...actual,
    markAllAsRead: vi.fn().mockResolvedValue(undefined),
    markAsRead: vi.fn().mockResolvedValue(undefined),
    itemIdsNewerThanEntry: vi.fn().mockResolvedValue([]),
    getUnreadCounts: vi.fn().mockResolvedValue([]),
    fetchStreamPage: vi.fn(),
  };
});

// Stub i18n so toast text is deterministic: t(key) → key. Mirrors feedStore.test.ts.
vi.mock('../i18n', () => ({
  default: { t: (k: string) => k },
}));

import { markAllAsRead, markAsRead, itemIdsNewerThanEntry, getUnreadCounts, fetchStreamPage } from '../api/feeds';
import { useFeedStore, __resetSearchStateForTests, __resetNewArticlesStateForTests } from './feedStore';
import { useAuthStore } from './authStore';
import { useUiStore } from './uiStore';
import type { Article, GReaderItem, Filter } from '../types';

// Identifiants d'entrée réels (décimaux), dans l'ordre d'insertion FreshRSS —
// PAS dans l'ordre de `published`, choisi délibérément à l'envers ci-dessous.
// Toute borne qui se tromperait de champ (`published` au lieu de l'id) se
// verrait immédiatement : elle marquerait la ligne opposée.
const vieuxId = '1788386439680500'; // entrée la plus ANCIENNE, mais published la plus GRANDE
const pivotId = '1788386439680550';
const neufId = '1788386439680600'; // entrée la plus RÉCENTE, mais published la plus PETITE

const article = (id: string, publishedMs: number): Article => ({
  id, title: id, summary: '', content: '', author: '', url: `https://example.com/${id}`,
  source: 'Flux', sourceId: 'feed/1', published: publishedMs, read: false, starred: false,
  labels: [], tags: [],
});

const vieux = article(vieuxId, 9_000_000);
const pivot = article(pivotId, 5_000_000);
const neuf = article(neufId, 1_000_000);

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

const refus = { response: { status: 403 } };

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
  it('borne le serveur sur l’identifiant d’entrée, jamais sur la date de publication', async () => {
    await useFeedStore.getState().markReadRelative(pivot, 'below');

    // `- 1` sur l'identifiant décimal de `pivot`, pas une conversion de
    // `pivot.published` (qui pointerait vers un tout autre nombre).
    expect(markAllAsRead).toHaveBeenCalledTimes(1);
    expect(markAllAsRead).toHaveBeenCalledWith('feed/1', '1788386439680549');
    expect(itemIdsNewerThanEntry).not.toHaveBeenCalled();
  });

  it('met à jour les lignes plus anciennes par l’identifiant d’entrée, et elles seules', async () => {
    await useFeedStore.getState().markReadRelative(pivot, 'below');

    // `vieux` a l'identifiant le plus ANCIEN mais le `published` le plus
    // GRAND : si le code lisait encore la date, il marquerait `neuf`.
    expect(useFeedStore.getState().articles.map((a) => [a.id, a.read])).toEqual([
      [neufId, false], [pivotId, false], [vieuxId, true],
    ]);
  });
});

describe('markReadRelative — au-dessus', () => {
  it('relève les identifiants plus récents puis les marque par lots de 100', async () => {
    vi.mocked(itemIdsNewerThanEntry).mockResolvedValue(Array.from({ length: 150 }, (_, i) => `id${i}`));

    await useFeedStore.getState().markReadRelative(pivot, 'above');

    expect(itemIdsNewerThanEntry).toHaveBeenCalledWith('feed/1', pivotId);
    expect(markAsRead).toHaveBeenCalledTimes(2);
    expect((vi.mocked(markAsRead).mock.calls[0][0] as string[]).length).toBe(100);
    expect((vi.mocked(markAsRead).mock.calls[1][0] as string[]).length).toBe(50);
    expect(markAllAsRead).not.toHaveBeenCalled();
  });

  it('met à jour les lignes plus récentes par l’identifiant d’entrée, et elles seules', async () => {
    await useFeedStore.getState().markReadRelative(pivot, 'above');

    // `neuf` a l'identifiant le plus RÉCENT mais le `published` le plus
    // PETIT : si le code lisait encore la date, rien ne serait marqué ici.
    expect(useFeedStore.getState().articles.map((a) => [a.id, a.read])).toEqual([
      [neufId, true], [pivotId, false], [vieuxId, false],
    ]);
  });

  it('n’appelle rien quand il n’y a rien de plus récent', async () => {
    // `mockResolvedValue` (pas `...Once`) du test précédent survit à
    // `vi.clearAllMocks()`, qui vide les appels mais pas l'implémentation.
    vi.mocked(itemIdsNewerThanEntry).mockResolvedValue([]);

    await useFeedStore.getState().markReadRelative(neuf, 'above');

    expect(markAsRead).not.toHaveBeenCalled();
  });
});

describe('markReadRelative — la vue et les pannes', () => {
  it('suit la vue courante : sans flux sélectionné, c’est toute la liste de lecture', async () => {
    useFeedStore.setState({ selectedFeed: null } as never);

    await useFeedStore.getState().markReadRelative(pivot, 'below');

    expect(markAllAsRead).toHaveBeenCalledWith('user/-/state/com.google/reading-list', '1788386439680549');
  });

  it('rend les lignes à leur état quand le serveur refuse', async () => {
    vi.mocked(markAllAsRead).mockRejectedValueOnce(refus);

    await useFeedStore.getState().markReadRelative(pivot, 'below');

    expect(useFeedStore.getState().articles.map((a) => a.read)).toEqual([false, false, false]);
  });

  it('le relevé de compteurs est bien demandé après coup', async () => {
    await useFeedStore.getState().markReadRelative(pivot, 'below');

    expect(getUnreadCounts).toHaveBeenCalledTimes(1);
  });
});

// I2 (revue finale) : même garde que `toggleRead` (`readWritesInFlight`,
// commentaire en tête de `feedStore.ts`). Sans elle, un relevé de compteurs
// concurrent — un rafraîchissement périodique, par exemple — démarré PENDANT
// que cette écriture est en vol ne le sait pas si l'écart d'epoch seul ne le
// trahit pas (l'écriture reste en vol tout du long : aucun second bump ne
// survient pendant l'attente du relevé), et fabrique une fausse pastille.
describe('markReadRelative — le relevé concurrent respecte l’écriture en vol (I2)', () => {
  beforeEach(() => {
    __resetNewArticlesStateForTests();
    useFeedStore.setState({ unreadCounts: { 'feed/1': 2 }, newInView: 0 });
  });

  it('une écriture encore en vol au démarrage d’un relevé concurrent ne compte pas comme une arrivée', async () => {
    let resolveWrite!: () => void;
    vi.mocked(markAllAsRead).mockReturnValueOnce(new Promise<void>((r) => { resolveWrite = r; }));

    // Ne PAS attendre : l'écriture reste en vol pendant tout le relevé concurrent.
    const writePending = useFeedStore.getState().markReadRelative(pivot, 'below');
    vi.mocked(getUnreadCounts).mockResolvedValueOnce([{ id: 'feed/1', count: 5 }] as never);
    await useFeedStore.getState().syncCounts();
    expect(useFeedStore.getState().newInView).toBe(0);

    // Régler l'écriture après coup ne doit rien changer rétroactivement au
    // relevé déjà terminé — juste laisser l'action se conclure proprement.
    resolveWrite();
    await writePending;
  });
});

// C1 (revue finale) : `markAllAsRead()` (le store) n'a aucune notion de
// filtre — Favoris et À lire plus tard ne sont pas des flux qu'on vide, ce
// sont des sélections transversales. `canMarkAllRead` (`src/lib/markAllRead.ts`)
// le sait déjà pour le bouton « Tout lu » ; cette action doit s'y refuser de
// la même façon plutôt que de marquer la mauvaise chose.
describe('markReadRelative — périmètre refusé (C1)', () => {
  it.each<Filter>(['starred', 'readlater'])('ne fait rien depuis %s', async (filter) => {
    useFeedStore.setState({ filter } as never);

    await useFeedStore.getState().markReadRelative(pivot, 'below');
    await useFeedStore.getState().markReadRelative(pivot, 'above');

    expect(markAllAsRead).not.toHaveBeenCalled();
    expect(itemIdsNewerThanEntry).not.toHaveBeenCalled();
    expect(useFeedStore.getState().articles.map((a) => a.read)).toEqual([false, false, false]);
  });
});

// I2 (revue finale) : `readWritesInFlight` doit couvrir cette écriture comme
// `toggleRead` couvre la sienne — sans lui, un relevé de compteurs lancé
// pendant l'action ne sait pas qu'une écriture est en vol et fabrique une
// fausse pastille « nouveaux articles ». On ne peut observer le compteur
// directement (module-privé) : la preuve est la morsure de l'étape 5.
describe('markReadRelative — vue changée pendant l’appel', () => {
  it('ignore un refus une fois la vue changée : ne réécrit pas l’écran d’un autre flux', async () => {
    let rejeter!: (err: unknown) => void;
    vi.mocked(markAllAsRead).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejeter = reject; }));

    const promesse = useFeedStore.getState().markReadRelative(pivot, 'below');

    // L'utilisateur bascule sur un autre flux PENDANT l'aller-retour.
    const autreFlux = article('9999999999999999', 5_000);
    useFeedStore.setState({
      selectedFeed: { id: 'feed/2', title: 'Autre' },
      articles: [autreFlux],
    } as never);

    rejeter(refus);
    await promesse;

    // L'écran garde ce qui appartient au flux affiché — rien de l'ancienne
    // liste ne revient.
    expect(useFeedStore.getState().articles).toEqual([autreFlux]);
  });
});

// I1 (revue finale) : le retour en arrière ne restaure plus un instantané —
// il recalcule sur la liste TELLE QU'ELLE EST. Un ✓ posé ailleurs pendant le
// vol ne doit pas être défait par le rollback d'une action qui ne le
// concerne pas.
describe('markReadRelative — retour en arrière sans instantané (I1)', () => {
  it('un ✓ posé pendant le vol survit au retour en arrière', async () => {
    let rejeter!: (err: unknown) => void;
    vi.mocked(markAllAsRead).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejeter = reject; }));

    const promesse = useFeedStore.getState().markReadRelative(pivot, 'below');
    // `vieux` (en dessous de pivot) est déjà optimiste à ce stade.
    expect(useFeedStore.getState().articles.find((a) => a.id === vieuxId)?.read).toBe(true);

    // Pendant le vol, un ✓ indépendant (une autre action) marque `neuf` lu —
    // un article que CETTE action ne touche pas.
    useFeedStore.setState((s) => ({
      articles: s.articles.map((a) => (a.id === neufId ? { ...a, read: true } : a)),
    }));

    rejeter(refus);
    await promesse;

    const parId = Object.fromEntries(useFeedStore.getState().articles.map((a) => [a.id, a.read]));
    expect(parId[neufId]).toBe(true); // le ✓ posé pendant le vol survit
    expect(parId[vieuxId]).toBe(false); // l'optimisme non confirmé de CETTE action revient
  });
});

// I5 (revue finale) : un lot refusé ne défait pas les lots déjà acceptés par
// le serveur — seuls les lots non envoyés ou refusés reviennent.
describe('markReadRelative — échec partiel par lots (I5)', () => {
  it('les lots acceptés restent lus quand le suivant échoue', async () => {
    const enLot1 = '1788386439680700'; // dans le premier lot (accepté)
    const enLot2 = '1788386439680800'; // dans le second lot (refusé)
    useFeedStore.setState({
      articles: [article(enLot2, 2_000), article(enLot1, 1_000), pivot],
    } as never);

    const remplissage = (n: number, decalage: number) =>
      Array.from({ length: n }, (_, i) => `9000000000000${String(decalage + i).padStart(3, '0')}`);
    const ids = [...remplissage(40, 0), enLot1, ...remplissage(59, 100),
      ...remplissage(40, 200), enLot2, ...remplissage(9, 300)];
    expect(ids.length).toBe(150); // 100 (lot 1, avec enLot1) + 50 (lot 2, avec enLot2)
    vi.mocked(itemIdsNewerThanEntry).mockResolvedValue(ids);
    vi.mocked(markAsRead)
      .mockResolvedValueOnce(undefined) // premier lot : accepté par le serveur
      .mockRejectedValueOnce(refus); // deuxième lot : refusé

    await useFeedStore.getState().markReadRelative(pivot, 'above');

    expect(markAsRead).toHaveBeenCalledTimes(2);
    const parId = Object.fromEntries(useFeedStore.getState().articles.map((a) => [a.id, a.read]));
    expect(parId[enLot1]).toBe(true); // lot accepté : reste lu
    expect(parId[enLot2]).toBe(false); // lot refusé : revient
  });

  it('resynchronise les compteurs et avertit, même si un lot intermédiaire échoue', async () => {
    vi.mocked(itemIdsNewerThanEntry).mockResolvedValue(Array.from({ length: 250 }, (_, i) => `id${i}`));
    vi.mocked(markAsRead)
      .mockResolvedValueOnce(undefined) // premier lot : accepté par le serveur
      .mockRejectedValueOnce(refus); // deuxième lot : refusé

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

// I3 (revue finale) : le message passe par `writeFailureNotice` +
// `isNetworkFailure`, exactement comme `toggleRead` — un refus ne s'annonce
// que si le serveur a répondu, le hors-ligne véritable reste muet.
describe('markReadRelative — message d’échec (I3)', () => {
  let onLine: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    onLine = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
  });

  afterEach(() => { onLine.mockRestore(); });

  it('accuse le serveur quand il a répondu par un refus', async () => {
    vi.mocked(markAllAsRead).mockRejectedValueOnce(refus);

    await useFeedStore.getState().markReadRelative(pivot, 'below');

    const [toast] = useUiStore.getState().toasts;
    expect(toast).toMatchObject({ message: 'toast.markRangeFailed', tone: 'error' });
  });

  it('hors ligne, aucun toast n’accuse le serveur', async () => {
    onLine.mockReturnValue(false);
    vi.mocked(markAllAsRead).mockRejectedValueOnce(new Error('Network Error'));

    await useFeedStore.getState().markReadRelative(pivot, 'below');

    expect(useUiStore.getState().toasts).toHaveLength(0);
  });
});

// I3 / I4 : le corpus de recherche gardé (`searchCorpus`) est repatché par
// identifiant d'entrée. Ces tests installent un vrai corpus via `search()`,
// comme `feedStore.search.test.ts`.
describe('markReadRelative — corpus de recherche', () => {
  const buildCorpus = async () => {
    page.mockResolvedValueOnce({
      items: [
        item(neufId, 'neuf terme', 3),
        item(pivotId, 'pivot terme', 2),
        item(vieuxId, 'vieux terme', 1),
      ],
      continuation: null,
    });
    await useFeedStore.getState().search('terme');
    return useFeedStore.getState().searchResults.find((a) => a.id === pivotId)!;
  };

  it('répercute le marquage sur le corpus tenu : une recherche ultérieure le ressort lu', async () => {
    const pivotHit = await buildCorpus();

    await useFeedStore.getState().markReadRelative(pivotHit, 'below');

    page.mockClear();
    await useFeedStore.getState().search('terme'); // même périmètre : réutilise le corpus
    expect(page).not.toHaveBeenCalled();
    const vieuxHit = useFeedStore.getState().searchResults.find((a) => a.id === vieuxId)!;
    expect(vieuxHit.read).toBe(true);
  });

  it('défait le corpus quand le serveur refuse', async () => {
    const pivotHit = await buildCorpus();
    vi.mocked(markAllAsRead).mockRejectedValueOnce(refus);

    await useFeedStore.getState().markReadRelative(pivotHit, 'below');

    page.mockClear();
    await useFeedStore.getState().search('terme');
    expect(page).not.toHaveBeenCalled();
    const vieuxHit = useFeedStore.getState().searchResults.find((a) => a.id === vieuxId)!;
    expect(vieuxHit.read).toBe(false);
  });

  // I3 : une recherche neuve, dans un AUTRE périmètre, démarre pendant que
  // l'appel est en vol. Elle remplace `searchCorpus` par un objet différent
  // AVANT que le refus n'arrive — le rollback ne doit pas y toucher, sinon
  // c'est le corpus de ce périmètre-là qui se ferait patcher à tort par une
  // simple comparaison d'identifiant, sans rapport avec ce qu'il contient.
  it('ignore un corpus qui n’est plus le même : une recherche neuve entre-temps garde ses résultats intacts', async () => {
    const pivotHit = await buildCorpus();

    let rejeter!: (err: unknown) => void;
    vi.mocked(markAllAsRead).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejeter = reject; }));
    const promesse = useFeedStore.getState().markReadRelative(pivotHit, 'below');

    // Nouveau périmètre : un autre flux, avec un article déjà lu côté
    // serveur et dont l'identifiant d'entrée est plus ancien que `pivot` —
    // exactement ce que le rollback du premier corpus, mal gardé, patcherait
    // à tort en non-lu.
    useFeedStore.setState({ selectedFeed: { id: 'feed/2', title: 'Autre' } } as never);
    page.mockResolvedValueOnce({
      items: [item('1788386439680510', 'impostor terme', 1, ['user/-/state/com.google/read'])],
      continuation: null,
    });
    await useFeedStore.getState().search('terme');

    rejeter(refus);
    await promesse;

    page.mockClear();
    await useFeedStore.getState().search('terme'); // même périmètre (feed/2) : pas de réseau si le corpus est intact
    expect(page).not.toHaveBeenCalled();
    const impostorHit = useFeedStore.getState().searchResults.find((a) => a.id === '1788386439680510')!;
    expect(impostorHit.read).toBe(true);
  });
});
