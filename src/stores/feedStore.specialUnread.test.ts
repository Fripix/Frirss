// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/feeds', async () => {
  const actual = await vi.importActual<typeof import('../api/feeds')>('../api/feeds');
  return {
    ...actual,
    getStarredItems: vi.fn().mockResolvedValue({ items: [], continuation: null }),
    getStreamContents: vi.fn().mockResolvedValue({ items: [], continuation: null }),
    getStreamItemCount: vi.fn().mockResolvedValue(0),
    markAsRead: vi.fn().mockResolvedValue(undefined),
    markAsUnread: vi.fn().mockResolvedValue(undefined),
    markAsStarred: vi.fn().mockResolvedValue(undefined),
    removeStarred: vi.fn().mockResolvedValue(undefined),
    setArticleLabel: vi.fn().mockResolvedValue(undefined),
    markAllAsRead: vi.fn().mockResolvedValue(undefined),
    getUnreadItemIds: vi.fn().mockResolvedValue({ ids: [], complete: true }),
    getUnreadCounts: vi.fn().mockResolvedValue([]),
  };
});
vi.mock('../i18n', () => ({ default: { t: (k: string) => k } }));

import * as api from '../api/feeds';
import { useFeedStore } from './feedStore';
import { useAuthStore } from './authStore';
import { useUiStore } from './uiStore';
import { READ_LATER_LABEL } from '../lib/viewLists';
import type { Article } from '../types';

const STARRED = 'user/-/state/com.google/starred';
const refused = () => Object.assign(new Error('refused'), { response: { status: 403 } });
const unreadCalls = () => vi.mocked(api.getStreamItemCount).mock.calls.filter((c) => c[2]?.excludeRead);

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ activeServerId: '1', backendToken: 'x' });
  useUiStore.setState({ showSpecialUnread: true, toasts: [] });
  useFeedStore.setState({
    filter: 'all', selectedFeed: null, articles: [], selectedArticle: null, searchQuery: '',
    unreadCounts: {}, specialUnread: { starred: 5, readLater: 4 },
  });
});

describe('loadSpecialCounts — non-lus des Favoris et d’À lire plus tard', () => {
  it('relève les non-lus des deux listes par identifiants, sans les lus', async () => {
    vi.mocked(api.getStreamItemCount).mockImplementation(async (s, _cap, opts) =>
      (opts?.excludeRead ? (s === STARRED ? 7 : 2) : 0));
    await useFeedStore.getState().loadSpecialCounts();
    expect(unreadCalls().map((c) => c[0]).sort()).toEqual([READ_LATER_LABEL, STARRED].sort());
    expect(useFeedStore.getState().specialUnread).toEqual({ starred: 7, readLater: 2 });
  });

  it('ne fait aucune requête de non-lus quand le réglage est désactivé', async () => {
    useUiStore.setState({ showSpecialUnread: false });
    await useFeedStore.getState().loadSpecialCounts();
    expect(unreadCalls()).toEqual([]);
  });

  it('garde la dernière valeur connue quand le relevé échoue (hors ligne)', async () => {
    vi.mocked(api.getStreamItemCount).mockRejectedValue(new Error('offline'));
    await useFeedStore.getState().loadSpecialCounts();
    expect(useFeedStore.getState().specialUnread).toEqual({ starred: 5, readLater: 4 });
  });

  it('écarte un relevé pendant lequel un geste local a changé un compteur', async () => {
    let release!: (n: number) => void;
    const pending = new Promise<number>((r) => { release = r; });
    vi.mocked(api.getStreamItemCount).mockImplementation((_s, _cap, opts) =>
      (opts?.excludeRead ? pending : Promise.resolve(0)));
    const p = useFeedStore.getState().loadSpecialCounts();
    // Un favori non lu marqué lu pendant le vol : 5 → 4 en local.
    await useFeedStore.getState().toggleRead({ id: 'a', read: false, starred: true, labels: [], sourceId: 'feed/1' } as unknown as Article);
    release(9);
    await p;
    expect(useFeedStore.getState().specialUnread.starred).toBe(4);
  });

  it('écarte la réponse d’un serveur quitté pendant le relevé', async () => {
    let release!: (n: number) => void;
    const pending = new Promise<number>((r) => { release = r; });
    vi.mocked(api.getStreamItemCount).mockImplementation((_s, _cap, opts) =>
      (opts?.excludeRead ? pending : Promise.resolve(0)));
    const p = useFeedStore.getState().loadSpecialCounts();
    useAuthStore.setState({ activeServerId: '2' });
    release(9);
    await p;
    expect(useFeedStore.getState().specialUnread).toEqual({ starred: 5, readLater: 4 });
  });
});

