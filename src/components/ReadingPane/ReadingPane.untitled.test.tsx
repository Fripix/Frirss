// @vitest-environment jsdom
//
// Un article sans titre garde `title: ''` dans le store : le volet pose le
// libellé traduit au rendu, et c'est ce libellé qui part au partage.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import type { Article } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'fr' } }),
}));
vi.mock('../../api/feeds', () => ({
  getSubscriptionList: vi.fn(), getUnreadCounts: vi.fn(), getStreamContents: vi.fn(),
  getStarredItems: vi.fn(), markAsRead: vi.fn(() => Promise.resolve()),
  markAsUnread: vi.fn(() => Promise.resolve()), markAsStarred: vi.fn(() => Promise.resolve()),
  removeStarred: vi.fn(() => Promise.resolve()), markAllAsRead: vi.fn(() => Promise.resolve()),
  fetchStreamPage: vi.fn(), subscribeFeed: vi.fn(), editFeed: vi.fn(), unsubscribeFeed: vi.fn(),
  getTagList: vi.fn(), getStreamItemCount: vi.fn(), setArticleLabel: vi.fn(),
  renameTag: vi.fn(), deleteTag: vi.fn(), clearWriteToken: vi.fn(),
}));
vi.mock('../../api/backend', () => ({ startActualize: vi.fn(), getActualizeStatus: vi.fn(), getAiConfig: vi.fn(), requestAiSummary: vi.fn() }));
vi.mock('../../lib/offlineStore', () => ({
  listGet: vi.fn(() => Promise.resolve(undefined)), listPut: vi.fn(() => Promise.resolve()),
  listEvictOlderThan: vi.fn(() => Promise.resolve()), subsGet: vi.fn(() => Promise.resolve(undefined)),
  subsPut: vi.fn(() => Promise.resolve()), queueGet: vi.fn(() => Promise.resolve([])),
  queuePut: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../lib/extractStore', () => ({
  dbGet: vi.fn(() => Promise.resolve(undefined)), dbPut: vi.fn(() => Promise.resolve()),
  dbRecent: vi.fn(() => Promise.resolve([])), dbEvictOlderThan: vi.fn(() => Promise.resolve()),
  dbSetPinned: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../i18n', () => ({ default: { t: (k: string) => k } }));
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => 'desktop', useRawBreakpoint: () => 'desktop' }));

import ReadingPane from './ReadingPane';
import { useFeedStore } from '../../stores/feedStore';

const untitled = {
  id: 'u1', title: '', summary: 's', source: 'Src', sourceId: 'feed/1',
  content: '<p>rss</p>', url: 'https://example.com/1', published: Date.now(), read: true, starred: false, labels: [],
} as unknown as Article;

afterEach(() => {
  cleanup();
  delete (navigator as { share?: unknown }).share;
});

describe('ReadingPane — article sans titre', () => {
  it('le titre du volet et le partage portent le libellé traduit', async () => {
    const share = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    useFeedStore.setState({ selectedArticle: untitled, articles: [untitled] } as never);
    const { container, getAllByLabelText } = render(<ReadingPane />);
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('h1')?.textContent).toBe('articleList.untitled');
    await act(async () => { fireEvent.click(getAllByLabelText('readingPane.share')[0]); });
    expect(share).toHaveBeenCalledWith({ title: 'articleList.untitled', url: 'https://example.com/1' });
  });
});
