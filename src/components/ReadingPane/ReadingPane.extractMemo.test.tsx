// @vitest-environment jsdom
//
// Relecture du troisième round : la décision « l'extrait est-il montré ? »
// (`extractShown`) était refaite à chaque rendu du volet — 5,5 ms sur un
// article de 170 Ko, à chaque pas de la barre de progression de lecture.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import type { Article } from '../../types';

const shownSpy = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../../lib/readingBody', async (orig) => {
  const actual = await orig<typeof import('../../lib/readingBody')>();
  return {
    ...actual,
    extractShown: (...args: Parameters<typeof actual.extractShown>) => { shownSpy.calls++; return actual.extractShown(...args); },
  };
});
const extractMock = vi.hoisted(() => ({ fn: vi.fn() }));

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
  listsPatch: vi.fn(async () => {}),
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
vi.mock('../../utils/extractContent', async (orig) => ({
  ...(await orig<typeof import('../../utils/extractContent')>()),
  extractFullContent: (...args: unknown[]) => extractMock.fn(...args),
}));
vi.mock('../../i18n', () => ({ default: { t: (k: string) => k } }));

import ReadingPane from './ReadingPane';
import { useFeedStore } from '../../stores/feedStore';
import { useUiStore } from '../../stores/uiStore';

afterEach(cleanup);

describe('ReadingPane — décision de l’extrait mémorisée', () => {
  it('un rendu qui ne change ni l’article ni l’extrait ne refait pas la décision', async () => {
    localStorage.clear();
    useUiStore.setState({ feedSettings: {}, autoExtractDefault: true, inlineVideos: true } as never);
    extractMock.fn.mockResolvedValue({ title: '', content: `<p>${'texte complet de l’article '.repeat(40)}</p>`, excerpt: '', byline: '', siteName: '', length: 1000 });
    const article = {
      title: 'Titre', summary: 's', source: 'Src', sourceId: 'feed/1', published: Date.now(), read: false, starred: false, labels: [],
      id: 'm1', url: 'https://example.com/m1', content: `<p>${'texte complet de l’article '.repeat(10)}</p>`,
    } as unknown as Article;
    useFeedStore.setState({ selectedArticle: article, articles: [article] } as never);
    const view = render(<ReadingPane />);
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
    expect(view.container.querySelector('.reading-body-enter')?.textContent).toContain('texte complet');
    const before = shownSpy.calls;
    expect(before).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) view.rerender(<ReadingPane />);
    expect(shownSpy.calls).toBe(before);
  });
});
