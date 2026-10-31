// @vitest-environment jsdom
//
// Le bouton Aléatoire et ce que la liste change dans ce mode.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

const setRandomView = vi.fn();
const loadArticles = vi.fn(async () => {});
const online = (on: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });

function show(state: Record<string, unknown> = {}) {
  useFeedStore.setState({
    articles: rows(3), filter: 'all', selectedFeed: null, searchQuery: '', randomView: false, randomDraw: 0,
    loading: false, revalidating: false, continuation: null, listFailed: false, setRandomView, loadArticles,
    ...state,
  } as never);
  return render(<ArticleList />);
}
const random = (c: ReturnType<typeof render>) => c.queryAllByRole('button', { name: 'articleList.random' })[0];

beforeEach(() => { vi.clearAllMocks(); online(true); useUiStore.setState({ showDateSeparators: true, gridDateSeparators: true } as never); });
afterEach(cleanup);

describe('le bouton Aléatoire', () => {
  it.each(['all', 'unread'])('présent sous %s, et bascule le mode', (filter) => {
    const c = show({ filter });
    fireEvent.click(random(c));
    expect(setRandomView).toHaveBeenCalledWith(true);
  });

  it.each(['starred', 'readlater'])('absent sous %s', (filter) => {
    expect(random(show({ filter }))).toBeUndefined();
  });

  it('absent pendant une recherche', () => {
    expect(random(show({ searchQuery: 'mot' }))).toBeUndefined();
  });

  it('désactivé hors ligne, et dit pourquoi', () => {
    online(false);
    const b = show().getAllByRole('button', { name: 'articleList.randomOffline' })[0] as HTMLButtonElement;
    expect(b.disabled).toBe(true);
  });

  // La phrase hors ligne, en toutes lettres, passait de 81 à 208 px et sortait les
  // boutons voisins de la barre : le texte visible ne change pas.
  it('hors ligne, le mot affiché reste le même', () => {
    useUiStore.setState({ panelLayout: '2' } as never);
    online(false);
    const b = show().getAllByRole('button', { name: 'articleList.randomOffline' })[0];
    expect(b.textContent).toBe('articleList.random');
  });

  // Actif hors ligne, il doit rester le moyen d'en sortir.
  it('reste utilisable hors ligne pour quitter le mode', () => {
    online(false);
    const b = random(show({ randomView: true })) as HTMLButtonElement;
    expect(b.disabled).toBe(false);
    fireEvent.click(b);
    expect(setRandomView).toHaveBeenCalledWith(false);
  });
});

