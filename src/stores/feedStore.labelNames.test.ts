// @vitest-environment jsdom
//
// Étiquettes et catégories : un nom pris ne s'envoie pas, un renommage que
// FreshRSS a dit « OK » sans le faire se voit, et la vue affichée suit le
// renommage ou la suppression de ce qu'elle montre.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Article, Subscription, Tag } from '../types';

vi.mock('../api/feeds', () => ({
  getSubscriptionList: vi.fn(), getUnreadCounts: vi.fn(async () => []), getStreamContents: vi.fn(),
  getStarredItems: vi.fn(), markAsRead: vi.fn(), markAsUnread: vi.fn(), markAsStarred: vi.fn(),
  removeStarred: vi.fn(), markAllAsRead: vi.fn(), fetchStreamPage: vi.fn(), subscribeFeed: vi.fn(),
  editFeed: vi.fn(), unsubscribeFeed: vi.fn(), getTagList: vi.fn(), setArticleLabel: vi.fn(),
  renameTag: vi.fn(), deleteTag: vi.fn(), clearWriteToken: vi.fn(), getStreamItemCount: vi.fn(async () => 0),
}));
vi.mock('../lib/offlineStore', () => ({
  listsPatch: vi.fn(async () => {}), listGet: vi.fn(async () => undefined), listPut: vi.fn(async () => {}),
  listEvictOlderThan: vi.fn(async () => {}), subsGet: vi.fn(async () => undefined), subsPut: vi.fn(async () => {}),
  queueGet: vi.fn(async () => []), queuePut: vi.fn(async () => {}), clearOfflineViews: vi.fn(async () => {}),
  listsWithoutSource: vi.fn(async () => {}),
}));
vi.mock('../api/backend', () => ({ startActualize: vi.fn(), getActualizeStatus: vi.fn() }));
vi.mock('../i18n', () => ({ default: { t: (k: string) => k } }));

import { useFeedStore } from './feedStore';
import { useAuthStore } from './authStore';
import * as api from '../api/feeds';

const L = (n: string) => `user/-/label/${n}`;
const tag = (n: string, type = 'tag'): Tag => ({ id: L(n), type });
const feed = (id: string, cat?: string) =>
  ({ id, title: id, categories: cat ? [{ id: L(cat), label: cat }] : [] }) as unknown as Subscription;

const real = { loadArticles: useFeedStore.getState().loadArticles, loadSpecialCounts: useFeedStore.getState().loadSpecialCounts };
const loadArticles = vi.fn(async () => {});

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ backendToken: 'jwt', activeServerId: '1' });
  vi.mocked(api.renameTag).mockResolvedValue(undefined as never);
  vi.mocked(api.deleteTag).mockResolvedValue(undefined as never);
  vi.mocked(api.getUnreadCounts).mockResolvedValue([] as never);
  useFeedStore.setState({
    subscriptions: [feed('feed/1', 'Tech')],
    categoryIds: [L('Tech')],
    folderIds: [L('Tech'), L('Sans catégorie')],
    labels: [tag('Veille'), tag('Tuto')],
    articles: [{ id: 'a1', labels: [L('Veille')] } as Article],
    selectedArticle: null,
    selectedFeed: null,
    filter: 'all',
    searchQuery: '',
    loadArticles: loadArticles as never,
    loadSpecialCounts: vi.fn() as never,
  });
});
afterEach(() => { useFeedStore.setState({ ...real, selectedFeed: null }); });

describe('loadLabels — une catégorie n’est jamais une étiquette (L-13)', () => {
  it('une catégorie vide, annoncée « folder », n’est pas proposée comme étiquette et reste connue comme catégorie', async () => {
    vi.mocked(api.getTagList).mockResolvedValue([tag('Sans catégorie', 'folder'), tag('Tech', 'folder'), tag('Veille')] as never);
    await useFeedStore.getState().loadLabels();
    expect(useFeedStore.getState().labels.map((l) => l.id)).toEqual([L('Veille')]);
    expect(useFeedStore.getState().folderIds).toEqual([L('Sans catégorie'), L('Tech')]);
  });
});

describe('renameLabel — collisions et résultat réel (L-14)', () => {
  it('vers le nom d’une catégorie (même vide) : refusé sans rien envoyer', async () => {
    expect(await useFeedStore.getState().renameLabel(L('Veille'), 'sans catégorie')).toBe(false);
    expect(api.renameTag).not.toHaveBeenCalled();
  });

  it('vers le nom d’une autre étiquette : refusé sans rien envoyer', async () => {
    expect(await useFeedStore.getState().renameLabel(L('Veille'), 'TUTO')).toBe(false);
    expect(api.renameTag).not.toHaveBeenCalled();
  });

  it('« OK » de FreshRSS sans renommage : échec, et les articles gardent l’ancienne étiquette', async () => {
    vi.mocked(api.getTagList).mockResolvedValue([tag('Veille'), tag('Tuto')] as never);
    expect(await useFeedStore.getState().renameLabel(L('Veille'), 'Lecture')).toBe(false);
    expect(useFeedStore.getState().articles[0].labels).toEqual([L('Veille')]);
  });

  it('un vrai renommage réussit et suit les articles', async () => {
    vi.mocked(api.getTagList).mockResolvedValue([tag('Lecture'), tag('Tuto')] as never);
    expect(await useFeedStore.getState().renameLabel(L('Veille'), 'Lecture')).toBe(true);
    expect(useFeedStore.getState().articles[0].labels).toEqual([L('Lecture')]);
  });
});

