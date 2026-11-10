// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/feeds', async () => {
  const actual = await vi.importActual<typeof import('../api/feeds')>('../api/feeds');
  return {
    ...actual,
    getStarredItems: vi.fn().mockResolvedValue({ items: [], continuation: null }),
    getStreamContents: vi.fn().mockResolvedValue({ items: [], continuation: null }),
    getStreamItemCount: vi.fn().mockResolvedValue(0),
    getTagList: vi.fn().mockResolvedValue([]),
    markAsRead: vi.fn().mockResolvedValue(undefined),
    markAsUnread: vi.fn().mockResolvedValue(undefined),
    setArticleLabel: vi.fn().mockResolvedValue(undefined),
    getUnreadCounts: vi.fn().mockResolvedValue([]),
  };
});
vi.mock('../i18n', () => ({ default: { t: (k: string) => k } }));

import * as api from '../api/feeds';
import { useFeedStore } from './feedStore';
import { useAuthStore } from './authStore';
import { useUiStore } from './uiStore';
import type { Article, Tag } from '../types';

const V = 'user/-/label/Veille';
const TOTAL = 'user/-/state/com.google/reading-list';
const veille = { id: V, type: 'tag' } as Tag;
const refused = () => Object.assign(new Error('refused'), { response: { status: 403 } });
const unreadCalls = () => vi.mocked(api.getStreamItemCount).mock.calls.filter((c) => c[2]?.excludeRead);
const art = (over: Partial<Article>): Article =>
  ({ id: 'a', read: false, starred: false, labels: [], sourceId: 'feed/1', ...over } as unknown as Article);

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ activeServerId: '1', backendToken: 'x' });
  useUiStore.setState({ showLabelUnread: true, showLabelCounts: false, showSpecialTotals: true, toasts: [] });
  useFeedStore.setState({
    filter: 'all', selectedFeed: null, articles: [], selectedArticle: null, searchQuery: '',
    subscriptions: [{ id: 'feed/1', title: 'F', categories: [] } as never],
    labels: [veille], unreadCounts: { 'feed/1': 2, [V]: 4 }, labelCounts: {}, labelUnreadServer: true,
  });
});

describe('les non-lus des étiquettes viennent de unread-count (FreshRSS ≥ 1.26)', () => {
  it('prend la valeur que le serveur met dans unread-count, sans requête de plus, et note le support', async () => {
    vi.mocked(api.getUnreadCounts).mockResolvedValue([{ id: 'feed/1', count: 3 }, { id: V, count: 1 }, { id: TOTAL, count: 3 }] as never);
    await useFeedStore.getState().syncCounts();
    expect(useFeedStore.getState().unreadCounts[V]).toBe(1);
    expect(useFeedStore.getState().labelUnreadServer).toBe(true);
    expect(unreadCalls()).toEqual([]);
  });

  it('un serveur (< 1.26) qui ne rend pas les étiquettes est noté non pris en charge, sans relevé de repli', async () => {
    vi.mocked(api.getUnreadCounts).mockResolvedValue([{ id: 'feed/1', count: 3 }, { id: TOTAL, count: 3 }] as never);
    await useFeedStore.getState().syncCounts();
    expect(useFeedStore.getState().labelUnreadServer).toBe(false);
    expect(unreadCalls()).toEqual([]);
  });

  it('sans étiquette connue, le support reste inconnu, puis se décide quand les étiquettes arrivent', async () => {
    useFeedStore.setState({ labels: [], labelUnreadServer: null });
    vi.mocked(api.getUnreadCounts).mockResolvedValue([{ id: 'feed/1', count: 3 }, { id: V, count: 1 }] as never);
    await useFeedStore.getState().syncCounts();
    expect(useFeedStore.getState().labelUnreadServer).toBeNull();
    vi.mocked(api.getTagList).mockResolvedValue([veille]);
    await useFeedStore.getState().loadLabels();
    expect(useFeedStore.getState().labelUnreadServer).toBe(true);
  });

  it('une clé créée par un geste local ne fait pas passer un serveur < 1.26 pour pris en charge', async () => {
    vi.mocked(api.getUnreadCounts).mockResolvedValue([{ id: 'feed/1', count: 3 }, { id: TOTAL, count: 3 }] as never);
    await useFeedStore.getState().syncCounts();
    await useFeedStore.getState().toggleRead(art({ labels: [V] }));
    vi.mocked(api.getTagList).mockResolvedValue([veille]);
    await useFeedStore.getState().loadLabels();
    expect(useFeedStore.getState().labelUnreadServer).toBe(false);
  });
});

describe('gestes sur un article étiqueté — le compteur suit tout de suite', () => {
  it('✓ décompte chaque étiquette de l’article, et rend sur refus', async () => {
    await useFeedStore.getState().toggleRead(art({ labels: [V] }));
    expect(useFeedStore.getState().unreadCounts).toMatchObject({ 'feed/1': 1, [V]: 3 });
    vi.mocked(api.markAsRead).mockRejectedValueOnce(refused());
    await useFeedStore.getState().toggleRead(art({ id: 'b', labels: [V] }));
    expect(useFeedStore.getState().unreadCounts).toMatchObject({ 'feed/1': 1, [V]: 3 });
  });

  it('remettre non lu recompte l’étiquette', async () => {
    await useFeedStore.getState().toggleRead(art({ read: true, labels: [V] }));
    expect(useFeedStore.getState().unreadCounts[V]).toBe(5);
  });

  it('poser l’étiquette sur un non-lu compte, la retirer décompte, un refus annule', async () => {
    await useFeedStore.getState().toggleArticleLabel(art({}), V);
    expect(useFeedStore.getState().unreadCounts[V]).toBe(5);
    await useFeedStore.getState().toggleArticleLabel(art({ labels: [V] }), V);
    expect(useFeedStore.getState().unreadCounts[V]).toBe(4);
    vi.mocked(api.setArticleLabel).mockRejectedValueOnce(refused());
    await useFeedStore.getState().toggleArticleLabel(art({}), V);
    expect(useFeedStore.getState().unreadCounts[V]).toBe(4);
  });

  it('étiqueter un article déjà lu ne change rien', async () => {
    await useFeedStore.getState().toggleArticleLabel(art({ read: true }), V);
    expect(useFeedStore.getState().unreadCounts[V]).toBe(4);
  });
});

describe('plafond des relevés par identifiants', () => {
  it('vaut 9999 pour tous les comptes (totaux et non-lus des étiquettes, Favoris, À lire plus tard)', () => {
    // 1000 jusqu'en 1.9.0 : une étiquette de plus de mille articles affichait 1000.
    expect(api.COUNT_CAP).toBe(9999);
  });
});
