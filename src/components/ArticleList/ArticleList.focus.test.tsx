// @vitest-environment jsdom
//
// Deux boutons de la liste disparaissent sous le doigt qui les active :
// « Oublier cette recherche » (sa puce est retirée) et « Nouveau tirage »
// (le squelette remplace la liste). Le focus retombait sur <body> et le
// clavier repartait du haut de la page.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import type { Article } from '../../types';

vi.mock('react-i18next', () => ({
  // `app.labelValue` assemble « libellé : valeur » : garder les deux dans le nom.
  useTranslation: () => ({ t: (k: string, o?: { label?: string; value?: string }) => (o?.value ? `${o.label ?? k}:${o.value}` : k) }),
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

// Comme le vrai `loadArticles` : la liste passe au squelette, le bouton part.
const loadArticles = vi.fn(async () => { useFeedStore.setState({ loading: true } as never); });

function show(state: Record<string, unknown> = {}) {
  useFeedStore.setState({
    articles: rows(3), filter: 'all', selectedFeed: null, searchQuery: '', randomView: false, randomDraw: 0,
    loading: false, revalidating: false, continuation: null, listFailed: false, loadArticles,
    activeServerId: null,
    ...state,
  } as never);
  return render(<ArticleList />);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useUiStore.setState({ showDateSeparators: true, gridDateSeparators: true } as never);
});
afterEach(cleanup);

describe('le focus ne retombe pas sur la page', () => {
  it('« Nouveau tirage » : le focus passe à la liste', () => {
    const c = show({ randomView: true });
    const button = c.getByRole('button', { name: 'articleList.randomAgain' });
    button.focus();
    act(() => { fireEvent.click(button); });
    expect(loadArticles).toHaveBeenCalledTimes(1);
    expect(c.queryByRole('button', { name: 'articleList.randomAgain' })).toBeNull();
    expect(document.activeElement).toBe(c.container.querySelector('[data-article-scroll]'));
  });

  describe('« Oublier cette recherche »', () => {
    const open = () => {
      localStorage.setItem('frirss_searchHistory_none', JSON.stringify(['un', 'deux', 'trois']));
      const c = show();
      act(() => { window.dispatchEvent(new Event('frirss:open-search')); });
      return c;
    };
    const forget = (c: ReturnType<typeof render>, q: string) =>
      c.getByRole('button', { name: `articleList.forgetSearch:${q}` });

    it('passe à la puce suivante', () => {
      const c = open();
      const b = forget(c, 'deux');
      b.focus();
      act(() => { fireEvent.click(b); });
      expect(document.activeElement).toBe(forget(c, 'trois'));
    });

    it('à la précédente quand c’était la dernière', () => {
      const c = open();
      const b = forget(c, 'trois');
      b.focus();
      act(() => { fireEvent.click(b); });
      expect(document.activeElement).toBe(forget(c, 'deux'));
    });

    it('au champ de recherche quand il n’en reste aucune', () => {
      localStorage.setItem('frirss_searchHistory_none', JSON.stringify(['seul']));
      const c = show();
      act(() => { window.dispatchEvent(new Event('frirss:open-search')); });
      const b = forget(c, 'seul');
      b.focus();
      act(() => { fireEvent.click(b); });
      expect(document.activeElement?.tagName).toBe('INPUT');
    });
  });
});
