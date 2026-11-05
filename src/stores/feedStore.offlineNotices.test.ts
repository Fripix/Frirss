// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * Hors ligne : ce que l'app DIT (campagne 1.9.0).
 *
 * L-22 — relancée hors ligne (PWA iOS rouverte sans réseau), l'app n'annonçait
 * plus les actions en attente : `replayQueue` sortait avant de lire la file,
 * et la lecture de la file ne mettait pas le compteur du bandeau à jour.
 *
 * L-23 — « Tout lu » confirmé hors ligne, ou sur un 502 en ligne, ne faisait
 * rien, sans un mot (`catch { /* ignore *\/ }`).
 *
 * Chaque test recharge les modules : la copie mémoire de la file est un état
 * de module.
 */

const idb = vi.hoisted(() => ({ queue: [] as Record<string, unknown>[] }));

vi.mock('../lib/offlineStore', () => ({
  listsPatch: vi.fn(async () => {}),
  listGet: vi.fn(async () => undefined),
  listPut: vi.fn(async () => {}),
  listEvictOlderThan: vi.fn(async () => {}),
  listsWithoutSource: vi.fn(async () => {}),
  subsGet: vi.fn(async () => undefined),
  subsPut: vi.fn(async () => {}),
  clearOfflineViews: vi.fn(async () => {}),
  queueGet: vi.fn(async () => [...idb.queue]),
  queuePut: vi.fn(async (q: Record<string, unknown>[]) => { idb.queue = [...q]; }),
}));
vi.mock('../api/feeds', () => ({
  getSubscriptionList: vi.fn(), getUnreadCounts: vi.fn(async () => []), getStreamContents: vi.fn(),
  getStarredItems: vi.fn(async () => ({ items: [], continuation: null })),
  markAsRead: vi.fn(), markAsUnread: vi.fn(), markAsStarred: vi.fn(), removeStarred: vi.fn(),
  markAllAsRead: vi.fn(), getUnreadItemIds: vi.fn(), fetchStreamPage: vi.fn(), subscribeFeed: vi.fn(),
  editFeed: vi.fn(), unsubscribeFeed: vi.fn(), getTagList: vi.fn(async () => []), getStreamItemCount: vi.fn(),
  setArticleLabel: vi.fn(), renameTag: vi.fn(), deleteTag: vi.fn(), clearWriteToken: vi.fn(), itemIdsNewerThanEntry: vi.fn(),
}));
vi.mock('../api/backend', () => ({ startActualize: vi.fn(), getActualizeStatus: vi.fn() }));
vi.mock('../i18n', () => ({ default: { t: (k: string) => k } }));

async function load() {
  vi.resetModules();
  const api = await import('../api/feeds');
  const { useFeedStore } = await import('./feedStore');
  const { useAuthStore } = await import('./authStore');
  const { useUiStore } = await import('./uiStore');
  return { api, useFeedStore, useAuthStore, useUiStore };
}
const setOnline = (on: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });
const act = (id: string, scope: string) => ({
  key: `${scope}|${id}|read`, articleId: id, type: 'read', value: true, at: 1, attempts: 0, scope,
});

beforeEach(() => {
  setOnline(true);
  localStorage.clear();
  vi.clearAllMocks();
  idb.queue = [];
});

describe('L-22 — relancée hors ligne, l’app annonce encore ses actions en attente', () => {
  it('le rejeu hors ligne lit la file et met le compteur du bandeau à jour', async () => {
    const { api, useFeedStore, useAuthStore } = await load();
    useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 } as never, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true });
    idb.queue = [act('a', '7@1'), act('b', '7@1')];
    setOnline(false);
    await useFeedStore.getState().replayQueue();
    expect(useFeedStore.getState().pendingActions).toBe(2);
    expect(api.markAsRead).not.toHaveBeenCalled();
    expect(idb.queue).toHaveLength(2);
  });
});

describe('L-23 — « Tout lu » qui ne peut pas aboutir le dit', () => {
  async function setup() {
    const env = await load();
    env.useAuthStore.setState({ activeServerId: '1', backendToken: 'x' });
    env.useUiStore.setState({ toasts: [] });
    const feed = { id: 'feed/12', title: 'F' } as never;
    env.useFeedStore.setState({ selectedFeed: feed, filter: 'all', articles: [], subscriptions: [feed], searchQuery: '', unreadCounts: { 'feed/12': 40 } });
    return env;
  }

  it('hors ligne : rien n’est envoyé, un message le dit, le compteur reste', async () => {
    const { api, useFeedStore, useUiStore } = await setup();
    setOnline(false);
    await useFeedStore.getState().markAllAsRead();
    expect(api.markAllAsRead).not.toHaveBeenCalled();
    expect(api.getUnreadItemIds).not.toHaveBeenCalled();
    expect(useUiStore.getState().toasts.map((t) => [t.message, t.tone])).toEqual([['toast.markAllOffline', 'error']]);
    expect(useFeedStore.getState().unreadCounts['feed/12']).toBe(40);
  });

  it('le serveur échoue (502) : un message le dit, le compteur reste', async () => {
    const { api, useFeedStore, useUiStore } = await setup();
    vi.mocked(api.getUnreadItemIds).mockResolvedValue({ ids: ['a'], complete: true } as never);
    vi.mocked(api.markAllAsRead).mockRejectedValue(Object.assign(new Error('502'), { response: { status: 502 } }));
    await useFeedStore.getState().markAllAsRead();
    expect(useUiStore.getState().toasts.map((t) => [t.message, t.tone])).toEqual([['toast.markAllFailed', 'error']]);
    expect(useFeedStore.getState().unreadCounts['feed/12']).toBe(40);
  });
});
