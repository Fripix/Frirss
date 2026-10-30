// @vitest-environment jsdom
//
// Une longue liste ne se monte plus d'un bloc : 400 lignes préparées partaient
// entières à l'ouverture du flux, et chaque ouverture d'article les re-rendait
// toutes. La tranche ne change rien à ce que le store sait de la liste.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
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

/** jsdom ne met rien en page : la hauteur du conteneur est celle qu'on déclare. */
const metrics = { rowHeight: 100, clientHeight: 0 };
const contentHeight = () => document.querySelectorAll('[data-article-id]').length * metrics.rowHeight;
let view = 0;
beforeEach(() => {
  metrics.rowHeight = 100;
  metrics.clientHeight = 0;
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: contentHeight });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => metrics.clientHeight });
  localStorage.clear();
  useUiStore.setState({ panelLayout: '3', viewMode: 'preview', layoutMode: 'desktop', showDateSeparators: false } as never);
  useFeedStore.setState({
    // Une vue par test : la limite est gardée par vue, d'un montage à l'autre.
    articles: [], selectedArticle: null, selectedFeed: { id: `feed/w${++view}`, title: 'F' } as never, filter: 'all',
    continuation: null, loading: false, loadingMore: false, revalidating: false, searchQuery: '', searchResults: [], listFailed: false,
  } as never);
});
afterEach(cleanup);

const mounted = (c: HTMLElement) => c.querySelectorAll('[data-article-id]').length;
const scroller = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-article-id]')!.closest<HTMLElement>('.nice-scroll')!;
/** Le lecteur arrive en bas de ce qui est monté. */
function reachBottom(c: HTMLElement) {
  metrics.clientHeight = 800;
  const el = scroller(c);
  el.scrollTop = contentHeight() - metrics.clientHeight;
  fireEvent.scroll(el);
}
function show(articles: Article[], over: Record<string, unknown> = {}) {
  useFeedStore.setState({ articles, ...over } as never);
}

