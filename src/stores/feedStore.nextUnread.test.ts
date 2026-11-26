// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/feeds', async () => {
  const actual = await vi.importActual<typeof import('../api/feeds')>('../api/feeds');
  return {
    ...actual,
    markAllAsRead: vi.fn().mockResolvedValue(undefined),
    markAsRead: vi.fn().mockResolvedValue(undefined),
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
    useUiStore.setState({ toasts: [], categoryOrder: [], feedOrder: {}, markAllJumpNext: false, collapsedCategories: {}, readingFocus: false });
    useAuthStore.setState({ activeServerId: '1', backendToken: 'x' });
    useFeedStore.setState({
      selectedFeed: A, filter: 'all', articles: [], subscriptions: [A, B, C], searchQuery: '',
      unreadCounts: { 'feed/1': 4, 'feed/2': 0, 'feed/3': 2 }, randomView: false,
      selectedArticle: null, loading: false, revalidating: false, listFailed: false,
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

  describe('« Tout lu » sur une catégorie remet ses flux à zéro (M1)', () => {
    // Seule la clé de la catégorie passait à zéro : ses flux gardaient leur
    // compteur jusqu'au relevé suivant (~60 s), et le saut repartait vers
    // une catégorie déjà lue (campagne 1.10.1, M1).
    const NEWS = { id: 'user/-/label/News', title: 'News' } as never;

    it('les flux de la catégorie passent à zéro, pas ceux des autres', async () => {
      useFeedStore.setState({ selectedFeed: NEWS, unreadCounts: { 'feed/1': 4, 'feed/2': 1, 'feed/3': 2, 'user/-/label/News': 5 } });
      await useFeedStore.getState().markAllAsRead();
      expect(useFeedStore.getState().unreadCounts).toMatchObject({ 'feed/1': 0, 'feed/2': 0, 'feed/3': 2, 'user/-/label/News': 0 });
    });

    it('vider Tech puis Monde dans la minute mène à Non lus, pas à Tech', async () => {
      useUiStore.setState({ markAllJumpNext: true });
      useFeedStore.setState({ selectedFeed: { id: 'user/-/label/Tech', title: 'Tech' } as never, unreadCounts: { 'feed/1': 4, 'feed/3': 2 } });
      await useFeedStore.getState().markAllAsRead();
      expect(selectCategory).toHaveBeenLastCalledWith({ id: 'user/-/label/News', label: 'News' });
      useFeedStore.setState({ selectedFeed: NEWS });
      await useFeedStore.getState().markAllAsRead();
      expect(selectView).toHaveBeenLastCalledWith(null, 'unread');
    });

    it('un flux montré dans sa seule vue (priorité « feed ») garde son compteur', async () => {
      const own = { id: 'feed/7', title: 'Seul', categories: cat('News'), priority: 'feed' } as never;
      useFeedStore.setState({ subscriptions: [A, B, C, own], selectedFeed: NEWS, unreadCounts: { 'feed/1': 4, 'feed/7': 3 } });
      await useFeedStore.getState().markAllAsRead();
      expect(useFeedStore.getState().unreadCounts).toMatchObject({ 'feed/1': 0, 'feed/7': 3 });
    });

    it('une étiquette ne remet aucun flux à zéro', async () => {
      useFeedStore.setState({ selectedFeed: { id: 'user/-/label/Rouge', title: 'Rouge' } as never, unreadCounts: { 'feed/1': 4 } });
      await useFeedStore.getState().markAllAsRead();
      expect(useFeedStore.getState().unreadCounts['feed/1']).toBe(4);
    });

    it('un flux garde le comportement d’avant : seule sa clé passe à zéro', async () => {
      useFeedStore.setState({ unreadCounts: { 'feed/1': 4, 'feed/2': 1 } });
      await useFeedStore.getState().markAllAsRead();
      expect(useFeedStore.getState().unreadCounts).toMatchObject({ 'feed/1': 0, 'feed/2': 1 });
    });
  });

  describe('en mode Focus, le saut ouvre le premier article non lu (M3)', () => {
    // En Focus, ni liste ni barre latérale : `n` vidait l'article ouvert et
    // laissait « Sélectionnez un article » (campagne 1.10.1, M3).
    const art = (id: string, read: boolean) => ({ id, title: id, read, sourceId: 'feed/3', labels: [] }) as never;
    const loading = (feed: unknown) => useFeedStore.setState({ selectedFeed: feed as never, articles: [], selectedArticle: null, loading: true, revalidating: true, listFailed: false });
    const loaded = (articles: unknown[]) => useFeedStore.setState({ articles: articles as never, loading: false, revalidating: false });

    beforeEach(() => {
      selectView.mockImplementation((feed: unknown) => loading(feed));
      selectCategory.mockImplementation((c: { id: string; label: string }) => loading({ id: c.id, title: c.label }));
      useUiStore.setState({ readingFocus: true });
    });

    it('la liste arrivée, le premier non lu s’ouvre, et le Focus reste', () => {
      useFeedStore.getState().selectNextUnreadFeed();
      expect(useFeedStore.getState().selectedArticle).toBeNull();
      loaded([art('c1', true), art('c2', false), art('c3', false)]);
      expect(useFeedStore.getState().selectedArticle?.id).toBe('c2');
      expect(useUiStore.getState().readingFocus).toBe(true);
    });

    it('liste en mémoire : on attend la liste à jour, qui peut avoir changé', () => {
      selectView.mockImplementation((feed: unknown) => useFeedStore.setState({ selectedFeed: feed as never, articles: [art('c9', false)], selectedArticle: null, loading: false, revalidating: true }));
      useFeedStore.getState().selectNextUnreadFeed();
      expect(useFeedStore.getState().selectedArticle).toBeNull();
      loaded([art('c10', false), art('c9', true)]);
      expect(useFeedStore.getState().selectedArticle?.id).toBe('c10');
    });

    it('hors Focus, rien ne s’ouvre : la liste suffit', () => {
      useUiStore.setState({ readingFocus: false });
      useFeedStore.getState().selectNextUnreadFeed();
      loaded([art('c2', false)]);
      expect(useFeedStore.getState().selectedArticle).toBeNull();
    });

    it('une autre vue choisie avant l’arrivée de la liste : rien ne s’ouvre', () => {
      useFeedStore.getState().selectNextUnreadFeed();
      useFeedStore.setState({ selectedFeed: A });
      loaded([art('c2', false)]);
      expect(useFeedStore.getState().selectedArticle).toBeNull();
    });

    it('la vue arrive vide : on sort du Focus plutôt qu’un écran blanc', () => {
      useFeedStore.getState().selectNextUnreadFeed();
      loaded([]);
      expect(useUiStore.getState().readingFocus).toBe(false);
    });

    it('plus rien de non lu nulle part : on sort du Focus, sur la vue Non lus', () => {
      useFeedStore.setState({ unreadCounts: { 'feed/1': 4 } });
      useFeedStore.getState().selectNextUnreadFeed();
      expect(selectView).toHaveBeenCalledWith(null, 'unread');
      loaded([]);
      expect(useUiStore.getState().readingFocus).toBe(false);
    });

    it('liste en échec : on sort du Focus, le message d’erreur de la liste se voit', () => {
      useFeedStore.getState().selectNextUnreadFeed();
      useFeedStore.setState({ loading: false, revalidating: false, listFailed: true });
      expect(useUiStore.getState().readingFocus).toBe(false);
    });

    it('rien que des articles lus dans la page : le premier s’ouvre', () => {
      useFeedStore.getState().selectNextUnreadFeed();
      loaded([art('c1', true)]);
      expect(useFeedStore.getState().selectedArticle?.id).toBe('c1');
    });
  });
});
