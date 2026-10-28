// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../api/feeds', async () => {
  const actual = await vi.importActual<typeof import('../api/feeds')>('../api/feeds');
  return {
    ...actual,
    markAllAsRead: vi.fn().mockResolvedValue(undefined),
    markAsRead: vi.fn().mockResolvedValue(undefined),
    markAsUnread: vi.fn().mockResolvedValue(undefined),
    itemIdsNewerThanEntry: vi.fn().mockResolvedValue([]),
    getUnreadCounts: vi.fn().mockResolvedValue([]),
    getUnreadItemIds: vi.fn().mockResolvedValue({ ids: [], complete: true }),
    fetchStreamPage: vi.fn(),
  };
});

// Stub i18n so toast text is deterministic: t(key) → key. Mirrors feedStore.test.ts.
vi.mock('../i18n', () => ({
  default: { t: (k: string) => k },
}));

import { markAllAsRead, markAsRead, markAsUnread, getUnreadItemIds, itemIdsNewerThanEntry, getUnreadCounts, fetchStreamPage } from '../api/feeds';
import { useFeedStore, __resetSearchStateForTests, __resetNewArticlesStateForTests } from './feedStore';
import { useAuthStore } from './authStore';
import { useUiStore } from './uiStore';
import type { Article, GReaderItem, Filter } from '../types';
import { entryIdUsec } from '../lib/entryId';

// Identifiants d'entrée réels, dans l'ordre d'insertion FreshRSS — PAS dans
// l'ordre de `published`, choisi délibérément à l'envers ci-dessous. Toute
// borne qui se tromperait de champ (`published` au lieu de l'id) se verrait
// immédiatement : elle marquerait la ligne opposée.
//
// C1 (revue de ce correctif) : deux formes cohabitent et ne vivent PAS dans
// le même espace — `Article.id` (ce que porte une ligne à l'écran, forme
// greader hexadécimale) et le décimal nu que rend `stream/items/ids`
// (`itemIdsNewerThanEntry`, côté « au-dessus »). Un test qui donnerait le
// même littéral aux deux ne pourrait jamais voir une comparaison qui les
// confond : les fixtures ci-dessous portent délibérément les DEUX formes
// pour le même identifiant d'entrée.
const vieuxUsec = '1788386439680500'; // entrée la plus ANCIENNE, mais published la plus GRANDE
const pivotUsec = '1788386439680550';
const neufUsec = '1788386439680600'; // entrée la plus RÉCENTE, mais published la plus PETITE
// `Article.id` — forme greader hexadécimale (`0006…`, seize caractères), telle
// que la rendent `stream/contents` et `stream/items/ids?output=json`.
const vieuxId = 'tag:google.com,2005:reader/item/00065a872a7551f4';
const pivotId = 'tag:google.com,2005:reader/item/00065a872a755226';
const neufId = 'tag:google.com,2005:reader/item/00065a872a755258';

const article = (id: string, publishedMs: number): Article => ({
  id, title: id, summary: '', content: '', author: '', url: `https://example.com/${id}`,
  source: 'Flux', sourceId: 'feed/1', published: publishedMs, read: false, starred: false,
  labels: [], tags: [],
});

const vieux = article(vieuxId, 9_000_000);
const pivot = article(pivotId, 5_000_000);
const neuf = article(neufId, 1_000_000);

// La fixture n'a de valeur que si la forme greader et le décimal désignent
// vraiment la même entrée — vérifié une fois ici plutôt que supposé partout.
if (entryIdUsec(vieuxId) !== vieuxUsec || entryIdUsec(pivotId) !== pivotUsec || entryIdUsec(neufId) !== neufUsec) {
  throw new Error('fixture incohérente : la forme greader et le décimal ne désignent pas la même entrée');
}

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
  useAuthStore.setState({ activeServerId: 7, backendToken: null } as never);
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
//
// Preuve de la morsure (revue finale du 25/09) : retirer `readWritesInFlight++`
// dans `markReadRelative` (en laissant le décrément du `finally`, qui pousse
// alors le compteur en négatif) fait rougir CE test précisément — et lui
// seul, sur les 1223 de la suite. Vérifié en le retirant réellement, en
// observant l'échec ci-dessous, puis en le remettant.
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

