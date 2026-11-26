// @vitest-environment jsdom
//
// La ligne de méta et les pastilles d'étiquettes du volet (campagne 1.10.1).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
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
const bp = vi.hoisted(() => ({ value: 'desktop' as 'desktop' | 'mobile' }));
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => bp.value, useRawBreakpoint: () => bp.value }));

import ReadingPane from './ReadingPane';
import { useFeedStore } from '../../stores/feedStore';

const AUTHOR = 'محمد رضا';
const make = (over: Partial<Article> = {}) => ({
  id: 'm1', title: 'T', summary: 's', source: 'Zoomit', sourceId: 'feed/1', author: AUTHOR,
  content: '<p>rss</p>', url: 'https://example.com/1', published: Date.UTC(2026, 10, 26, 10, 30), read: true, starred: false, labels: [],
  ...over,
}) as unknown as Article;

async function show(a: Article) {
  useFeedStore.setState({ selectedArticle: a, articles: [a] } as never);
  const c = render(<ReadingPane />);
  await act(async () => { await Promise.resolve(); });
  return c;
}

beforeEach(() => {
  bp.value = 'desktop';
  useFeedStore.setState({ categoryIds: [], folderIds: [], labels: [] } as never);
});
afterEach(cleanup);

describe('ReadingPane — auteur écrit de droite à gauche (M9)', () => {
  // Sur téléphone, « auteur · date » était un seul texte : l'algorithme
  // bidirectionnel rattachait le jour à l'auteur persan et coupait la date
  // (« 26 · محمد رضا novembre 2026 »). L'auteur est isolé dans un <bdi>.
  it('sur téléphone, l’auteur est isolé et la date reste d’un seul tenant', async () => {
    bp.value = 'mobile';
    const c = await show(make());
    const bdi = [...c.container.querySelectorAll('bdi')].find((b) => b.textContent === AUTHOR);
    expect(bdi).toBeTruthy();
    const line = bdi!.parentElement!;
    expect(line.textContent!.startsWith(`${AUTHOR} · `)).toBe(true);
    expect(line.lastChild?.nodeType).toBe(Node.TEXT_NODE);
  });

  it('sans auteur, la ligne ne porte que la date', async () => {
    bp.value = 'mobile';
    const c = await show(make({ author: undefined } as never));
    expect([...c.container.querySelectorAll('bdi')]).toHaveLength(0);
    expect(c.container.textContent).not.toContain(' · ');
  });

  it('sur ordinateur, l’auteur reste dans sa propre case, tronquable', async () => {
    const c = await show(make());
    const span = c.getByTitle(AUTHOR);
    expect(span.textContent).toBe(AUTHOR);
    expect(span.className).toContain('truncate');
  });
});

describe('ReadingPane — catégorie vidée de ses flux (M8)', () => {
  // Le flux quitte sa seule catégorie : elle n'est plus dans `categoryIds`
  // (lu des abonnements) mais reste un dossier FreshRSS (`folderIds`). Elle
  // s'affichait en pastille et comptait dans « Étiquettes (1) ».
  const OLD = 'user/-/label/Sans catégorie';
  const RED = 'user/-/label/Rouge';

  it('un dossier n’est jamais une pastille, une vraie étiquette si', async () => {
    useFeedStore.setState({ folderIds: [OLD], labels: [{ id: RED, type: 'tag' }] } as never);
    const c = await show(make({ labels: [OLD, RED] } as never));
    expect(c.container.textContent).not.toContain('Sans catégorie');
    expect(c.container.textContent).toContain('Rouge');
  });

  it('le bouton Étiquettes ne compte pas le dossier', async () => {
    useFeedStore.setState({ folderIds: [OLD], labels: [] } as never);
    const c = await show(make({ labels: [OLD] } as never));
    expect(c.container.textContent).not.toContain('readingPane.labels (');
  });

  it('une catégorie qui a des flux reste écartée, « À lire plus tard » aussi', async () => {
    useFeedStore.setState({ categoryIds: ['user/-/label/News'], labels: [{ id: RED, type: 'tag' }] } as never);
    const c = await show(make({ labels: ['user/-/label/News', 'user/-/label/À lire plus tard', RED] } as never));
    expect(c.container.textContent).not.toContain('News');
    expect(c.container.textContent).toContain('readingPane.labels (1)');
  });
});
