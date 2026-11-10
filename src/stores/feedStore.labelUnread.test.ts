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
  useUiStore.setState({ showLabelUnread: true, showLabelCounts: false, toasts: [] });
  useFeedStore.setState({
    filter: 'all', selectedFeed: null, articles: [], selectedArticle: null, searchQuery: '',
    subscriptions: [{ id: 'feed/1', title: 'F', categories: [] } as never],
    labels: [veille], unreadCounts: { 'feed/1': 2, [V]: 4 }, labelCounts: {},
  });
});

describe('relevé des non-lus des étiquettes', () => {
  it('prend la valeur que FreshRSS (≥ 1.26) met dans unread-count, sans requête de plus', async () => {
    vi.mocked(api.getUnreadCounts).mockResolvedValue([{ id: 'feed/1', count: 3 }, { id: V, count: 1 }, { id: TOTAL, count: 3 }] as never);
    await useFeedStore.getState().syncCounts();
    expect(useFeedStore.getState().unreadCounts[V]).toBe(1);
    expect(unreadCalls()).toEqual([]);
  });

  it('garde la valeur connue quand le serveur (< 1.26) ne rend pas les étiquettes', async () => {
    vi.mocked(api.getUnreadCounts).mockResolvedValue([{ id: 'feed/1', count: 3 }, { id: TOTAL, count: 3 }] as never);
    await useFeedStore.getState().syncCounts();
    expect(useFeedStore.getState().unreadCounts).toMatchObject({ 'feed/1': 3, [V]: 4 });
  });

  it('relève par identifiants, sans les lus, les étiquettes que le serveur n’a pas données', async () => {
    useFeedStore.setState({ unreadCounts: { 'feed/1': 2 } });
    vi.mocked(api.getTagList).mockResolvedValue([veille]);
    vi.mocked(api.getStreamItemCount).mockImplementation(async (_s, _cap, opts) => (opts?.excludeRead ? 7 : 0));
    await useFeedStore.getState().loadLabels();
    expect(unreadCalls().map((c) => [c[0], c[1]])).toEqual([[V, 1000]]);
    expect(useFeedStore.getState().unreadCounts[V]).toBe(7);
  });

  it('ne relève rien quand le serveur a déjà donné chaque étiquette', async () => {
    vi.mocked(api.getTagList).mockResolvedValue([veille]);
    await useFeedStore.getState().loadLabels();
    expect(unreadCalls()).toEqual([]);
  });

  it('ne relève rien quand le réglage est éteint', async () => {
    useUiStore.setState({ showLabelUnread: false });
    useFeedStore.setState({ unreadCounts: {} });
    vi.mocked(api.getTagList).mockResolvedValue([veille]);
    await useFeedStore.getState().loadLabels();
    await useFeedStore.getState().loadLabelUnread();
    expect(unreadCalls()).toEqual([]);
  });

  it('loadLabelUnread (réglage allumé) relève ce qui manque et garde le reste', async () => {
    useFeedStore.setState({ unreadCounts: { 'feed/1': 2 }, labels: [veille, { id: 'user/-/label/B', type: 'tag' } as Tag] });
    vi.mocked(api.getStreamItemCount).mockImplementation(async (s, _cap, opts) => (opts?.excludeRead ? (s === V ? 7 : 1) : 0));
    await useFeedStore.getState().loadLabelUnread();
    expect(useFeedStore.getState().unreadCounts).toEqual({ 'feed/1': 2, [V]: 7, 'user/-/label/B': 1 });
  });

  it('un relevé en échec garde la dernière valeur', async () => {
    useFeedStore.setState({ unreadCounts: { [V]: 4 } });
    vi.mocked(api.getStreamItemCount).mockRejectedValue(new Error('offline'));
    await useFeedStore.getState().loadLabelUnread();
    expect(useFeedStore.getState().unreadCounts[V]).toBe(4);
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
