// @vitest-environment jsdom
//
// Défilement de la liste : la position appartient à la vue, la suite se
// charge quand la relecture finit en bas, la ligne choisie au clavier reste à
// l'écran, et passer de la liste à la grille garde l'article en haut.
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
import * as feedsApi from '../../api/feeds';

// D'autres cas remplacent `loadMore` par un espion : le vrai est gardé ici.
const realLoadMore = useFeedStore.getState().loadMore;

const rows = (n: number, prefix = 'a'): Article[] => Array.from({ length: n }, (_, i) => ({
  id: `${prefix}${i}`, title: `Article ${i}`, summary: 'S', source: 'Src', sourceId: 'feed/1', content: '', author: '',
  url: `https://example.com/${i}`, published: 1_700_000_000_000 - i * 1000, read: false, starred: false, labels: [], tags: [],
}));

/**
 * jsdom ne met rien en page : chaque ligne fait `rowHeight`, une carte de
 * grille aussi, trois par rangée. Le conteneur va de 0 à `clientHeight`.
 */
const metrics = { rowHeight: 100, clientHeight: 800 };
const scroller = () => document.querySelector<HTMLElement>('[data-article-scroll]')!;
const contentHeight = () => document.querySelectorAll('[data-article-id]').length * metrics.rowHeight;
const box = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
const realRect = Element.prototype.getBoundingClientRect;
let view = 0;

beforeEach(() => {
  metrics.rowHeight = 100;
  metrics.clientHeight = 800;
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: contentHeight });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => metrics.clientHeight });
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.hasAttribute('data-article-scroll')) return box(0, metrics.clientHeight);
    if (this.hasAttribute('data-article-id')) {
      const i = [...document.querySelectorAll('[data-article-id]')].indexOf(this);
      const per = this.classList.contains('article-card') ? 3 : 1;
      const top = Math.floor(i / per) * metrics.rowHeight - (scroller()?.scrollTop ?? 0);
      return box(top, top + metrics.rowHeight);
    }
    return box(0, 0);
  };
  localStorage.clear();
  useUiStore.setState({ panelLayout: '3', viewMode: 'preview', layoutMode: 'desktop', showDateSeparators: false, gridDateSeparators: false } as never);
  useFeedStore.setState({
    articles: [], selectedArticle: null, selectedFeed: { id: `feed/s${++view}`, title: 'F' } as never, filter: 'all',
    continuation: null, loading: false, loadingMore: false, revalidating: false, searchQuery: '', searchResults: [], listFailed: false,
    randomView: false,
  } as never);
});
afterEach(() => {
  cleanup();
  Element.prototype.getBoundingClientRect = realRect;
});

describe('↓/↑ font défiler la liste jusqu’à la ligne choisie (L-15)', () => {
  it('une ligne sous la fenêtre arrive en bas de la liste', () => {
    const list = rows(100);
    useFeedStore.setState({ articles: list });
    render(<ArticleList />);
    act(() => useFeedStore.setState({ selectedArticle: list[20] }));
    expect(scroller().scrollTop).toBe(1300);
  });

  it('y compris au-delà de la tranche montée', () => {
    const list = rows(200);
    useFeedStore.setState({ articles: list });
    render(<ArticleList />);
    act(() => useFeedStore.setState({ selectedArticle: list[120] }));
    expect(scroller().scrollTop).toBe(11300);
  });

  it('une ligne au-dessus de la fenêtre arrive en haut', () => {
    const list = rows(100);
    useFeedStore.setState({ articles: list });
    render(<ArticleList />);
    scroller().scrollTop = 3000;
    act(() => useFeedStore.setState({ selectedArticle: list[10] }));
    expect(scroller().scrollTop).toBe(1000);
  });

  it('une ligne déjà visible ne fait rien bouger', () => {
    const list = rows(100);
    useFeedStore.setState({ articles: list });
    render(<ArticleList />);
    act(() => useFeedStore.setState({ selectedArticle: list[3] }));
    expect(scroller().scrollTop).toBe(0);
  });
});

describe('l’article ouvert est signalé (aria-current)', () => {
  it('en liste', () => {
    const list = rows(10);
    useFeedStore.setState({ articles: list, selectedArticle: list[5] });
    const { container } = render(<ArticleList />);
    expect(container.querySelector('[data-article-id="a5"]')!.getAttribute('aria-current')).toBe('true');
    expect(container.querySelectorAll('[aria-current]')).toHaveLength(1);
  });

  it('en grille', () => {
    useUiStore.setState({ panelLayout: 'grid' } as never);
    const list = rows(10);
    useFeedStore.setState({ articles: list, selectedArticle: list[5] });
    const { container } = render(<ArticleList />);
    expect(container.querySelector('[data-article-id="a5"]')!.getAttribute('aria-current')).toBe('true');
    expect(container.querySelectorAll('[aria-current]')).toHaveLength(1);
  });
});

