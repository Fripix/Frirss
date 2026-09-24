// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/feeds', async () => {
  const actual = await vi.importActual<typeof import('../api/feeds')>('../api/feeds');
  return {
    ...actual,
    markAllAsRead: vi.fn().mockResolvedValue(undefined),
    markAsRead: vi.fn().mockResolvedValue(undefined),
    itemIdsNewerThan: vi.fn().mockResolvedValue([]),
    getUnreadCounts: vi.fn().mockResolvedValue([]),
  };
});

import { markAllAsRead, markAsRead, itemIdsNewerThan } from '../api/feeds';
import { useFeedStore } from './feedStore';
import type { Article } from '../types';

const article = (id: string, publishedMs: number): Article => ({
  id, title: id, summary: '', content: '', author: '', url: `https://example.com/${id}`,
  source: 'Flux', sourceId: 'feed/1', published: publishedMs, read: false, starred: false,
  labels: [], tags: [],
});

const vieux = article('vieux', 1_000);
const pivot = article('pivot', 2_000);
const neuf = article('neuf', 3_000);

beforeEach(() => {
  vi.clearAllMocks();
  useFeedStore.setState({
    selectedFeed: { id: 'feed/1', title: 'Flux' },
    filter: 'all',
    articles: [neuf, pivot, vieux],
  } as never);
});

describe('markReadRelative — en dessous', () => {
  it('marque en un seul appel, borné juste avant l’article cliqué', async () => {
    await useFeedStore.getState().markReadRelative(pivot, 'below');

    expect(markAllAsRead).toHaveBeenCalledTimes(1);
    expect(markAllAsRead).toHaveBeenCalledWith('feed/1', '1999999');
    expect(itemIdsNewerThan).not.toHaveBeenCalled();
  });

  it('met à jour les lignes plus anciennes, et elles seules', async () => {
    await useFeedStore.getState().markReadRelative(pivot, 'below');

    expect(useFeedStore.getState().articles.map((a) => [a.id, a.read])).toEqual([
      ['neuf', false], ['pivot', false], ['vieux', true],
    ]);
  });
});

describe('markReadRelative — au-dessus', () => {
  it('relève les identifiants plus récents puis les marque par lots de 100', async () => {
    vi.mocked(itemIdsNewerThan).mockResolvedValue(Array.from({ length: 150 }, (_, i) => `id${i}`));

    await useFeedStore.getState().markReadRelative(pivot, 'above');

    expect(itemIdsNewerThan).toHaveBeenCalledWith('feed/1', 3);
    expect(markAsRead).toHaveBeenCalledTimes(2);
    expect((vi.mocked(markAsRead).mock.calls[0][0] as string[]).length).toBe(100);
    expect((vi.mocked(markAsRead).mock.calls[1][0] as string[]).length).toBe(50);
    expect(markAllAsRead).not.toHaveBeenCalled();
  });

  it('met à jour les lignes plus récentes, et elles seules', async () => {
    await useFeedStore.getState().markReadRelative(pivot, 'above');

    expect(useFeedStore.getState().articles.map((a) => [a.id, a.read])).toEqual([
      ['neuf', true], ['pivot', false], ['vieux', false],
    ]);
  });

  it('n’appelle rien quand il n’y a rien de plus récent', async () => {
    vi.mocked(itemIdsNewerThan).mockResolvedValue([]);

    await useFeedStore.getState().markReadRelative(neuf, 'above');

    expect(markAsRead).not.toHaveBeenCalled();
  });
});

describe('markReadRelative — la vue et les pannes', () => {
  it('suit la vue courante : sans flux sélectionné, c’est toute la liste de lecture', async () => {
    useFeedStore.setState({ selectedFeed: null } as never);

    await useFeedStore.getState().markReadRelative(pivot, 'below');

    expect(markAllAsRead).toHaveBeenCalledWith('user/-/state/com.google/reading-list', '1999999');
  });

  it('rend les lignes à leur état quand le serveur refuse', async () => {
    vi.mocked(markAllAsRead).mockRejectedValueOnce(new Error('refus'));

    await useFeedStore.getState().markReadRelative(pivot, 'below');

    expect(useFeedStore.getState().articles.map((a) => a.read)).toEqual([false, false, false]);
  });
});
