// @vitest-environment jsdom
//
// M-13 (second round 1.9.0) : le retour sur l'onglet relit aussi les
// abonnements et les étiquettes. Une étiquette renommée sur un autre appareil
// gardait ici son ancien nom, et la reposer recréait l'ancienne.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/offlineStore', () => ({
  listsPatch: vi.fn(async () => {}),
  listGet: vi.fn(async () => undefined),
  listPut: vi.fn(async () => {}),
  listEvictOlderThan: vi.fn(async () => {}),
  listsWithoutSource: vi.fn(async () => {}),
  subsGet: vi.fn(async () => undefined),
  subsPut: vi.fn(async () => {}),
  clearOfflineViews: vi.fn(async () => {}),
  queueGet: vi.fn(async () => []),
  queuePut: vi.fn(async () => {}),
}));
vi.mock('../api/feeds', () => ({
  getSubscriptionList: vi.fn(), getUnreadCounts: vi.fn(async () => []), getStreamContents: vi.fn(async () => ({ items: [], continuation: null })),
  getStarredItems: vi.fn(async () => ({ items: [], continuation: null })),
  markAsRead: vi.fn(async () => {}), markAsUnread: vi.fn(async () => {}),
  markAsStarred: vi.fn(async () => {}), removeStarred: vi.fn(async () => {}),
  markAllAsRead: vi.fn(async () => {}), getUnreadItemIds: vi.fn(async () => ({ ids: [], complete: true })),
  fetchStreamPage: vi.fn(), subscribeFeed: vi.fn(), editFeed: vi.fn(), unsubscribeFeed: vi.fn(),
  getTagList: vi.fn(async () => []), getStreamItemCount: vi.fn(async () => 3), setArticleLabel: vi.fn(async () => {}),
  renameTag: vi.fn(), deleteTag: vi.fn(), clearWriteToken: vi.fn(), itemIdsNewerThanEntry: vi.fn(async () => []),
}));
vi.mock('../api/backend', () => ({ startActualize: vi.fn(), getActualizeStatus: vi.fn() }));
vi.mock('../i18n', () => ({ default: { t: (k: string) => k } }));
vi.mock('../lib/extractCache', () => ({
  peekExtract: vi.fn(() => undefined), getExtract: vi.fn(async () => undefined), putExtract: vi.fn(async () => {}),
  pinExtract: vi.fn(async () => {}), unpinExtractsExcept: vi.fn(async () => {}),
}));
vi.mock('../utils/extractContent', () => ({ extractFullContent: vi.fn(async () => { throw new Error('no'); }) }));

const OLD = 'user/-/label/Ancien';
const NEW = 'user/-/label/Nouveau';
const CAT = 'user/-/label/Tech';
const sub = (title: string) => ({ id: 'feed/1', title, categories: [{ id: CAT, label: 'Tech' }], iconUrl: '/f.php?h=1' });

async function load() {
  vi.resetModules();
  const api = await import('../api/feeds');
  const { useFeedStore } = await import('./feedStore');
  const { useAuthStore } = await import('./authStore');
  const { useUiStore } = await import('./uiStore');
  useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 }, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true } as never);
  useUiStore.setState({ showLabelCounts: true } as never);
  vi.mocked(api.getSubscriptionList).mockResolvedValue([sub('Avant')] as never);
  vi.mocked(api.getTagList).mockResolvedValue([{ id: CAT, type: 'folder' }, { id: OLD, type: 'tag' }] as never);
  await useFeedStore.getState().loadSubscriptions();
  await settled();
  useFeedStore.getState().selectView({ id: 'feed/1', title: 'Avant', categories: [] } as never, 'all');
  await settled();
  vi.clearAllMocks();
  return { api, useFeedStore };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const settled = async () => { for (let i = 0; i < 6; i++) await flush(); };

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  localStorage.clear();
});

describe('silentRefresh relit abonnements et étiquettes (M-13)', () => {
  it('une étiquette renommée ailleurs prend son nouveau nom, une requête chacune', async () => {
    const { api, useFeedStore } = await load();
    expect(useFeedStore.getState().labels.map((l) => l.id)).toEqual([OLD]);
    vi.mocked(api.getSubscriptionList).mockResolvedValue([sub('Après')] as never);
    vi.mocked(api.getTagList).mockResolvedValue([{ id: CAT, type: 'folder' }, { id: NEW, type: 'tag' }] as never);
    await useFeedStore.getState().silentRefresh();
    await settled();
    expect(useFeedStore.getState().labels.map((l) => l.id)).toEqual([NEW]);
    expect(useFeedStore.getState().subscriptions.map((s) => s.title)).toEqual(['Après']);
    // Le favicon passe par la même normalisation qu'au démarrage.
    expect(useFeedStore.getState().subscriptions[0].iconUrl).toBe('https://a.example/f.php?h=1');
    expect(useFeedStore.getState().categoryIds).toEqual([CAT]);
    expect(api.getSubscriptionList).toHaveBeenCalledTimes(1);
    expect(api.getTagList).toHaveBeenCalledTimes(1);
    // La nouvelle étiquette n'avait pas de compte : il est demandé.
    expect(useFeedStore.getState().labelCounts[NEW]).toBe(3);
  });

  it('des étiquettes inchangées ne redemandent pas leurs comptes', async () => {
    const { api, useFeedStore } = await load();
    await useFeedStore.getState().silentRefresh();
    await settled();
    expect(api.getTagList).toHaveBeenCalledTimes(1);
    // (Les totaux Favoris / Plus tard passent aussi par là : seuls les
    // comptes d'étiquettes sont regardés.)
    expect(vi.mocked(api.getStreamItemCount).mock.calls.filter(([id]) => id === OLD)).toEqual([]);
  });

  it('pendant un relevé en cours (sondage toutes les 3 s), rien de plus n’est relu', async () => {
    const { api, useFeedStore } = await load();
    useFeedStore.setState({ refreshPhase: 'running' } as never);
    await useFeedStore.getState().silentRefresh();
    await settled();
    expect(api.getSubscriptionList).not.toHaveBeenCalled();
    expect(api.getTagList).not.toHaveBeenCalled();
  });

  it('hors ligne, les abonnements affichés restent', async () => {
    const { api, useFeedStore } = await load();
    vi.mocked(api.getSubscriptionList).mockRejectedValue(new Error('réseau'));
    vi.mocked(api.getTagList).mockRejectedValue(new Error('réseau'));
    await useFeedStore.getState().silentRefresh();
    await settled();
    expect(useFeedStore.getState().subscriptions.map((s) => s.title)).toEqual(['Avant']);
    expect(useFeedStore.getState().labels.map((l) => l.id)).toEqual([OLD]);
  });
});