describe('la position de défilement appartient à la vue (L-09)', () => {
  it('un autre flux s’ouvre en haut, pas à la position du précédent', () => {
    useFeedStore.setState({ articles: rows(100) });
    render(<ArticleList />);
    scroller().scrollTop = 3000;
    fireEvent.scroll(scroller());
    act(() => useFeedStore.setState({ selectedFeed: { id: `feed/s${++view}`, title: 'G' } as never, articles: rows(100, 'b') }));
    expect(scroller().scrollTop).toBe(0);
  });

  it('revenir sur un flux retrouve sa position', () => {
    const feedA = useFeedStore.getState().selectedFeed;
    useFeedStore.setState({ articles: rows(100) });
    render(<ArticleList />);
    scroller().scrollTop = 3000;
    fireEvent.scroll(scroller());
    act(() => useFeedStore.setState({ selectedFeed: { id: `feed/s${++view}`, title: 'G' } as never, articles: rows(100, 'b') }));
    act(() => useFeedStore.setState({ selectedFeed: feedA, articles: rows(100) }));
    expect(scroller().scrollTop).toBe(3000);
  });

  it('une vue vide entre-temps ne fait pas perdre la position du flux', () => {
    // Flux sans non-lus, chargement en échec, recherche sans résultat : la
    // restauration n'a rien à faire, mais le retour sur A doit la refaire.
    const feedA = useFeedStore.getState().selectedFeed;
    useFeedStore.setState({ articles: rows(100) });
    render(<ArticleList />);
    scroller().scrollTop = 3000;
    fireEvent.scroll(scroller());
    act(() => useFeedStore.setState({ selectedFeed: { id: `feed/s${++view}`, title: 'Vide' } as never, articles: [] }));
    // Le navigateur ramène une liste vide en haut.
    scroller().scrollTop = 0;
    fireEvent.scroll(scroller());
    act(() => useFeedStore.setState({ selectedFeed: feedA, articles: rows(100) }));
    expect(scroller().scrollTop).toBe(3000);
    // Et le défilement suivant écrit bien la position de A.
    scroller().scrollTop = 3100;
    fireEvent.scroll(scroller());
    act(() => useFeedStore.setState({ selectedFeed: { id: `feed/s${++view}`, title: 'G' } as never, articles: rows(100, 'b') }));
    act(() => useFeedStore.setState({ selectedFeed: feedA, articles: rows(100) }));
    expect(scroller().scrollTop).toBe(3100);
  });

  it('la relecture finie en bas de la liste charge la suite, une seule fois', () => {
    const loadMore = vi.fn();
    useFeedStore.setState({ articles: rows(50), continuation: 'c', revalidating: true, loadMore } as never);
    render(<ArticleList />);
    // Position héritée ou ramenée en bas pendant la relecture, sans `scroll`
    // que le store aurait accepté.
    scroller().scrollTop = contentHeight() - metrics.clientHeight;
    act(() => useFeedStore.setState({ revalidating: false }));
    expect(loadMore).toHaveBeenCalledTimes(1);
    // Ni l'échec ni le retour de `loadingMore` ne la relancent.
    act(() => useFeedStore.setState({ loadingMore: true }));
    act(() => useFeedStore.setState({ loadingMore: false }));
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  // N-1 (campagne 1.9.0) : retour sur l'onglet pendant que la suite charge.
  // La relecture finit avec `loadMore` en vol : la vérification est refusée
  // (`loadingMore`). Puis `loadMore` jette sa page — la relecture a remplacé
  // la suite (REG-120) — et repose `loadingMore: false` sans rien relancer :
  // la liste restait bloquée en bas de sa première page.
  it('la relecture finie pendant le chargement de la suite vérifie le bas quand il se termine, une seule fois', () => {
    const loadMore = vi.fn();
    useFeedStore.setState({ articles: rows(50), continuation: 'c', revalidating: true, loadingMore: true, loadMore } as never);
    render(<ArticleList />);
    scroller().scrollTop = contentHeight() - metrics.clientHeight;
    act(() => useFeedStore.setState({ revalidating: false, continuation: 'c2' }));
    expect(loadMore).not.toHaveBeenCalled();
    // La page en vol est jetée : plus rien n'est en cours.
    act(() => useFeedStore.setState({ loadingMore: false }));
    expect(loadMore).toHaveBeenCalledTimes(1);
    // Pas d'emballement : un nouveau tour de `loadingMore` ne relance rien.
    act(() => useFeedStore.setState({ loadingMore: true }));
    act(() => useFeedStore.setState({ loadingMore: false }));
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it('…et ne charge rien si la liste n’est plus en bas', () => {
    const loadMore = vi.fn();
    useFeedStore.setState({ articles: rows(50), continuation: 'c', revalidating: true, loadingMore: true, loadMore } as never);
    render(<ArticleList />);
    act(() => useFeedStore.setState({ revalidating: false, continuation: 'c2' }));
    act(() => useFeedStore.setState({ loadingMore: false }));
    expect(loadMore).not.toHaveBeenCalled();
  });

  // M-02 (second round 1.9.0) : le même retour d'onglet, de bout en bout,
  // avec le vrai store. `silentRefresh` (chemin du retour sur l'onglet et du
  // tirer-pour-rafraîchir) ne posait pas `revalidating` : la marque ci-dessus
  // n'était jamais armée, `loadMore` jetait sa page et rien ne la redemandait.
  it('retour sur l’onglet pendant le chargement de la suite : la page jetée est redemandée avec la nouvelle suite (M-02)', async () => {
    const raw = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => ({
      id: `${prefix}${i}`, title: `T${i}`, published: 1_700_000_000 - i,
      origin: { streamId: 'feed/1', title: 'F' }, categories: [], alternate: [{ href: `https://example.com/${prefix}${i}` }],
    }));
    let release!: (v: unknown) => void;
    const inFlight = new Promise((r) => { release = r; });
    const stream = vi.mocked(feedsApi.getStreamContents);
    stream.mockReset();
    stream.mockImplementationOnce(() => inFlight as never);
    useFeedStore.setState({ articles: rows(50), continuation: 'c', loadMore: realLoadMore } as never);
    render(<ArticleList />);
    scroller().scrollTop = contentHeight() - metrics.clientHeight;
    fireEvent.scroll(scroller());
    expect(useFeedStore.getState().loadingMore).toBe(true);
    // Retour sur l'onglet : la première page relue n'a rien en commun avec la
    // liste affichée, elle la remplace avec sa propre suite.
    stream.mockResolvedValueOnce({ items: raw(50, 'n'), continuation: 'c-new' } as never);
    stream.mockResolvedValue({ items: [], continuation: null } as never);
    await act(async () => { await useFeedStore.getState().silentRefresh(); });
    expect(useFeedStore.getState().continuation).toBe('c-new');
    // La page de l'ancienne suite arrive : jetée (REG-120)…
    await act(async () => { release({ items: raw(50, 'o'), continuation: 'c-older' }); await new Promise((r) => setTimeout(r, 0)); });
    // … et redemandée avec la suite de la nouvelle première page.
    expect(stream.mock.calls.map((c) => c[2])).toEqual(['c', null, 'c-new']);
  });

  it('la relecture finie loin du bas ne charge rien', () => {
    const loadMore = vi.fn();
    useFeedStore.setState({ articles: rows(50), continuation: 'c', revalidating: true, loadMore } as never);
    render(<ArticleList />);
    act(() => useFeedStore.setState({ revalidating: false }));
    expect(loadMore).not.toHaveBeenCalled();
  });
});

describe('liste → grille garde l’article en haut, pas le décalage en pixels', () => {
  it('l’article 47 reste celui du haut', () => {
    useFeedStore.setState({ articles: rows(100) });
    render(<ArticleList />);
    scroller().scrollTop = 4750;
    fireEvent.scroll(scroller());
    act(() => useUiStore.setState({ panelLayout: 'grid' } as never));
    // Carte 47 : rangée 15 de la grille (1 500 px), toujours 50 px au-dessus du bord.
    expect(scroller().scrollTop).toBe(1550);
  });

  it('et dans l’autre sens', () => {
    useUiStore.setState({ panelLayout: 'grid' } as never);
    useFeedStore.setState({ articles: rows(100) });
    render(<ArticleList />);
    scroller().scrollTop = 1550;
    fireEvent.scroll(scroller());
    act(() => useUiStore.setState({ panelLayout: '3' } as never));
    expect(scroller().scrollTop).toBe(4550);
  });
});
