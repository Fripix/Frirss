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
});