// I1 (revue finale du 25/09) : le retour en arrière des LIGNES doit porter sa
// propre garde de vue, comme le corpus porte la sienne (`corpusModifie`
// plus bas) — b91a246 l'avait posée (`vueALancement`, capturée avant l'appel
// réseau), mais 85ac88f l'a perdue en remplaçant l'instantané de liste par un
// recalcul sur `s.articles` : ce recalcul protège CE QUI est touché, jamais
// SUR QUEL ÉCRAN on le réécrit. Le piège : un identifiant peut réapparaître
// dans une autre vue (deux sélections peuvent montrer le même article) et y
// être légitimement déjà lu — sans garde de vue, le rollback d'une action
// périmée le repasserait non lu à tort.
describe('markReadRelative — vue changée pendant l’appel', () => {
  it('ignore un refus une fois la vue changée : ne réécrit pas l’écran d’un autre flux', async () => {
    let rejeter!: (err: unknown) => void;
    vi.mocked(markAllAsRead).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejeter = reject; }));

    const promesse = useFeedStore.getState().markReadRelative(pivot, 'below');

    // L'utilisateur bascule sur un autre flux PENDANT l'aller-retour ; par
    // coïncidence, ce flux affiche déjà `vieux` — le MÊME identifiant que
    // celui que cette action a marqué lu, et qui figure donc dans
    // `touchedIds` — mais légitimement lu dans son propre contexte. Un test
    // dont le fixture porterait un identifiant absent de `touchedIds` (comme
    // `9999999999999999` ci-avant) ne mord jamais : l'intersection est vide
    // quelle que soit l'implémentation.
    const memeIdAilleurs = { ...vieux, read: true };
    useFeedStore.setState({
      selectedFeed: { id: 'feed/2', title: 'Autre' },
      articles: [memeIdAilleurs],
    } as never);

    rejeter(refus);
    await promesse;

    // L'écran garde ce qui appartient au flux affiché : le rollback d'une
    // action qui ne le concerne plus ne doit pas le repasser non lu.
    expect(useFeedStore.getState().articles).toEqual([memeIdAilleurs]);
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
//
// C1 (revue de ce correctif) : cette preuve n'a de valeur que si les DEUX
// espaces d'identifiants sont réellement différents — `enLot1`/`enLot2` sont
// donc la forme greader que porte `Article.id` sur l'écran, alors que ce que
// le mock de `itemIdsNewerThanEntry` rend (`enLot1Usec`/`enLot2Usec`) est le
// décimal nu que rend vraiment `stream/items/ids`.
describe('markReadRelative — échec partiel par lots (I5)', () => {
  it('les lots acceptés restent lus quand le suivant échoue', async () => {
    const enLot1 = 'tag:google.com,2005:reader/item/00065a872a7552bc'; // dans le premier lot (accepté)
    const enLot1Usec = '1788386439680700';
    const enLot2 = 'tag:google.com,2005:reader/item/00065a872a755320'; // dans le second lot (refusé)
    const enLot2Usec = '1788386439680800';
    useFeedStore.setState({
      articles: [article(enLot2, 2_000), article(enLot1, 1_000), pivot],
    } as never);

    const remplissage = (n: number, decalage: number) =>
      Array.from({ length: n }, (_, i) => `9000000000000${String(decalage + i).padStart(3, '0')}`);
    const ids = [...remplissage(40, 0), enLot1Usec, ...remplissage(59, 100),
      ...remplissage(40, 200), enLot2Usec, ...remplissage(9, 300)];
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

// Le plafond du proxy (429, `FRIRSS_PROXY_RATE_LIMIT`) n'est pas un refus : le
// serveur a demandé de ralentir, pas rejeté les articles. `scanErrorKind`
// (`src/lib/scanError.ts`) le distingue déjà pour le balayage de recherche ;
// `markReadRelative` doit le réutiliser plutôt que de laisser un 429 tomber
// dans la même case qu'un 403/404 (`toast.markRangeFailed`, qui mentirait
// deux fois : ni refus, ni « ces articles » en bloc alors que la plupart des
// lots ont déjà été acceptés).
describe('markReadRelative — plafond du proxy (429)', () => {
  it('avertit du plafond, pas d’un refus, quand le serveur répond 429', async () => {
    vi.mocked(markAllAsRead).mockRejectedValueOnce({ response: { status: 429 } });

    await useFeedStore.getState().markReadRelative(pivot, 'below');

    const [toast] = useUiStore.getState().toasts;
    expect(toast).toMatchObject({ message: 'toast.markRangeThrottled', tone: 'error' });
  });

  // Même scénario que I5 (« échec partiel par lots » ci-dessus) mais avec un
  // 429 au lieu d'un refus : le plafond arrête l'envoi des lots suivants sans
  // jamais défaire ceux que le serveur avait déjà acceptés. Le comportement
  // est censé être partagé avec le chemin « refus » — à prouver spécifiquement
  // sur celui-ci, pas seulement supposé.
  it('les lots acceptés restent lus quand le lot suivant heurte le plafond', async () => {
    const enLot1 = 'tag:google.com,2005:reader/item/00065a872a7552bc'; // premier lot (accepté)
    const enLot1Usec = '1788386439680700';
    const enLot2 = 'tag:google.com,2005:reader/item/00065a872a755320'; // second lot (429)
    const enLot2Usec = '1788386439680800';
    useFeedStore.setState({
      articles: [article(enLot2, 2_000), article(enLot1, 1_000), pivot],
    } as never);

    const remplissage = (n: number, decalage: number) =>
      Array.from({ length: n }, (_, i) => `9000000000000${String(decalage + i).padStart(3, '0')}`);
    const ids = [...remplissage(40, 0), enLot1Usec, ...remplissage(59, 100),
      ...remplissage(40, 200), enLot2Usec, ...remplissage(9, 300)];
    vi.mocked(itemIdsNewerThanEntry).mockResolvedValue(ids);
    vi.mocked(markAsRead)
      .mockResolvedValueOnce(undefined) // premier lot : accepté par le serveur
      .mockRejectedValueOnce({ response: { status: 429 } }); // deuxième lot : plafond

    await useFeedStore.getState().markReadRelative(pivot, 'above');

    expect(markAsRead).toHaveBeenCalledTimes(2); // le troisième lot n'est jamais tenté
    const parId = Object.fromEntries(useFeedStore.getState().articles.map((a) => [a.id, a.read]));
    expect(parId[enLot1]).toBe(true); // lot accepté : reste lu
    expect(parId[enLot2]).toBe(false); // lot au 429 : revient
    const [toast] = useUiStore.getState().toasts;
    expect(toast).toMatchObject({ message: 'toast.markRangeThrottled', tone: 'error' });
  });
});

// Le corpus de recherche gardé (`searchCorpus`) est repatché par identifiant
// d'entrée. Ces tests installent un vrai corpus via `search()`, comme
// `feedStore.search.test.ts`.
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

  // Régression : le patch d'ALLER du corpus est inconditionnel, son annulation
  // doit l'être aussi. Ici AUCUNE ligne de la plage n'est à l'écran — seul le
  // corpus balayé les connaît —, donc l'ensemble des « non confirmés » de la
  // liste est vide. Une sortie anticipée sur cet ensemble laisserait le corpus
  // optimiste après un refus, et la recherche suivante ressortirait lus des
  // articles que FreshRSS a en non-lus.
  it("défait le corpus même quand aucune ligne de la plage n'est affichée", async () => {
    const pivotHit = await buildCorpus();
    useFeedStore.setState({ articles: [pivotHit] } as never);
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
    const impostorId = 'tag:google.com,2005:reader/item/00065a872a7551fe';
    page.mockResolvedValueOnce({
      items: [item(impostorId, 'impostor terme', 1, ['user/-/state/com.google/read'])],
      continuation: null,
    });
    await useFeedStore.getState().search('terme');

    rejeter(refus);
    await promesse;

    page.mockClear();
    await useFeedStore.getState().search('terme'); // même périmètre (feed/2) : pas de réseau si le corpus est intact
    expect(page).not.toHaveBeenCalled();
    const impostorHit = useFeedStore.getState().searchResults.find((a) => a.id === impostorId)!;
    expect(impostorHit.read).toBe(true);
  });

  // I3 (revue de ce correctif) : le rollback ne doit jamais redéfaire un lot
  // que le serveur a accepté — même dans le corpus, pas seulement à l'écran.
  // Même piège que C1 : `itemIdsNewerThanEntry` rend du décimal nu, le corpus
  // porte la forme greader — sans normaliser les deux côtés, ce test serait
  // faux-vert comme l'était `feedStore.markRange.test.ts` avant ce correctif.
  it('garde lus, dans le corpus aussi, les lots déjà acceptés quand un lot suivant échoue', async () => {
    const enLot1 = 'tag:google.com,2005:reader/item/00065a872a7552bc'; // premier lot (accepté)
    const enLot1Usec = '1788386439680700';
    const enLot2 = 'tag:google.com,2005:reader/item/00065a872a755320'; // second lot (refusé)
    const enLot2Usec = '1788386439680800';
    page.mockResolvedValueOnce({
      items: [
        item(enLot2, 'lot2 terme', 3),
        item(enLot1, 'lot1 terme', 2),
        item(pivotId, 'pivot terme', 1),
      ],
      continuation: null,
    });
    await useFeedStore.getState().search('terme');
    const pivotHit = useFeedStore.getState().searchResults.find((a) => a.id === pivotId)!;

    const remplissage = (n: number, decalage: number) =>
      Array.from({ length: n }, (_, i) => `9000000000000${String(decalage + i).padStart(3, '0')}`);
    const ids = [...remplissage(40, 0), enLot1Usec, ...remplissage(59, 100),
      ...remplissage(40, 200), enLot2Usec, ...remplissage(9, 300)];
    vi.mocked(itemIdsNewerThanEntry).mockResolvedValue(ids);
    vi.mocked(markAsRead)
      .mockResolvedValueOnce(undefined) // premier lot : accepté
      .mockRejectedValueOnce(refus); // deuxième lot : refusé

    await useFeedStore.getState().markReadRelative(pivotHit, 'above');

    page.mockClear();
    await useFeedStore.getState().search('terme');
    const lot1Hit = useFeedStore.getState().searchResults.find((a) => a.id === enLot1)!;
    const lot2Hit = useFeedStore.getState().searchResults.find((a) => a.id === enLot2)!;
    expect(lot1Hit.read).toBe(true); // lot accepté : reste lu dans le corpus
    expect(lot2Hit.read).toBe(false); // lot refusé : revient dans le corpus
  });

  // I3 / C2 (revue de ce correctif) : le rollback recalcule sur une plage,
  // qui ne sait rien du fait qu'un article y était DÉJÀ lu avant l'action.
  // Sans exclusion explicite, il le repasserait non lu à tort — dans le
  // corpus comme à l'écran (voir la description C2, plus bas).
  it('ne redevient jamais non lu, dans le corpus, un article qui était déjà lu avant l’action', async () => {
    // `vieux2` est du corpus SEULEMENT — pas de la liste chargée — pour que
    // le rollback n'ait pas d'autre raison de s'arrêter tôt que l'exclusion
    // qu'on vérifie ici. `unconfirmed` doit rester non vide (un test où il
    // serait vide dès le départ ne prouverait rien : le patch de corpus ne
    // serait jamais atteint, exclusion ou pas) — `vieux2`, LUI chargé et non
    // lu, s'en charge : le serveur refuse, il revient sans confirmation.
    const vieux2Id = 'tag:google.com,2005:reader/item/00065a872a755208'; // plus ancien que pivot, non lu
    const vieux2 = article(vieux2Id, 4_000);
    useFeedStore.setState({ articles: [neuf, pivot, vieux2] } as never);
    page.mockResolvedValueOnce({
      items: [
        item(neufId, 'neuf terme', 4),
        item(pivotId, 'pivot terme', 3),
        item(vieux2Id, 'vieux2 terme', 2),
        item(vieuxId, 'vieux terme', 1, ['user/-/state/com.google/read']), // déjà lu côté serveur
      ],
      continuation: null,
    });
    await useFeedStore.getState().search('terme');
    const pivotHit = useFeedStore.getState().searchResults.find((a) => a.id === pivotId)!;
    // `search()` a remplacé `articles` par ses résultats (les quatre) : on
    // revient à la liste voulue, SANS `vieux` — qui n'existe que dans le
    // corpus balayé, comme dans le test I4.
    useFeedStore.setState({
      articles: useFeedStore.getState().articles.filter((a) => a.id !== vieuxId),
    } as never);
    vi.mocked(markAllAsRead).mockRejectedValueOnce(refus);

    await useFeedStore.getState().markReadRelative(pivotHit, 'below');

    page.mockClear();
    await useFeedStore.getState().search('terme');
    const vieuxHit = useFeedStore.getState().searchResults.find((a) => a.id === vieuxId)!;
    const vieux2Hit = useFeedStore.getState().searchResults.find((a) => a.id === vieux2Id)!;
    expect(vieuxHit.read).toBe(true); // déjà lu avant l'action : jamais redevenu non lu
    expect(vieux2Hit.read).toBe(false); // non confirmé par cette action : revient normalement
  });

  // I4 (revue de ce correctif, régression de 85ac88f) : le patch optimiste du
  // corpus ne doit PAS dépendre de `touchedIds` — cet ensemble ne porte que
  // ce qui est CHARGÉ à l'écran, alors que le corpus peut aller plus loin
  // (un balayage de recherche antérieur). Ici, la seule ligne chargée est le
  // pivot lui-même : rien à l'écran n'est « en dessous », mais le corpus, lui,
  // contient une entrée plus ancienne.
  it('patch le corpus même quand aucune ligne chargée n’est dans la plage', async () => {
    page.mockResolvedValueOnce({
      items: [item(pivotId, 'pivot terme', 2), item(vieuxId, 'vieux terme', 1)],
      continuation: null,
    });
    await useFeedStore.getState().search('terme');
    const pivotHit = useFeedStore.getState().searchResults.find((a) => a.id === pivotId)!;

    // `search()` a posé `articles` sur les deux résultats — on l'écrase pour
    // ne garder QUE le pivot chargé, comme si le reste (`vieux`) n'existait
    // que dans le corpus balayé et pas dans la tranche visible à l'écran.
    useFeedStore.setState({ articles: [pivotHit] } as never);

    await useFeedStore.getState().markReadRelative(pivotHit, 'below');

    page.mockClear();
    await useFeedStore.getState().search('terme');
    const vieuxHit = useFeedStore.getState().searchResults.find((a) => a.id === vieuxId)!;
    expect(vieuxHit.read).toBe(true);
  });
});

// C2 (revue de ce correctif) : le prédicat de plage ne regarde que l'ordre
// d'insertion, jamais `read` — une ligne déjà lue AVANT l'action ne doit
// jamais pouvoir redevenir non lue si le serveur refuse. Ce refus ne parle
// que de ce que CETTE action a changé, pas de l'état antérieur de la ligne.
describe('markReadRelative — jamais redevenu non lu ce qui était déjà lu (C2)', () => {
  it('un article déjà lu avant l’action le reste quand le serveur refuse', async () => {
    useFeedStore.setState({
      articles: [neuf, pivot, { ...vieux, read: true }],
    } as never);
    vi.mocked(markAllAsRead).mockRejectedValueOnce(refus);

    await useFeedStore.getState().markReadRelative(pivot, 'below');

    const parId = Object.fromEntries(useFeedStore.getState().articles.map((a) => [a.id, a.read]));
    expect(parId[vieuxId]).toBe(true);
  });
});

// Un marquage de plage est un travail de plusieurs secondes : il le dit (la
// barre du haut, comme « tout lu »), et deux marquages se suivent au lieu de
// se croiser.
const differe = <T = void>() => {
  let resoudre!: (v: T) => void;
  let rejeter!: (e: unknown) => void;
  const promesse = new Promise<T>((res, rej) => { resoudre = res; rejeter = rej; });
  return { promesse, resoudre, rejeter };
};
const flushTout = () => new Promise((r) => setTimeout(r, 0));

describe('markReadRelative — la progression', () => {
  beforeEach(() => {
    useFeedStore.setState({ bulkWork: null } as never);
  });

  it('a range mark shows progress, batch by batch, and clears it afterwards', async () => {
    vi.mocked(itemIdsNewerThanEntry).mockResolvedValue(Array.from({ length: 250 }, (_, i) => `id${i}`));
    const echantillons: Array<{ done: number; total: number | null } | null> = [];
    const desabonner = useFeedStore.subscribe((s, prev) => {
      if (s.bulkWork !== prev.bulkWork) echantillons.push(s.bulkWork);
    });

    const promesse = useFeedStore.getState().markReadRelative(pivot, 'above');
    // Visible dès la demande, avant même que le relevé ne réponde.
    expect(useFeedStore.getState().bulkWork).not.toBeNull();
    await promesse;
    desabonner();

    const vus = echantillons.filter((b): b is { done: number; total: number | null } => b !== null);
    expect(vus).toContainEqual({ done: 0, total: 250 });
    expect(vus).toContainEqual({ done: 100, total: 250 });
    expect(vus).toContainEqual({ done: 200, total: 250 });
    expect(vus).toContainEqual({ done: 250, total: 250 });
    const dones = vus.filter((b) => b.total === 250).map((b) => b.done);
    expect(dones).toEqual([...dones].sort((a, b) => a - b));
    expect(useFeedStore.getState().bulkWork).toBeNull();
  });

  it('clears the progress when the server refuses', async () => {
    vi.mocked(markAllAsRead).mockRejectedValueOnce(refus);
    const promesse = useFeedStore.getState().markReadRelative(pivot, 'below');
    expect(useFeedStore.getState().bulkWork).not.toBeNull();
    await promesse;
    expect(useFeedStore.getState().bulkWork).toBeNull();
  });

  it('a mark that waits for the previous one already shows it is waiting', async () => {
    const premier = differe();
    vi.mocked(markAllAsRead).mockReturnValueOnce(premier.promesse);

    const p1 = useFeedStore.getState().markReadRelative(pivot, 'below');
    const p2 = useFeedStore.getState().markReadRelative(neuf, 'below');
    expect(useFeedStore.getState().bulkWork).not.toBeNull();

    premier.resoudre();
    await p1;
    // Le premier a fini, le second attend/travaille encore : la barre ne s'éteint pas entre les deux.
    expect(useFeedStore.getState().bulkWork).not.toBeNull();
    await p2;
    expect(useFeedStore.getState().bulkWork).toBeNull();
  });

  it('« tout lu » finishing does not switch off the bar of a range mark still running', async () => {
    const plage = differe();
    vi.mocked(markAllAsRead).mockReturnValueOnce(plage.promesse); // la plage, en vol

    const p1 = useFeedStore.getState().markReadRelative(pivot, 'below');
    await useFeedStore.getState().markAllAsRead(); // « tout lu » complet, pendant ce temps
    expect(useFeedStore.getState().bulkWork).not.toBeNull();

    plage.resoudre();
    await p1;
    expect(useFeedStore.getState().bulkWork).toBeNull();
  });
});

describe('markReadRelative — deux marquages qui se chevauchent', () => {
  it('two overlapping range marks run one after the other', async () => {
    const premier = differe();
    vi.mocked(markAllAsRead).mockReturnValueOnce(premier.promesse);
    vi.mocked(itemIdsNewerThanEntry).mockResolvedValue(['9000000000000001']);

    const p1 = useFeedStore.getState().markReadRelative(pivot, 'below');
    const p2 = useFeedStore.getState().markReadRelative(pivot, 'above');
    await flushTout();

    // Le second n'a rien envoyé tant que le premier n'a pas répondu.
    expect(markAllAsRead).toHaveBeenCalledTimes(1);
    expect(itemIdsNewerThanEntry).not.toHaveBeenCalled();
    expect(markAsRead).not.toHaveBeenCalled();

    premier.resoudre();
    await Promise.all([p1, p2]);

    expect(itemIdsNewerThanEntry).toHaveBeenCalledTimes(1);
    expect(markAsRead).toHaveBeenCalledTimes(1);
    expect(useFeedStore.getState().articles.map((a) => [a.id, a.read])).toEqual([
      [neufId, true], [pivotId, false], [vieuxId, true],
    ]);
  });

  it('a failed first mark does not revert rows the second marked', async () => {
    const premier = differe();
    vi.mocked(markAllAsRead).mockReturnValueOnce(premier.promesse); // 2e appel : résolu d'emblée

    // 1er : en dessous du pivot (marque `vieux`) ; 2e : en dessous de `neuf`
    // (marque `pivot` ET `vieux`).
    const p1 = useFeedStore.getState().markReadRelative(pivot, 'below');
    const p2 = useFeedStore.getState().markReadRelative(neuf, 'below');
    premier.rejeter(refus);
    await Promise.all([p1, p2]);

    // Le serveur a refusé le premier et accepté le second, qui couvre `vieux`.
    expect(useFeedStore.getState().articles.map((a) => [a.id, a.read])).toEqual([
      [neufId, false], [pivotId, true], [vieuxId, true],
    ]);
  });

  describe('avec un corpus de recherche', () => {
    const buildCorpus = async () => {
      page.mockResolvedValueOnce({
        items: [item(neufId, 'neuf terme', 3), item(pivotId, 'pivot terme', 2), item(vieuxId, 'vieux terme', 1)],
        continuation: null,
      });
      await useFeedStore.getState().search('terme');
      return useFeedStore.getState().searchResults;
    };
    const luDansLeCorpus = async () => {
      page.mockClear();
      await useFeedStore.getState().search('terme'); // même périmètre : rend le corpus, sans réseau
      expect(page).not.toHaveBeenCalled();
      return Object.fromEntries(useFeedStore.getState().searchResults.map((a) => [a.id, a.read]));
    };

    it('the corpus is never left optimistic after two marks', async () => {
      const [neufHit, pivotHit] = await buildCorpus();
      // Deux refus : rien n'a changé côté serveur, le corpus doit tout rendre non lu.
      vi.mocked(markAllAsRead).mockRejectedValueOnce(refus).mockRejectedValueOnce(refus);

      const p1 = useFeedStore.getState().markReadRelative(pivotHit, 'below');
      const p2 = useFeedStore.getState().markReadRelative(neufHit, 'below');
      await Promise.all([p1, p2]);

      expect(await luDansLeCorpus()).toEqual({ [neufId]: false, [pivotId]: false, [vieuxId]: false });
    });

    it('the corpus keeps what the second mark confirmed when the first is refused', async () => {
      const [neufHit, pivotHit] = await buildCorpus();
      vi.mocked(markAllAsRead).mockRejectedValueOnce(refus).mockResolvedValueOnce(undefined);

      await Promise.all([
        useFeedStore.getState().markReadRelative(pivotHit, 'below'),
        useFeedStore.getState().markReadRelative(neufHit, 'below'),
      ]);

      expect(await luDansLeCorpus()).toEqual({ [neufId]: false, [pivotId]: true, [vieuxId]: true });
    });

    // Rafraîchir pendant un marquage en vol : `topUpSearch` réaffecte le
    // corpus (il y ajoute les entrées plus récentes). Un retour en arrière
    // qui comparait le corpus PAR RÉFÉRENCE renonçait alors, et les lignes
    // restaient lues dans le corpus jusqu'à cinq minutes.
    it('a refresh during an in-flight mark does not strand the corpus as read', async () => {
      const [, pivotHit] = await buildCorpus();
      const enVol = differe();
      vi.mocked(markAllAsRead).mockReturnValueOnce(enVol.promesse);

      const promesse = useFeedStore.getState().markReadRelative(pivotHit, 'below');
      const frais = 'tag:google.com,2005:reader/item/00065a872a7552ff'; // plus récent que `neuf`
      page.mockResolvedValueOnce({
        items: [item(frais, 'frais terme', 4), item(neufId, 'neuf terme', 3)],
        continuation: null,
      });
      await useFeedStore.getState().loadArticles(); // topUpSearch : le corpus change d'objet

      enVol.rejeter(refus);
      await promesse;

      const lu = await luDansLeCorpus();
      expect(lu[frais]).toBe(false); // l'entrée arrivée entre-temps n'a jamais été touchée
      expect(lu[vieuxId]).toBe(false); // la ligne que CE marquage avait passée lue revient
    });
  });
});

// Un marquage en attente a figé son périmètre (flux, borne) au clic, mais la
// requête, elle, part vers le serveur ACTIF au moment de l'envoi : après un
// changement de serveur ou une déconnexion, elle écrirait sur le mauvais
// FreshRSS (un `feed/<id>` numérique peut y désigner un autre flux), sans
// retour en arrière possible.
describe('markReadRelative — le serveur ou la session change pendant l’attente', () => {
  it('a queued mark sends nothing once the active server has changed', async () => {
    const premier = differe();
    vi.mocked(markAllAsRead).mockReturnValueOnce(premier.promesse);

    const p1 = useFeedStore.getState().markReadRelative(pivot, 'below');
    const p2 = useFeedStore.getState().markReadRelative(neuf, 'below');
    useAuthStore.setState({ activeServerId: 8 } as never);
    premier.resoudre();
    await Promise.all([p1, p2]);

    expect(markAllAsRead).toHaveBeenCalledTimes(1);
    expect(useFeedStore.getState().bulkWork).toBeNull();
  });

  it('a queued mark sends nothing once the FriRSS session has closed', async () => {
    useAuthStore.setState({ backendToken: 'jwt' } as never);
    const premier = differe();
    vi.mocked(markAllAsRead).mockReturnValueOnce(premier.promesse);

    const p1 = useFeedStore.getState().markReadRelative(pivot, 'below');
    const p2 = useFeedStore.getState().markReadRelative(neuf, 'below');
    useAuthStore.setState({ backendToken: null } as never);
    premier.resoudre();
    await Promise.all([p1, p2]);

    expect(markAllAsRead).toHaveBeenCalledTimes(1);
    expect(useFeedStore.getState().bulkWork).toBeNull();
  });

  it('the remaining batches of an in-flight « above » stop when the server changes', async () => {
    vi.mocked(itemIdsNewerThanEntry).mockResolvedValue(Array.from({ length: 250 }, (_, i) => `id${i}`));
    vi.mocked(markAsRead).mockImplementation(async () => {
      useAuthStore.setState({ activeServerId: 8 } as never); // pendant le premier lot
    });

    await useFeedStore.getState().markReadRelative(pivot, 'above');

    expect(markAsRead).toHaveBeenCalledTimes(1);
    expect(useFeedStore.getState().bulkWork).toBeNull();
    vi.mocked(markAsRead).mockResolvedValue(undefined);
  });
});

describe('markReadRelative — la barre partagée avec le retour en arrière de « tout lu »', () => {
  it('a range mark finishing during an undo does not switch off the undo bar', async () => {
    vi.mocked(getUnreadItemIds).mockResolvedValue({ ids: ['a', 'b'], complete: true });
    const syncCounts = vi.spyOn(useFeedStore.getState(), 'syncCounts').mockResolvedValue(undefined);
    const loadArticles = vi.spyOn(useFeedStore.getState(), 'loadArticles').mockResolvedValue(undefined);
    await useFeedStore.getState().markAllAsRead();
    const rendre = differe();
    vi.mocked(markAsUnread).mockReturnValueOnce(rendre.promesse);

    const annulation = useUiStore.getState().toasts.at(-1)!.action!.run();
    await flushTout();
    expect(useFeedStore.getState().bulkWork).not.toBeNull();

    await useFeedStore.getState().markReadRelative(pivot, 'below'); // finit pendant la restauration
    expect(useFeedStore.getState().bulkWork).not.toBeNull();

    rendre.resoudre();
    await annulation;
    expect(useFeedStore.getState().bulkWork).toBeNull();
    syncCounts.mockRestore();
    loadArticles.mockRestore();
  });
});

describe('markReadRelative — le corpus d’une autre recherche n’est pas le sien', () => {
  it('a queued mark does not patch a search corpus of another scope', async () => {
    const premier = differe();
    vi.mocked(markAllAsRead).mockReturnValueOnce(premier.promesse);
    const p1 = useFeedStore.getState().markReadRelative(neuf, 'below');
    const p2 = useFeedStore.getState().markReadRelative(pivot, 'below'); // attend, flux feed/1

    // Pendant l'attente : un autre flux, une recherche, un corpus à lui. Son
    // article, plus ancien que `pivot`, est non lu et n'appartient pas à ce marquage.
    useFeedStore.setState({ selectedFeed: { id: 'feed/2', title: 'Autre' } } as never);
    const autreId = 'tag:google.com,2005:reader/item/00065a872a7551fe';
    page.mockResolvedValueOnce({ items: [item(autreId, 'autre terme', 1)], continuation: null });
    await useFeedStore.getState().search('terme');

    premier.resoudre();
    await Promise.all([p1, p2]);

    page.mockClear();
    await useFeedStore.getState().search('terme');
    expect(page).not.toHaveBeenCalled();
    expect(useFeedStore.getState().searchResults.find((a) => a.id === autreId)!.read).toBe(false);
  });
});

describe('markReadRelative — ne rejette jamais', () => {
  it('resolves even when the follow-up count sync itself fails', async () => {
    const syncCounts = vi.spyOn(useFeedStore.getState(), 'syncCounts').mockRejectedValue(new Error('boom'));
    vi.mocked(markAllAsRead).mockRejectedValueOnce(refus);

    await expect(useFeedStore.getState().markReadRelative(pivot, 'below')).resolves.toBeUndefined();

    expect(useFeedStore.getState().bulkWork).toBeNull();
    syncCounts.mockRestore();
  });
});
