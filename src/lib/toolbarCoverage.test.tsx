// @vitest-environment jsdom
//
// Garde-fou des barres personnalisables : tout élément masquable du registre
// (`toolbarItems.ts`) a sa commande dans la palette, et tout bouton des deux
// barres est déclaré dans le registre. C'est la règle qui permet de masquer
// sans rien rendre inatteignable.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import type { Article } from '../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'fr' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('../i18n', () => ({ default: { t: (k: string) => k } }));
vi.mock('./offlineStore', () => ({
  listsPatch: vi.fn(async () => {}),
  listGet: vi.fn(async () => undefined), listPut: vi.fn(async () => {}), listEvictOlderThan: vi.fn(async () => {}),
  listsWithoutSource: vi.fn(async () => {}), subsGet: vi.fn(async () => undefined), subsPut: vi.fn(async () => {}),
  clearOfflineViews: vi.fn(async () => {}), queueGet: vi.fn(async () => []), queuePut: vi.fn(async () => {}),
}));
vi.mock('./extractStore', () => ({
  dbGet: vi.fn(() => Promise.resolve(undefined)), dbPut: vi.fn(() => Promise.resolve()),
  dbRecent: vi.fn(() => Promise.resolve([])), dbEvictOlderThan: vi.fn(() => Promise.resolve()),
  dbSetPinned: vi.fn(() => Promise.resolve()),
}));
vi.mock('../api/feeds', () => ({
  getSubscriptionList: vi.fn(), getUnreadCounts: vi.fn(async () => []),
  getStreamContents: vi.fn(async () => ({ items: [], continuation: null })),
  getStarredItems: vi.fn(async () => ({ items: [], continuation: null })),
  markAsRead: vi.fn(async () => {}), markAsUnread: vi.fn(async () => {}), markAsStarred: vi.fn(async () => {}), removeStarred: vi.fn(async () => {}),
  markAllAsRead: vi.fn(async () => {}), getUnreadItemIds: vi.fn(async () => ({ ids: [], complete: true })),
  fetchStreamPage: vi.fn(), subscribeFeed: vi.fn(), editFeed: vi.fn(), unsubscribeFeed: vi.fn(),
  getTagList: vi.fn(async () => []), getStreamItemCount: vi.fn(), setArticleLabel: vi.fn(async () => {}),
  renameTag: vi.fn(), deleteTag: vi.fn(), clearWriteToken: vi.fn(), itemIdsNewerThanEntry: vi.fn(async () => []),
}));
vi.mock('../api/backend', () => ({ startActualize: vi.fn(), getActualizeStatus: vi.fn(), getAiConfig: vi.fn(), requestAiSummary: vi.fn() }));
vi.mock('../hooks/useBreakpoint', () => ({ useBreakpoint: () => 'desktop', useRawBreakpoint: () => 'desktop' }));
// La palette ne propose Résumer / Traduire que si le volet le ferait : on le suppose.
vi.mock('./aiTranslateProbe', async (orig) => ({
  ...(await orig<typeof import('./aiTranslateProbe')>()),
  summarizeWouldAct: () => true,
  translateWouldAct: () => true,
}));

import ArticleList from '../components/ArticleList/ArticleList';
import ReadingPane from '../components/ReadingPane/ReadingPane';
import CommandPalette from '../components/CommandPalette';
import { useFeedStore } from '../stores/feedStore';
import { useUiStore } from '../stores/uiStore';
import { useAiStore } from '../stores/aiStore';
import { TOOLBAR_ITEMS, DEFAULT_TOOLBAR_VISIBILITY, type ToolbarItemId, type ToolbarVisibility } from './toolbarItems';
import { probeToolbarCommands } from './toolbarCommands';

/**
 * Éléments couverts par une commande STATIQUE de la palette, pas par une offre
 * de barre. « Traduire » n'est offert par la barre (« Texte source ») que
 * lorsqu'une traduction est affichée : sa commande statique le couvre sinon.
 */
const STATIC: Record<string, ToolbarItemId> = {
  'palette-action:search': 'search',
  'palette-action:layout3': 'layout',
  'palette-action:aiSummarize': 'summarize',
  'palette-action:aiTranslate': 'translate',
};

const FEED = { id: 'feed/1', title: 'Flux' };
const LABEL = 'user/-/label/Tech';
const art = (i: number): Article => ({
  id: `a${i}`, title: `Article ${i}`, summary: 'S', source: 'Src', sourceId: 'feed/1', content: '<p>rss</p>', author: '',
  url: `https://example.com/${i}`, published: 1_700_000_000_000 - i * 1000, read: false, starred: false, labels: [], tags: [],
}) as unknown as Article;
const provider = { id: 1, name: 'P', type: 'openai' as const, hasAdminKey: false, shared: false, hasUserKey: false, available: true };

