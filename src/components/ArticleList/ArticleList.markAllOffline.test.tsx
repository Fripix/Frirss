// @vitest-environment jsdom
//
// L-23 : « Tout lu » hors ligne. La boîte de confirmation s'ouvrait, et sa
// validation ne faisait rien, sans un mot. Hors ligne, le clic va droit au
// store, qui refuse et le dit (`toast.markAllOffline`) : aucune question
// pour une action qui ne peut pas avoir lieu.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import type { Article } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('../../i18n', () => ({ default: { t: (k: string) => k } }));
vi.mock('../../lib/offlineStore', () => ({
  listsPatch: vi.fn(async () => {}),
  listGet: vi.fn(async () => undefined), listPut: vi.fn(async () => {}), listEvictOlderThan: vi.fn(async () => {}),
  listsWithoutSource: vi.fn(async () => {}), subsGet: vi.fn(async () => undefined), subsPut: vi.fn(async () => {}),
  clearOfflineViews: vi.fn(async () => {}), queueGet: vi.fn(async () => []), queuePut: vi.fn(async () => {}),
}));
vi.mock('../../api/feeds', () => ({
  getSubscriptionList: vi.fn(), getUnreadCounts: vi.fn(async () => []),
  getStreamContents: vi.fn(async () => ({ items: [], continuation: null })),
  getStarredItems: vi.fn(async () => ({ items: [], continuation: null })),
  markAsRead: vi.fn(async () => {}), markAsUnread: vi.fn(async () => {}), markAsStarred: vi.fn(async () => {}), removeStarred: vi.fn(async () => {}),
  markAllAsRead: vi.fn(async () => {}), getUnreadItemIds: vi.fn(async () => ({ ids: [], complete: true })),
  fetchStreamPage: vi.fn(), subscribeFeed: vi.fn(), editFeed: vi.fn(), unsubscribeFeed: vi.fn(),
  getTagList: vi.fn(async () => []), getStreamItemCount: vi.fn(), setArticleLabel: vi.fn(async () => {}),
  renameTag: vi.fn(), deleteTag: vi.fn(), clearWriteToken: vi.fn(), itemIdsNewerThanEntry: vi.fn(async () => []),
}));
vi.mock('../../api/backend', () => ({ startActualize: vi.fn(), getActualizeStatus: vi.fn() }));

import ArticleList from './ArticleList';
import { useFeedStore } from '../../stores/feedStore';
import { useUiStore } from '../../stores/uiStore';

const rows = (n: number): Article[] => Array.from({ length: n }, (_, i) => ({
  id: `a${i}`, title: `Article ${i}`, summary: 'S', source: 'Src', sourceId: 'feed/1', content: '', author: '',
  url: `https://example.com/${i}`, published: 1_700_000_000_000 - i * 1000, read: false, starred: false, labels: [], tags: [],
}));

const markAllAsRead = vi.fn(async () => {});
const prepareMarkAllUndo = vi.fn();
const online = (on: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });

function show() {
  useFeedStore.setState({
    articles: rows(3), filter: 'all', selectedFeed: null, searchQuery: '', randomView: false,
    loading: false, revalidating: false, continuation: null, listFailed: false,
    markAllAsRead, prepareMarkAllUndo, loadArticles: vi.fn(async () => {}),
  } as never);
  return render(<ArticleList />);
}
const markAllBtn = (c: ReturnType<typeof render>) => c.getAllByRole('button', { name: 'articleList.markAllRead' })[0];

beforeEach(() => { vi.clearAllMocks(); online(true); useUiStore.setState({ confirmMarkAllRead: true } as never); });
afterEach(cleanup);

describe('« Tout lu » hors ligne', () => {
  it('ne pose pas la question : le store refuse et le dit', () => {
    online(false);
    const c = show();
    fireEvent.click(markAllBtn(c));
    expect(c.queryByRole('dialog')).toBeNull();
    expect(prepareMarkAllUndo).not.toHaveBeenCalled();
    expect(markAllAsRead).toHaveBeenCalledTimes(1);
  });

  it('en ligne, la confirmation demandée s’ouvre toujours', () => {
    const c = show();
    fireEvent.click(markAllBtn(c));
    expect(c.queryByRole('dialog')).not.toBeNull();
    expect(markAllAsRead).not.toHaveBeenCalled();
  });
});