describe('la tranche locale', () => {
  it('une liste de 400 lignes n’en monte que 50', () => {
    show(rows(400));
    const { container } = render(<ArticleList />);
    expect(mounted(container)).toBe(50);
  });

  it('le défilement monte la tranche suivante, sans réseau', () => {
    show(rows(120));
    const loadMore = vi.fn();
    useFeedStore.setState({ loadMore } as never);
    const { container } = render(<ArticleList />);
    reachBottom(container);
    expect(mounted(container)).toBe(100);
    reachBottom(container);
    expect(mounted(container)).toBe(120);
    expect(loadMore).not.toHaveBeenCalled();
  });

  it('une fois tout monté, le défilement demande la page suivante, qui s’affiche', () => {
    show(rows(50), { continuation: 'c' });
    const loadMore = vi.fn();
    useFeedStore.setState({ loadMore } as never);
    const { container } = render(<ArticleList />);
    reachBottom(container);
    expect(loadMore).toHaveBeenCalledTimes(1);
    act(() => show(rows(100), { continuation: 'd' }));
    expect(mounted(container)).toBe(100);
  });

  it('tant qu’il reste des lignes à monter, pas de page suivante', () => {
    show(rows(120), { continuation: 'c' });
    const loadMore = vi.fn();
    useFeedStore.setState({ loadMore } as never);
    const { container } = render(<ArticleList />);
    reachBottom(container);
    expect(loadMore).not.toHaveBeenCalled();
  });

  it('une liste trop courte pour défiler monte la suite sans attendre un défilement', () => {
    metrics.rowHeight = 5;
    metrics.clientHeight = 800;
    show(rows(120));
    const { container } = render(<ArticleList />);
    expect(mounted(container)).toBe(120);
  });

  // Sur mobile, la liste reste montée derrière le volet : sa hauteur vaut 0.
  // Plus de barre de défilement, donc plus de `scroll`, et l'effet de
  // remplissage ne repartait pas : la liste restait à 50 lignes.
  it('une fenêtre agrandie monte la suite', async () => {
    metrics.rowHeight = 40;
    metrics.clientHeight = 1000;
    show(rows(120));
    const { container } = render(<ArticleList />);
    expect(mounted(container)).toBe(50);
    metrics.clientHeight = 2100;
    await act(async () => { window.dispatchEvent(new Event('resize')); });
    expect(mounted(container)).toBeGreaterThan(50);
  });

  it('une liste cachée ne monte rien de plus', () => {
    show(rows(120));
    const { container } = render(<ArticleList />);
    expect(mounted(container)).toBe(50);
  });

  it('« article suivant » atteint une ligne pas encore montée', () => {
    const all = rows(120);
    show(all, { selectedArticle: all[49] });
    const { container } = render(<ArticleList />);
    expect(mounted(container)).toBe(50);
    act(() => useFeedStore.getState().selectNextArticle());
    expect(useFeedStore.getState().selectedArticle?.id).toBe('a50');
    expect(container.querySelector('[data-article-id="a50"]')).not.toBeNull();
    // Le volet refermé, la ligne reste : le lecteur ne perd pas sa place.
    act(() => useFeedStore.setState({ selectedArticle: null }));
    expect(container.querySelector('[data-article-id="a50"]')).not.toBeNull();
  });

  it('au retour d’un article (liste remontée), la tranche est celle qu’on avait', () => {
    show(rows(300), { selectedFeed: { id: 'feed/retour', title: 'F' } });
    const first = render(<ArticleList />);
    reachBottom(first.container);
    reachBottom(first.container);
    expect(mounted(first.container)).toBe(150);
    first.unmount();
    const second = render(<ArticleList />);
    expect(mounted(second.container)).toBe(150);
  });

  it('une autre vue repart de la première tranche', () => {
    show(rows(300), { selectedFeed: { id: 'feed/a', title: 'F' } });
    const { container } = render(<ArticleList />);
    reachBottom(container);
    expect(mounted(container)).toBe(100);
    scroller(container).scrollTop = 0;
    act(() => show(rows(300), { selectedFeed: { id: 'feed/b', title: 'G' } }));
    expect(mounted(container)).toBe(50);
  });

  it('« Tout lu » au pied de liste n’apparaît qu’une fois tout monté', () => {
    show(rows(60));
    const { container } = render(<ArticleList />);
    expect(container.textContent).not.toContain('articleList.endOfListMarkRead');
    reachBottom(container);
    expect(mounted(container)).toBe(60);
    expect(container.textContent).toContain('articleList.endOfListMarkRead');
  });

  it('« Tout lu » couvre aussi les lignes pas encore montées', async () => {
    show(rows(120));
    const { container } = render(<ArticleList />);
    await act(async () => { await useFeedStore.getState().markAllAsRead(); });
    expect(useFeedStore.getState().articles.every((a) => a.read)).toBe(true);
    expect(mounted(container)).toBe(50);
  });

  it('une recherche garde sa propre pagination', () => {
    show(rows(120), { searchQuery: 'x', searchResults: rows(120), searchVisible: 120 });
    const { container } = render(<ArticleList />);
    expect(mounted(container)).toBe(120);
  });

  it('une bande de date compte toutes ses lignes, montées ou non', () => {
    useUiStore.setState({ showDateSeparators: true } as never);
    show(rows(120));
    const { container } = render(<ArticleList />);
    expect(mounted(container)).toBe(50);
    expect(container.textContent).toContain('120');
  });

  it('sur téléphone, la même tranche', () => {
    useUiStore.setState({ layoutMode: 'mobile' } as never);
    show(rows(120));
    const { container } = render(<ArticleList />);
    expect(mounted(container)).toBe(50);
    reachBottom(container);
    expect(mounted(container)).toBe(100);
  });

  it('la grille monte elle aussi par tranches', () => {
    useUiStore.setState({ panelLayout: 'grid' } as never);
    show(rows(120));
    const { container } = render(<ArticleList />);
    expect(mounted(container)).toBe(50);
    reachBottom(container);
    expect(mounted(container)).toBe(100);
  });
});
