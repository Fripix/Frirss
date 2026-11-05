// @vitest-environment jsdom
//
// Volet de lecture : ce qu'il montre autour de l'extraction de l'article
// complet et des vidéos YouTube (campagne 1.9.0, L-03, L-06, L-08).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import type { Article } from '../../types';

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

const BODY_SELECTOR = '.reading-body-enter';

const base = {
  title: 'Titre', summary: 's', source: 'Src', sourceId: 'feed/1',
  published: Date.now(), read: false, starred: false, labels: [],
};

async function open(article: Article) {
  useFeedStore.setState({ selectedArticle: article, articles: [article] } as never);
  const view = render(<ReadingPane />);
  await act(async () => { await Promise.resolve(); });
  return view;
}

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  extractMock.fn.mockReset();
  useUiStore.setState({ feedSettings: {}, autoExtractDefault: false, inlineVideos: true } as never);
});

describe('ReadingPane — article de flux YouTube', () => {
  // L-08 : la vignette FreshRSS (`img.enclosure-thumbnail`) et la façade
  // d'en-tête montraient la même image l'une sous l'autre.
  it('ne montre la vignette de la vidéo qu’une fois, dans la façade d’en-tête', async () => {
    const ID = 'dQw4w9WgXcQ';
    const article = {
      ...base, id: 'yt1', url: `https://www.youtube.com/watch?v=${ID}`,
      content: `<div class="enclosure"><p class="enclosure-content"><img class="enclosure-thumbnail" src="https://i3.ytimg.com/vi/${ID}/hqdefault.jpg" alt=""></p></div><p>description</p>`,
    } as unknown as Article;
    const { container } = await open(article);

    expect(container.querySelectorAll('.yt-facade')).toHaveLength(1);
    const thumbs = [...container.querySelectorAll('img')].filter((img) => (img.getAttribute('src') || '').includes(`/vi/${ID}/`));
    expect(thumbs).toHaveLength(1);
    expect(container.querySelector(`${BODY_SELECTOR}`)?.textContent).toContain('description');
  });
});