function setup(panelLayout: '2' | '3', visibility: ToolbarVisibility = DEFAULT_TOOLBAR_VISIBILITY) {
  const articles = [art(0), art(1)];
  // Panneau IA pas affiché d'office : c'est alors que le bouton « Résumer » est dans la barre.
  useUiStore.setState({ panelLayout, toolbarVisibility: visibility, sidebarVisible: true, commandPaletteOpen: false, aiPanelAlways: false, aiAutoSummary: false } as never);
  useAiStore.setState({ config: { enabled: true, providers: [provider], userKeysAllowed: false, dailyCap: 0, usageToday: 0, defaultProvider: 1 } } as never);
  useFeedStore.setState({
    articles, selectedArticle: articles[0], filter: 'all', selectedFeed: FEED, subscriptions: [FEED],
    unreadCounts: { 'feed/1': 2 }, labels: [{ id: LABEL }], categoryIds: [], searchQuery: '', randomView: false,
    randomDraw: 0, loading: false, revalidating: false, continuation: null, listFailed: false,
  } as never);
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
});
afterEach(cleanup);

describe('garde-fou — chaque élément masquable a sa commande de palette', () => {
  it.each(['2', '3'] as const)('disposition %s colonnes', async (layout) => {
    setup(layout);
    const c = render(<><ArticleList /><ReadingPane showBack={layout === '2'} /><CommandPalette /></>);
    await act(async () => { await Promise.resolve(); });
    act(() => { useUiStore.setState({ commandPaletteOpen: true }); });

    const covered = new Set<string>(probeToolbarCommands().map((o) => o.item));
    for (const [id, item] of Object.entries(STATIC)) {
      if (c.container.ownerDocument.getElementById(id)) covered.add(item);
    }
    // Retour n'existe qu'en 2 colonnes et en grille : en 3 colonnes il n'a ni
    // bouton ni commande, et c'est juste.
    const expected = TOOLBAR_ITEMS.map((i) => i.id).filter((id) => layout === '2' || id !== 'back');
    expect([...covered].sort()).toEqual([...expected].sort());
  });
});

describe('garde-fou — chaque bouton des barres est déclaré dans le registre', () => {
  it.each(['2', '3'] as const)('tout masqué en %s colonnes : plus aucun bouton dans les barres', async (layout) => {
    const hidden = Object.fromEntries(Object.keys(DEFAULT_TOOLBAR_VISIBILITY).map((k) => [k, k === 'listBar' || k === 'shortcutBar'])) as unknown as ToolbarVisibility;
    setup(layout, hidden);
    const c = render(<><ArticleList /><ReadingPane showBack={layout === '2'} /></>);
    await act(async () => { await Promise.resolve(); });
    const header = c.container.querySelector('.article-list-header')!;
    // Restent le titre (non masquable) et le ☰ s'il était là : rien d'autre.
    expect([...header.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual([]);
    expect(c.container.querySelector('.reading-toolbar')).toBeNull();
  });
});

describe('garde-fou — masquer un élément seul retire bien quelque chose', () => {
  // Le test « tout masqué » ne voit pas un bouton sans garde logé dans un
  // groupe que la barre retire quand il est vide. Ici, chaque élément est
  // masqué seul : un bouton qui ignorerait son réglage ne ferait rien baisser.
  const controls = (root: HTMLElement) =>
    root.querySelectorAll('.article-list-header button, .article-list-header a[href], .reading-toolbar button, .reading-toolbar a[href]').length;

  it.each(['2', '3'] as const)('en %s colonnes', async (layout) => {
    const mount = async (v: ToolbarVisibility) => {
      setup(layout, v);
      const c = render(<><ArticleList /><ReadingPane showBack={layout === '2'} /></>);
      await act(async () => { await Promise.resolve(); });
      const n = controls(c.container);
      cleanup();
      return n;
    };
    const all = await mount(DEFAULT_TOOLBAR_VISIBILITY);
    const unchanged: string[] = [];
    for (const { id } of TOOLBAR_ITEMS) {
      if (id === 'back' && layout === '3') continue; // pas de Retour en 3 colonnes
      if (await mount({ ...DEFAULT_TOOLBAR_VISIBILITY, [id]: false }) >= all) unchanged.push(id);
    }
    expect(unchanged).toEqual([]);
  });
});
