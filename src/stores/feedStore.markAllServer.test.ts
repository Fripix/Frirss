// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/feeds', async () => {
  const actual = await vi.importActual<typeof import('../api/feeds')>('../api/feeds');
  return {
    ...actual,
    markAllAsRead: vi.fn().mockResolvedValue(undefined),
    markAsUnread: vi.fn().mockResolvedValue(undefined),
    getUnreadItemIds: vi.fn(),
    getUnreadCounts: vi.fn().mockResolvedValue([]),
  };
});
vi.mock('../i18n', () => ({ default: { t: (k: string) => k } }));

import { markAllAsRead as apiMarkAllAsRead, getUnreadItemIds } from '../api/feeds';
import { useFeedStore } from './feedStore';
import { useAuthStore } from '../stores/authStore';
import { useUiStore } from './uiStore';

/*
 * « Tout lu » n'avait pas la garde serveur/session que le cycle a donnée aux
 * marquages de plage. Les identifiants de flux se recouvrent d'un FreshRSS à
 * l'autre : basculer sur le serveur B pendant le relevé des non-lus envoyait
 * `mark-all-as-read feed/12` à B, où `feed/12` est un autre flux, puis
 * mettait son compteur à zéro dans la vue de B.
 */
describe('markAllAsRead — changement de serveur pendant le relevé', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({ toasts: [] });
    useAuthStore.setState({ activeServerId: '1', backendToken: 'x' });
    const feed = { id: 'feed/12', title: 'F' } as never;
    useFeedStore.setState({ selectedFeed: feed, filter: 'all', articles: [], subscriptions: [feed], searchQuery: '', unreadCounts: { 'feed/12': 40 } });
  });

  it('n’envoie rien au serveur devenu actif, n’écrit rien, ne propose rien', async () => {
    let release!: (v: unknown) => void;
    vi.mocked(getUnreadItemIds).mockReturnValue(new Promise((r) => { release = r; }) as never);
    const p = useFeedStore.getState().markAllAsRead();
    useAuthStore.setState({ activeServerId: '2' });
    useFeedStore.setState({ unreadCounts: { 'feed/12': 7 } });
    release({ ids: ['a'], complete: true });
    await p;
    expect(apiMarkAllAsRead).not.toHaveBeenCalled();
    expect(useFeedStore.getState().unreadCounts['feed/12']).toBe(7);
    expect(useUiStore.getState().toasts).toEqual([]);
  });

  it('marque normalement quand rien n’a changé', async () => {
    vi.mocked(getUnreadItemIds).mockResolvedValue({ ids: ['a'], complete: true } as never);
    await useFeedStore.getState().markAllAsRead();
    expect(apiMarkAllAsRead).toHaveBeenCalledWith('feed/12');
  });
});

/*
 * Même fenêtre, autre changement : l'utilisateur ouvre un AUTRE flux du même
 * serveur pendant le relevé. Le marquage du flux demandé reste juste, mais la
 * suite écrivait dans la vue devenue active : liste vidée, article ouvert
 * affiché lu sans l'être sur le serveur, recherche refermée.
 */
describe('markAllAsRead — changement de vue pendant le relevé', () => {
  const A = { id: 'feed/1', title: 'A' } as never;
  const B = { id: 'feed/2', title: 'B' } as never;
  const bArt = { id: 'b1', title: 'b', read: false, labels: [], published: 1, sourceId: 'feed/2' } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({ toasts: [] });
    useAuthStore.setState({ activeServerId: '1', backendToken: 'x' });
    useFeedStore.setState({ selectedFeed: A, filter: 'unread', articles: [], subscriptions: [A, B], searchQuery: '', unreadCounts: { 'feed/1': 40, 'feed/2': 5 } });
  });

  it('marque le flux demandé sans toucher à la vue devenue active', async () => {
    let release!: (v: unknown) => void;
    vi.mocked(getUnreadItemIds).mockReturnValue(new Promise((r) => { release = r; }) as never);
    const p = useFeedStore.getState().markAllAsRead();
    useFeedStore.setState({ selectedFeed: B, articles: [bArt], selectedArticle: bArt });
    release({ ids: ['a'], complete: true });
    await p;
    const s = useFeedStore.getState();
    expect(apiMarkAllAsRead).toHaveBeenCalledWith('feed/1');
    expect(s.articles).toHaveLength(1);
    expect(s.selectedArticle?.read).toBe(false);
    expect(s.unreadCounts['feed/1']).toBe(0);
    expect(s.unreadCounts['feed/2']).toBe(5);
  });
});