// Une icône sans texte, sur la ligne du titre en 3 colonnes, ne se trouvait pas.
describe('la place du bouton', () => {
  const neighbours = (c: ReturnType<typeof render>) => {
    const button = random(c);
    const row = [...button.parentElement!.children].map((e) => e.getAttribute('aria-label'));
    return { row, label: button.textContent };
  };

  it.each(['2', '3', 'grid'])('suit « Non lus » dans la disposition %s', (panelLayout) => {
    useUiStore.setState({ panelLayout } as never);
    const { row } = neighbours(show());
    expect(row.indexOf('articleList.random')).toBe(row.indexOf('articleList.unread') + 1);
  });

  it.each(['2', 'grid', '3'])('porte son nom en toutes lettres dans la disposition %s', (panelLayout) => {
    useUiStore.setState({ panelLayout } as never);
    expect(neighbours(show()).label).toBe('articleList.random');
  });

  it('en 3 colonnes, Rechercher cède son mot le premier, Aléatoire ensuite', () => {
    useUiStore.setState({ panelLayout: '3' } as never);
    const c = show();
    const button = random(c);
    expect(button.parentElement!.className).toContain('list-actions');
    expect(button.querySelector('span')!.getAttribute('data-cede')).toBe('2');
    const search = c.getAllByRole('button', { name: 'articleList.search' }).find((b) => b.parentElement === button.parentElement)!;
    expect(search.querySelector('span')!.getAttribute('data-cede')).toBe('1');
  });

  it('la feuille retire les mots dans cet ordre', () => {
    const css = readFileSync(resolve(__dirname, '../../styles/index.css'), 'utf8');
    expect(css).toMatch(/\.list-actions\[data-fold='1'\] \[data-cede='1'\],\s*\.list-actions\[data-fold='2'\] \[data-cede\]\s*\{\s*display:\s*none/);
    expect(css).toMatch(/\.list-actions\[data-fold='2'\]\s*\{\s*flex-wrap:\s*wrap/);
  });
});

describe('l’état du bouton', () => {
  it.each([[false, 'false'], [true, 'true']])('se lit sans la couleur (%s)', (randomView, pressed) => {
    expect(random(show({ randomView })).getAttribute('aria-pressed')).toBe(pressed);
  });
});

describe('la position dans la liste', () => {
  const list = (c: ReturnType<typeof render>) => c.container.querySelector('[data-article-scroll]') as HTMLElement;

  it('un nouveau tirage repart du haut, même sans changement de taille', () => {
    const c = show({ randomView: true, randomDraw: 1 });
    list(c).scrollTop = 900;
    act(() => { useFeedStore.setState({ randomDraw: 2 } as never); });
    expect(list(c).scrollTop).toBe(0);
  });

  it('entrer dans le mode repart du haut', () => {
    const c = show();
    list(c).scrollTop = 900;
    act(() => { useFeedStore.setState({ randomView: true } as never); });
    expect(list(c).scrollTop).toBe(0);
  });

  // La mémoire de position n'est relue qu'au montage : la liste normale restait au
  // décalage du tirage, ni en haut, ni là où on l'avait quittée.
  it('quitter le mode rend la position de la liste normale', () => {
    const c = show();
    list(c).scrollTop = 1000;
    fireEvent.scroll(list(c));
    act(() => { useFeedStore.setState({ randomView: true } as never); });
    list(c).scrollTop = 300;
    act(() => { useFeedStore.setState({ randomView: false } as never); });
    expect(list(c).scrollTop).toBe(1000);
  });

  it('hors du mode, la position reste', () => {
    const c = show();
    list(c).scrollTop = 900;
    act(() => { useFeedStore.setState({ articles: rows(4) } as never); });
    expect(list(c).scrollTop).toBe(900);
  });
});

describe('la liste en mode aléatoire', () => {
  it('ne propose ni « Tout lu », ni son pied de liste', () => {
    const c = show({ randomView: true });
    expect(c.queryByRole('button', { name: 'articleList.markAllRead' })).toBeNull();
    expect(c.queryByText('articleList.endOfListMarkRead')).toBeNull();
  });

  it('propose « Tout lu » hors du mode', () => {
    expect(show().queryAllByRole('button', { name: 'articleList.markAllRead' }).length).toBeGreaterThan(0);
  });

  it('n’affiche pas de séparateurs de date', () => {
    const c = show({ randomView: true, articles: [rows(2)[0], { ...rows(2)[1], published: 1_500_000_000_000 }] });
    expect(c.container.querySelectorAll('.date-separator').length).toBe(0);
    cleanup();
    const n = show({ articles: [rows(2)[0], { ...rows(2)[1], published: 1_500_000_000_000 }] });
    expect(n.container.querySelectorAll('.date-separator').length).toBe(2);
  });

  it('« Nouveau tirage » relance la vue, en fin de liste', () => {
    const c = show({ randomView: true });
    fireEvent.click(c.getByRole('button', { name: 'articleList.randomAgain' }));
    expect(loadArticles).toHaveBeenCalledTimes(1);
  });

  it('pas de « Nouveau tirage » hors du mode', () => {
    expect(show().queryByRole('button', { name: 'articleList.randomAgain' })).toBeNull();
  });

  it('une vue vide le dit, sans se présenter comme une réussite, et propose un nouveau tirage', () => {
    const c = show({ randomView: true, articles: [], filter: 'unread' });
    expect(c.queryByText('articleList.randomEmpty')).not.toBeNull();
    expect(c.queryByText('emptyState.allRead')).toBeNull();
    expect(c.queryByText('emptyState.allReadAction')).toBeNull();
    fireEvent.click(c.getByRole('button', { name: 'articleList.randomAgain' }));
    expect(loadArticles).toHaveBeenCalledTimes(1);
  });

  it('sous Tous aussi, la vue vide a sa sortie', () => {
    const c = show({ randomView: true, articles: [], filter: 'all' });
    expect(c.queryByRole('button', { name: 'articleList.randomAgain' })).not.toBeNull();
  });
});
