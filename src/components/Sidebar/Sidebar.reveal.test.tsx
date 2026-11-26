// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const bp = vi.hoisted(() => ({ value: 'mobile' as 'mobile' | 'tablet' | 'desktop' }));

vi.hoisted(() => {
  // Constantes injectées par Vite au build.
  Object.assign(globalThis, { __APP_DEV_VERSION__: '', __APP_VERSION__: '0.0.0' });
  Object.defineProperty(window, 'matchMedia', { writable: true, value: (q: string) => ({ matches: false, media: q, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }) });
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'fr' } }),
}));
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => bp.value }));
vi.mock('../../api/feeds', () => ({
  getSubscriptionList: vi.fn(), getUnreadCounts: vi.fn(async () => []), getStreamContents: vi.fn(),
  getStarredItems: vi.fn(), markAsRead: vi.fn(), markAsUnread: vi.fn(), markAsStarred: vi.fn(),
  removeStarred: vi.fn(), markAllAsRead: vi.fn(), fetchStreamPage: vi.fn(), subscribeFeed: vi.fn(),
  editFeed: vi.fn(), unsubscribeFeed: vi.fn(), getTagList: vi.fn(), setArticleLabel: vi.fn(),
  renameTag: vi.fn(), deleteTag: vi.fn(), clearWriteToken: vi.fn(), getStreamItemCount: vi.fn(async () => 0),
}));
vi.mock('../../i18n', () => ({ default: { t: (k: string) => k } }));


import Sidebar from './Sidebar';
import { useFeedStore } from '../../stores/feedStore';
import { useUiStore } from '../../stores/uiStore';
import { act } from '@testing-library/react';

const cat = (name: string) => [{ id: `user/-/label/${name}`, label: name }];
const A = { id: 'feed/1', title: 'A', categories: cat('News') } as never;
const B = { id: 'feed/2', title: 'B', categories: cat('Tech') } as never;

// Le flux ouvert par `n` (issue #35) ou par la palette pouvait rester hors de
// la barre latérale défilée (campagne 1.10.1, M2) : la barre le ramène à
// l'écran, et le focus clavier le suit s'il était dans la liste.
describe('Sidebar — le flux ouvert reste visible dans la barre', () => {
  const rects: Record<string, number> = {};
  const proto = Element.prototype as unknown as { getBoundingClientRect: () => DOMRect };
  const original = proto.getBoundingClientRect;
  let scrollTop = 0;
  const rect = (top: number, h: number) => ({ top, bottom: top + h, left: 0, right: 200, width: 200, height: h, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

  function setup(visible = true) {
    bp.value = 'desktop';
    useUiStore.setState({ collapsedCategories: {}, categoryOrder: [], feedOrder: {}, hideReadFeeds: false } as never);
    useFeedStore.setState({ subscriptions: [A, B], unreadCounts: { 'feed/1': 1, 'feed/2': 3 }, selectedFeed: A } as never);
    rects['feed/1'] = visible ? 40 : 0;
    rects['feed/2'] = visible ? 900 : 0;
    proto.getBoundingClientRect = function (this: Element) {
      if (this.tagName === 'NAV') return visible ? rect(0, 300) : rect(0, 0);
      const id = this.getAttribute('data-view-id');
      return id && id in rects ? (visible ? rect(rects[id], 30) : rect(0, 0)) : rect(0, 0);
    };
    render(<Sidebar />);
    const nav = document.querySelector('nav.sidebar-scroll') as HTMLElement;
    scrollTop = 0;
    Object.defineProperty(nav, 'scrollTop', { configurable: true, get: () => scrollTop, set: (v: number) => { scrollTop = v; } });
    return nav;
  }
  const row = (id: string) => document.querySelector(`[data-view-id="${id}"]`) as HTMLElement;

  afterEach(() => { cleanup(); proto.getBoundingClientRect = original; });

  it('la ligne du flux ouvert sous le bord est ramenée à l’écran', () => {
    setup();
    act(() => { useFeedStore.setState({ selectedFeed: B } as never); });
    expect(scrollTop).toBeGreaterThanOrEqual(900 + 30 - 300);
  });

  it('une ligne déjà visible ne fait pas défiler la barre', () => {
    setup();
    rects['feed/2'] = 100;
    act(() => { useFeedStore.setState({ selectedFeed: B } as never); });
    expect(scrollTop).toBe(0);
  });

  it('le focus suit s’il était sur l’ancienne ligne', () => {
    setup();
    row('feed/1').focus();
    act(() => { useFeedStore.setState({ selectedFeed: B } as never); });
    expect(document.activeElement).toBe(row('feed/2'));
  });

  it('le focus ailleurs (liste d’articles, volet) ne bouge pas', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    try {
      setup();
      outside.focus();
      act(() => { useFeedStore.setState({ selectedFeed: B } as never); });
      expect(document.activeElement).toBe(outside);
    } finally {
      outside.remove();
    }
  });

  it('revenir au même flux après une vue sans ligne (Non lus) le ramène encore', () => {
    setup();
    act(() => { useFeedStore.setState({ selectedFeed: B } as never); });
    scrollTop = 0;
    act(() => { useFeedStore.setState({ selectedFeed: null } as never); });
    act(() => { useFeedStore.setState({ selectedFeed: B } as never); });
    expect(scrollTop).toBeGreaterThanOrEqual(900 + 30 - 300);
  });

  it('barre sans taille (non affichée) : rien ne défile', () => {
    setup(false);
    act(() => { useFeedStore.setState({ selectedFeed: B } as never); });
    expect(scrollTop).toBe(0);
  });

  it('la ligne d’une catégorie ouverte par le saut est ramenée aussi', () => {
    setup();
    rects['user/-/label/Tech'] = 700;
    act(() => { useFeedStore.setState({ selectedFeed: { id: 'user/-/label/Tech', title: 'Tech' } } as never); });
    expect(scrollTop).toBeGreaterThanOrEqual(700 + 30 - 300);
  });
});
