// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Subscription } from '../types';

vi.mock('../api/feeds', () => ({
  getSubscriptionList: vi.fn(),
  getUnreadCounts: vi.fn(),
  getStreamContents: vi.fn(),
  getStarredItems: vi.fn(),
  markAsRead: vi.fn(() => Promise.resolve()),
  markAsUnread: vi.fn(() => Promise.resolve()),
  markAsStarred: vi.fn(() => Promise.resolve()),
  removeStarred: vi.fn(() => Promise.resolve()),
  markAllAsRead: vi.fn(() => Promise.resolve()),
  fetchStreamPage: vi.fn(),
  subscribeFeed: vi.fn(),
  editFeed: vi.fn(),
  unsubscribeFeed: vi.fn(),
  getTagList: vi.fn(),
  setArticleLabel: vi.fn(),
  renameTag: vi.fn(),
  deleteTag: vi.fn(),
  clearWriteToken: vi.fn(),
}));
vi.mock('../lib/offlineStore', () => ({
  listGet: vi.fn(() => Promise.resolve(undefined)),
  listPut: vi.fn(() => Promise.resolve()),
  listEvictOlderThan: vi.fn(() => Promise.resolve()),
  subsGet: vi.fn(() => Promise.resolve(undefined)),
  subsPut: vi.fn(() => Promise.resolve()),
  queueGet: vi.fn(() => Promise.resolve([])),
  queuePut: vi.fn(() => Promise.resolve()),
}));
vi.mock('../api/backend', () => ({ startActualize: vi.fn(), getActualizeStatus: vi.fn() }));
vi.mock('../i18n', () => ({ default: { t: (k: string) => k } }));


import { useFeedStore } from './feedStore';
import * as api from '../api/feeds';

// Flux propre au fichier : le cache mémoire du store survit d'un test à l'autre.
const feed = { id: 'feed/91', title: 'Panne' } as Subscription;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  useFeedStore.setState({ selectedFeed: feed, filter: 'unread', articles: [], continuation: null, searchQuery: '', listFailed: false });
});

// Un échec sans liste de secours laissait seulement `articles` vide : l'écran
// affichait « Tout est lu ! ». Le store doit dire que la vue a échoué.
describe('feedStore — chargement de la liste en échec', () => {
  it('lève listFailed quand le chargement échoue sans liste de secours', async () => {
    vi.mocked(api.getStreamContents).mockRejectedValue(new Error('Network Error'));
    await useFeedStore.getState().loadArticles();
    expect(useFeedStore.getState().articles).toEqual([]);
    expect(useFeedStore.getState().listFailed).toBe(true);
  });

  it('le retombe au chargement suivant, réussi', async () => {
    vi.mocked(api.getStreamContents).mockRejectedValueOnce(new Error('Network Error'));
    await useFeedStore.getState().loadArticles();
    vi.mocked(api.getStreamContents).mockResolvedValue({ items: [], continuation: null });
    await useFeedStore.getState().loadArticles();
    expect(useFeedStore.getState().listFailed).toBe(false);
  });

  // La relecture silencieuse (minuteur, retour au premier plan) réussie et
  // vide laissait « Le chargement a échoué » au lieu de « Tout est lu ».
  it('le retombe aussi à une relecture silencieuse réussie', async () => {
    useFeedStore.setState({ listFailed: true });
    vi.mocked(api.getUnreadCounts).mockResolvedValue([] as never);
    vi.mocked(api.getStreamContents).mockResolvedValue({ items: [], continuation: null });
    await useFeedStore.getState().silentRefresh();
    expect(useFeedStore.getState().listFailed).toBe(false);
  });
});

// L'échec de la vue nue « collait » à une recherche lancée ensuite : une
// recherche sans résultat affichait « Échec du chargement » et un Réessayer
// qui, pendant une recherche, ne recharge pas la vue.
describe('feedStore — recherche après un échec de la vue', () => {
  it('une recherche repart d’un état sans échec', async () => {
    useFeedStore.setState({ listFailed: true });
    vi.mocked(api.getStreamContents).mockResolvedValue({ items: [], continuation: null });
    vi.mocked(api.fetchStreamPage).mockResolvedValue({ items: [], continuation: null } as never);
    await useFeedStore.getState().search('zzz');
    expect(useFeedStore.getState().listFailed).toBe(false);
  });
});

// Garde de changement de serveur posée sur le succès seulement : un chargement
// parti sur A, qui échoue après la bascule vers B, posait les abonnements
// persistés (une seule clé pour tous les serveurs) et éteignait l'indicateur
// de synchronisation pendant que celui de B tournait encore.
describe('feedStore — abonnements : échec d’un chargement parti sur un autre serveur', () => {
  it('n’écrit rien et laisse l’indicateur au chargement en cours', async () => {
    const { useAuthStore } = await import('./authStore');
    const { subsGet } = await import('../lib/offlineStore');
    useAuthStore.setState({ activeServerId: '1' });
    useFeedStore.setState({ subscriptions: [], syncing: false });
    let fail!: (e: Error) => void;
    vi.mocked(api.getSubscriptionList).mockReturnValue(new Promise((_, r) => { fail = r; }) as never);
    vi.mocked(api.getUnreadCounts).mockResolvedValue([] as never);
    // Premier appel : l'instantané du début de chargement (avant la bascule), vide ici.
    vi.mocked(subsGet).mockResolvedValueOnce(undefined).mockResolvedValue([{ id: 'feed/1', title: 'De A', categories: [] }] as never);
    const p = useFeedStore.getState().loadSubscriptions();
    useAuthStore.setState({ activeServerId: '2' });
    useFeedStore.setState({ syncing: true });
    fail(new Error('timeout'));
    await p;
    expect(useFeedStore.getState().subscriptions).toEqual([]);
    expect(useFeedStore.getState().syncing).toBe(true);
  });
});