describe('renameCategory — collisions et résultat réel (L-14)', () => {
  it('vers le nom d’une étiquette : refusé sans rien envoyer', async () => {
    expect(await useFeedStore.getState().renameCategory(L('Tech'), 'veille')).toBe(false);
    expect(api.renameTag).not.toHaveBeenCalled();
  });

  it('vers le nom d’une autre catégorie, même vide : refusé sans rien envoyer', async () => {
    expect(await useFeedStore.getState().renameCategory(L('Tech'), 'Sans catégorie')).toBe(false);
    expect(api.renameTag).not.toHaveBeenCalled();
  });

  it('« OK » de FreshRSS sans renommage : échec, pas « Catégorie renommée »', async () => {
    vi.mocked(api.getSubscriptionList).mockResolvedValue([feed('feed/1', 'Tech')] as never);
    vi.mocked(api.getTagList).mockResolvedValue([] as never);
    expect(await useFeedStore.getState().renameCategory(L('Tech'), 'Dev')).toBe(false);
  });

  it('un vrai renommage réussit', async () => {
    vi.mocked(api.getSubscriptionList).mockResolvedValue([feed('feed/1', 'Dev')] as never);
    vi.mocked(api.getTagList).mockResolvedValue([] as never);
    expect(await useFeedStore.getState().renameCategory(L('Tech'), 'Dev')).toBe(true);
  });
});

describe('moveFeedToCategory — pas de catégorie au nom d’une étiquette (L-14)', () => {
  it('refusé sans rien envoyer : l’étiquette homonyme aurait disparu de la liste', async () => {
    expect(await useFeedStore.getState().moveFeedToCategory('feed/1', 'veille')).toBe(false);
    expect(api.editFeed).not.toHaveBeenCalled();
  });
});

describe('la vue affichée suit le renommage et la suppression (L-16)', () => {
  it('renommer l’étiquette affichée : la vue passe sous le nouveau nom et se recharge', async () => {
    useFeedStore.setState({ selectedFeed: { id: L('Veille'), title: 'Veille' } as Subscription, filter: 'unread' });
    vi.mocked(api.getTagList).mockResolvedValue([tag('Lecture'), tag('Tuto')] as never);
    expect(await useFeedStore.getState().renameLabel(L('Veille'), 'Lecture')).toBe(true);
    expect(useFeedStore.getState().selectedFeed).toMatchObject({ id: L('Lecture'), title: 'Lecture' });
    expect(useFeedStore.getState().filter).toBe('unread');
    expect(loadArticles).toHaveBeenCalled();
  });

  it('supprimer l’étiquette affichée : retour à l’accueil, rechargé', async () => {
    useFeedStore.setState({ selectedFeed: { id: L('Veille'), title: 'Veille' } as Subscription });
    expect(await useFeedStore.getState().deleteLabel(L('Veille'))).toBe(true);
    expect(useFeedStore.getState().selectedFeed).toBeNull();
    expect(loadArticles).toHaveBeenCalled();
  });

  it('supprimer une AUTRE étiquette ne touche pas la vue', async () => {
    const shown = { id: L('Tuto'), title: 'Tuto' } as Subscription;
    useFeedStore.setState({ selectedFeed: shown });
    await useFeedStore.getState().deleteLabel(L('Veille'));
    expect(useFeedStore.getState().selectedFeed).toBe(shown);
    expect(loadArticles).not.toHaveBeenCalled();
  });

  it('renommer la catégorie affichée : la vue suit', async () => {
    useFeedStore.setState({ selectedFeed: { id: L('Tech'), title: 'Tech' } as Subscription });
    vi.mocked(api.getSubscriptionList).mockResolvedValue([feed('feed/1', 'Dev')] as never);
    vi.mocked(api.getTagList).mockResolvedValue([] as never);
    expect(await useFeedStore.getState().renameCategory(L('Tech'), 'Dev')).toBe(true);
    expect(useFeedStore.getState().selectedFeed).toMatchObject({ id: L('Dev'), title: 'Dev' });
    expect(loadArticles).toHaveBeenCalled();
  });

  it('supprimer la catégorie affichée : retour à l’accueil', async () => {
    useFeedStore.setState({ selectedFeed: { id: L('Tech'), title: 'Tech' } as Subscription });
    vi.mocked(api.getSubscriptionList).mockResolvedValue([feed('feed/1')] as never);
    vi.mocked(api.getTagList).mockResolvedValue([] as never);
    expect(await useFeedStore.getState().deleteCategory(L('Tech'))).toBe(true);
    expect(useFeedStore.getState().selectedFeed).toBeNull();
    expect(loadArticles).toHaveBeenCalled();
  });
});
