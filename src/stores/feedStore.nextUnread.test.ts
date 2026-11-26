// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/feeds', async () => {
  const actual = await vi.importActual<typeof import('../api/feeds')>('../api/feeds');
  return {
    ...actual,
    markAllAsRead: vi.fn().mockResolvedValue(undefined),
    markAsUnread: vi.fn().mockResolvedValue(undefined),
    getUnreadItemIds: vi.fn().mockResolvedValue({ ids: ['a'], complete: true }),
    getUnreadCounts: vi.fn().mockResolvedValue([]),
  };
});
vi.mock('../i18n', () => ({ default: { t: (k: string) => k } }));

import { useFeedStore } from './feedStore';
import { useAuthStore } from './authStore';
import { useUiStore } from './uiStore';

/*
 * Issue #35 : vider un flux puis passer au suivant qui a des non-lus, dans
 * l'ordre de la barre latérale. `selectView` et `selectCategory` sont
 * remplacés : on vérifie OÙ le saut mène, pas le chargement de la vue.
 */
const cat = (name: string) => [{ id: `user/-/label/${name}`, label: name }];
const A = { id: 'feed/1', title: 'A', categories: cat('News') } as never;
const B = { id: 'feed/2', title: 'B', categories: cat('News') } as never;
const C = { id: 'feed/3', title: 'C', categories: cat('Tech') } as never;

describe('selectNextUnreadFeed (issue #35)', () => {
  const selectView = vi.fn();
  const selectCategory = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({ toasts: [], categoryOrder: [], feedOrder: {}, markAllJumpNext: false, collapsedCategories: {} });
    useAuthStore.setState({ activeServerId: '1', backendToken: 'x' });
    useFeedStore.setState({
      selectedFeed: A, filter: 'all', articles: [], subscriptions: [A, B, C], searchQuery: '',
      unreadCounts: { 'feed/1': 4, 'feed/2': 0, 'feed/3': 2 }, randomView: false,
      selectView, selectCategory,
    });
  });

  it('ouvre le flux suivant qui a des non-lus, en sautant les flux vides', () => {
    useFeedStore.getState().selectNextUnreadFeed();
    expect(selectView).toHaveBeenCalledWith(C);
  });

  it('déplie la catégorie repliée du flux ouvert, et seulement elle (M2)', () => {
    useUiStore.setState({ collapsedCategories: { 'user/-/label/Tech': true, 'user/-/label/Autre': true } });
    useFeedStore.getState().selectNextUnreadFeed();
    expect(selectView).toHaveBeenCalledWith(C);
    expect(useUiStore.getState().collapsedCategories).toEqual({ 'user/-/label/Tech': false, 'user/-/label/Autre': true });
  });

  it('ne touche pas au repli quand la catégorie du flux est déjà ouverte', () => {
    useUiStore.setState({ collapsedCategories: { 'user/-/label/News': true } });
    useFeedStore.getState().selectNextUnreadFeed();
    expect(useUiStore.getState().collapsedCategories).toEqual({ 'user/-/label/News': true });
  });

  it('d’une catégorie à l’autre, la cible reste repliée : son en-tête est visible', () => {
    useUiStore.setState({ collapsedCategories: { 'user/-/label/Tech': true } });
    useFeedStore.setState({ selectedFeed: { id: 'user/-/label/News', title: 'News' } as never });
    useFeedStore.getState().selectNextUnreadFeed();
    expect(selectCategory).toHaveBeenCalled();
    expect(useUiStore.getState().collapsedCategories).toEqual({ 'user/-/label/Tech': true });
  });

  it('plus rien de non lu : ouvre la vue Non lus', () => {
    useFeedStore.setState({ unreadCounts: { 'feed/1': 4 } });
    useFeedStore.getState().selectNextUnreadFeed();
    expect(selectView).toHaveBeenCalledWith(null, 'unread');
  });

  it('depuis une catégorie, ouvre la catégorie suivante qui a des non-lus', () => {
    useFeedStore.setState({ selectedFeed: { id: 'user/-/label/News', title: 'News' } as never });
    useFeedStore.getState().selectNextUnreadFeed();
    expect(selectCategory).toHaveBeenCalledWith({ id: 'user/-/label/Tech', label: 'Tech' });
  });

  it('après « Tout marquer comme lu », ne bouge pas depuis l’accueil', () => {
    useFeedStore.setState({ selectedFeed: null });
    useFeedStore.getState().selectNextUnreadFeed({ afterMarkAll: true });
    expect(selectView).not.toHaveBeenCalled();
  });

  it('« Tout marquer comme lu » saute au suivant quand l’option est active', async () => {
    useUiStore.setState({ markAllJumpNext: true });
    await useFeedStore.getState().markAllAsRead();
    expect(selectView).toHaveBeenCalledWith(C);
  });

  it('« Tout marquer comme lu » reste sur la vue quand l’option est éteinte (défaut)', async () => {
    await useFeedStore.getState().markAllAsRead();
    expect(selectView).not.toHaveBeenCalled();
  });
});