describe('gestes sur un article — le compteur suit tout de suite', () => {
  const art = (over: Partial<Article>): Article =>
    ({ id: 'a', read: false, starred: false, labels: [], sourceId: 'feed/1', ...over } as unknown as Article);

  it('✓ sur un favori non lu le décompte, et le rend si le serveur refuse', async () => {
    await useFeedStore.getState().toggleRead(art({ starred: true }));
    expect(useFeedStore.getState().specialUnread.starred).toBe(4);
    vi.mocked(api.markAsRead).mockRejectedValueOnce(refused());
    useFeedStore.setState({ specialUnread: { starred: 5, readLater: 4 } });
    await useFeedStore.getState().toggleRead(art({ starred: true }));
    expect(useFeedStore.getState().specialUnread.starred).toBe(5);
  });

  it('remettre non lu un article à lire plus tard le recompte', async () => {
    await useFeedStore.getState().toggleRead(art({ read: true, labels: [READ_LATER_LABEL] }));
    expect(useFeedStore.getState().specialUnread).toEqual({ starred: 5, readLater: 5 });
  });

  it('ouvrir un article à lire plus tard non lu le décompte, et le rend sur refus', async () => {
    useFeedStore.getState().selectArticle(art({ labels: [READ_LATER_LABEL] }));
    expect(useFeedStore.getState().specialUnread.readLater).toBe(3);
    vi.mocked(api.markAsRead).mockRejectedValueOnce(refused());
    useFeedStore.getState().selectArticle(art({ id: 'b', labels: [READ_LATER_LABEL] }));
    await vi.waitFor(() => expect(useFeedStore.getState().specialUnread.readLater).toBe(3));
  });

  it('étoiler un article non lu le compte, le désétoiler le décompte, un refus annule', async () => {
    await useFeedStore.getState().toggleStar(art({}));
    expect(useFeedStore.getState().specialUnread.starred).toBe(6);
    await useFeedStore.getState().toggleStar(art({ starred: true }));
    expect(useFeedStore.getState().specialUnread.starred).toBe(5);
    vi.mocked(api.markAsStarred).mockRejectedValueOnce(refused());
    await useFeedStore.getState().toggleStar(art({}));
    expect(useFeedStore.getState().specialUnread.starred).toBe(5);
  });

  it('étoiler un article déjà lu ne change rien', async () => {
    await useFeedStore.getState().toggleStar(art({ read: true }));
    expect(useFeedStore.getState().specialUnread.starred).toBe(5);
  });

  it('ranger ou retirer un non-lu d’À lire plus tard suit, un refus annule', async () => {
    await useFeedStore.getState().toggleReadLater(art({}));
    expect(useFeedStore.getState().specialUnread.readLater).toBe(5);
    await useFeedStore.getState().toggleReadLater(art({ labels: [READ_LATER_LABEL] }));
    expect(useFeedStore.getState().specialUnread.readLater).toBe(4);
    vi.mocked(api.setArticleLabel).mockRejectedValueOnce(refused());
    await useFeedStore.getState().toggleReadLater(art({}));
    expect(useFeedStore.getState().specialUnread.readLater).toBe(4);
  });
});

describe('marquages en masse — le relevé reprend une fois le serveur d’accord', () => {
  it('« tout lu » relance le relevé des non-lus', async () => {
    const feed = { id: 'feed/1', title: 'F' } as never;
    useFeedStore.setState({ selectedFeed: feed, subscriptions: [feed], unreadCounts: { 'feed/1': 3 } });
    vi.mocked(api.getStreamItemCount).mockImplementation(async (_s, _cap, opts) => (opts?.excludeRead ? 1 : 0));
    await useFeedStore.getState().markAllAsRead();
    await vi.waitFor(() => expect(useFeedStore.getState().specialUnread).toEqual({ starred: 1, readLater: 1 }));
  });
});

describe('loadSpecialCounts — le total et les non-lus forment une paire cohérente (R-6)', () => {
  const totalCalls = () => vi.mocked(api.getStreamItemCount).mock.calls.filter((c) => !c[2]?.excludeRead);

  it('le total se relève par identifiants, au même plafond (9999) que les non-lus', async () => {
    // Le total comptait une page de 200 articles complets : au-delà de 200
    // favoris, « 300 non lus · 200 » se lisait comme une paire.
    vi.mocked(api.getStreamItemCount).mockImplementation(async (s, _cap, opts) =>
      (opts?.excludeRead ? (s === STARRED ? 300 : 2) : (s === STARRED ? 350 : 12)));
    await useFeedStore.getState().loadSpecialCounts();
    expect(useFeedStore.getState().starredCount).toBe(350);
    expect(useFeedStore.getState().readLaterCount).toBe(12);
    expect(totalCalls().map((c) => [c[0], c[1]]).sort()).toEqual([[READ_LATER_LABEL, 9999], [STARRED, 9999]].sort());
    expect(api.getStarredItems).not.toHaveBeenCalled();
  });

  it('un total en échec garde la dernière valeur au lieu de tomber à 0', async () => {
    useFeedStore.setState({ starredCount: 42, readLaterCount: 3 });
    vi.mocked(api.getStreamItemCount).mockImplementation(async (_s, _cap, opts) => {
      if (opts?.excludeRead) return 1;
      throw new Error('offline');
    });
    await useFeedStore.getState().loadSpecialCounts();
    expect(useFeedStore.getState().starredCount).toBe(42);
    expect(useFeedStore.getState().readLaterCount).toBe(3);
  });
});
