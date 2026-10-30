// @vitest-environment jsdom
//
// Aucune URL de flux autre que http(s) ne devient un `href` dans le volet
// (« Original », titre, entrée de la feuille du bas) : voir `safeHref`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
vi.mock('../../i18n', () => ({ default: { t: (k: string) => k } }));

let breakpoint: 'desktop' | 'mobile' = 'desktop';
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => breakpoint, useRawBreakpoint: () => breakpoint }));

import ReadingPane from './ReadingPane';
import { useFeedStore } from '../../stores/feedStore';


const article = (url: string) => ({
  id: `l-${url.length}-${breakpoint}`, title: 'Titre', summary: 's', source: 'Src', sourceId: 'feed/1',
  content: '<p>rss</p>', url, published: Date.now(), read: true, starred: false, labels: [],
}) as unknown as Article;

/** Les liens vers l'article que rend le volet (hors corps, assaini à part). */
function articleLinks(): Element[] {
  return [...document.querySelectorAll('[href]')].filter((a) => !a.closest('.reading-body-enter'));
}

async function show(url: string) {
  const a = article(url);
  useFeedStore.setState({ selectedArticle: a, articles: [a] } as never);
  const r = render(<ReadingPane />);
  await act(async () => { await Promise.resolve(); });
  return r;
}

afterEach(() => { cleanup(); breakpoint = 'desktop'; });
beforeEach(() => { localStorage.clear(); });

describe('ReadingPane — liens vers l’article', () => {
  it('bureau : « Original » et le titre portent une URL https (témoin)', async () => {
    await show('https://example.com/1');
    const hrefs = articleLinks().map((a) => a.getAttribute('href'));
    expect(hrefs.filter((h) => h === 'https://example.com/1').length).toBeGreaterThanOrEqual(2);
  });

  // `data:` compte autant que `javascript:` : React ne neutralise que le second.
  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>'])('bureau : %s ne devient aucun href', async (url) => {
    const { container } = await show(url);
    expect(articleLinks().map((a) => a.getAttribute('href'))).toEqual([]);
    // Le titre reste affiché, en texte.
    expect(container.querySelector('h1')?.textContent).toBe('Titre');
  });

  it('mobile : l’entrée « Ouvrir l’original » de la feuille porte l’URL https (témoin)', async () => {
    breakpoint = 'mobile';
    const { getByLabelText } = await show('https://example.com/1');
    await act(async () => { fireEvent.click(getByLabelText('readingPane.more')); });
    const entry = [...document.querySelectorAll('.sheet-row')].find((el) => el.textContent?.includes('readingPane.openOriginal'));
    expect(entry?.getAttribute('href')).toBe('https://example.com/1');
  });

  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>'])('mobile : %s ne devient aucun href, feuille ouverte comprise', async (url) => {
    breakpoint = 'mobile';
    const { getByLabelText } = await show(url);
    await act(async () => { fireEvent.click(getByLabelText('readingPane.more')); });
    expect(articleLinks().map((a) => a.getAttribute('href'))).toEqual([]);
  });
});
