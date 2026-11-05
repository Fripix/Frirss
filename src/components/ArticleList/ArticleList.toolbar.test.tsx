// @vitest-environment jsdom
//
// Barre de la liste personnalisable sur desktop (Préférences → Mise en page).
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
const bp = vi.hoisted(() => ({ value: 'desktop' as 'desktop' | 'tablet' | 'mobile' }));
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => bp.value }));
vi.mock('../../lib/orphanSeparators', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/orphanSeparators')>();
  return { ...real, markOrphanSeparators: vi.fn(real.markOrphanSeparators) };
});

import * as api from '../../api/feeds';
import ArticleList from './ArticleList';
import { useFeedStore } from '../../stores/feedStore';
import { useUiStore } from '../../stores/uiStore';
import { markOrphanSeparators } from '../../lib/orphanSeparators';
import { DEFAULT_TOOLBAR_VISIBILITY, TOOLBAR_ITEMS, type ToolbarVisibility } from '../../lib/toolbarItems';
import { probeToolbarCommands, runToolbarCommand } from '../../lib/toolbarCommands';

const rows = (n: number): Article[] => Array.from({ length: n }, (_, i) => ({
  id: `a${i}`, title: `Article ${i}`, summary: 'S', source: 'Src', sourceId: 'feed/1', content: '', author: '',
  url: `https://example.com/${i}`, published: 1_700_000_000_000 - i * 1000, read: false, starred: false, labels: [], tags: [],
}));
const FEED = { id: 'feed/1', title: 'Flux' };

function visibility(hidden: string[]): ToolbarVisibility {
  const v = { ...DEFAULT_TOOLBAR_VISIBILITY };
  for (const id of hidden) (v as Record<string, boolean>)[id] = false;
  return v;
}
const LIST_ITEMS = TOOLBAR_ITEMS.filter((i) => i.zone === 'list').map((i) => i.id);

function show(opts: { hidden?: string[]; layout?: '2' | '3' | 'grid'; state?: Record<string, unknown>; sidebar?: boolean } = {}) {
  useUiStore.setState({ panelLayout: opts.layout ?? '3', toolbarVisibility: visibility(opts.hidden ?? []), sidebarVisible: opts.sidebar ?? true } as never);
  useFeedStore.setState({
    articles: rows(3), filter: 'all', selectedFeed: FEED, subscriptions: [FEED], unreadCounts: { 'feed/1': 3 },
    searchQuery: '', randomView: false, randomDraw: 0,
    loading: false, revalidating: false, continuation: null, listFailed: false,
    ...opts.state,
  } as never);
  return render(<ArticleList />);
}
const btn = (c: ReturnType<typeof render>, name: string) => c.queryAllByRole('button', { name })[0];
/** Ce qui est rendu entre les boutons d'une rangée : `|` pour un séparateur. */
const rowShape = (row: Element) => [...row.children].map((e) => e.getAttribute('aria-label') ?? (e.className.includes('w-px') ? '|' : '?'));

beforeEach(() => {
  vi.clearAllMocks();
  bp.value = 'desktop';
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  useUiStore.setState({ confirmMarkAllRead: false } as never);
});
afterEach(cleanup);

describe('barre de la liste — 3 colonnes', () => {
  it('rien de masqué : la rangée d’actions garde ses séparateurs habituels', () => {
    const c = show();
    const row = c.container.querySelector('.list-actions')!;
    expect(rowShape(row)).toEqual([
      'articleList.search', '|', 'articleList.unread', 'articleList.random', 'articleList.starred', '|', 'articleList.markAllRead',
    ]);
  });

  it('Rechercher masqué : la rangée commence par Non lus, sans séparateur en tête', () => {
    const row = show({ hidden: ['search'] }).container.querySelector('.list-actions')!;
    expect(rowShape(row)[0]).toBe('articleList.unread');
  });

  it('Tout lu masqué : aucun séparateur en queue', () => {
    const row = show({ hidden: ['markAllRead'] }).container.querySelector('.list-actions')!;
    expect(rowShape(row).at(-1)).toBe('articleList.starred');
  });

  it('les trois filtres masqués : un seul séparateur entre Rechercher et Tout lu', () => {
    const row = show({ hidden: ['unreadFilter', 'random', 'starredFilter'] }).container.querySelector('.list-actions')!;
    expect(rowShape(row)).toEqual(['articleList.search', '|', 'articleList.markAllRead']);
  });

  it('tout masqué sauf la barre : ni rangée d’actions, ni piste d’options, le titre reste', () => {
    const c = show({ hidden: LIST_ITEMS });
    expect(c.container.querySelector('.list-actions')).toBeNull();
    expect(c.container.querySelector('.option-track')).toBeNull();
    expect(c.container.querySelector('h2')?.textContent).toBeTruthy();
    expect(btn(c, 'viewMode.preview')).toBeUndefined();
    expect(btn(c, 'articleList.listOnly')).toBeUndefined();
  });

  it('une bascule masquée retire son seul bouton de la piste', () => {
    const c = show({ hidden: ['optFavicons'] });
    expect(c.container.querySelector('.option-track')!.children).toHaveLength(3);
  });
});

describe('barre de la liste — 2 colonnes', () => {
  it('Tout lu masqué : pas de séparateur orphelin après Favoris', () => {
    const c = show({ layout: '2', hidden: ['markAllRead'] });
    const actions = btn(c, 'articleList.starred').parentElement!;
    expect(rowShape(actions).at(-1)).toBe('articleList.starred');
  });

  // L-11 : `useToolbarFold` ne retrouve que les traits marqués. Un trait sans
  // la marque resterait orphelin au bout d'une ligne repliée (tablette).
  it.each([['2 colonnes', 'desktop', '2'], ['3 colonnes', 'desktop', '3'], ['tablette', 'tablet', '3']] as const)(
    '%s : chaque trait vertical de la barre d’actions est repérable par le repli (L-11)', (_name, breakpoint, layout) => {
      bp.value = breakpoint;
      const bar = show({ layout }).container.querySelector('.list-actions')!;
      const traits = [...bar.querySelectorAll('.w-px')];
      expect(traits.length).toBeGreaterThan(0);
      for (const trait of traits) expect(trait.hasAttribute('data-toolbar-sep')).toBe(true);
    },
  );

  it('aucun bouton d’action : ni le groupe, ni le trait vertical après le titre', () => {
    const c = show({ layout: '2', hidden: ['search', 'unreadFilter', 'random', 'starredFilter', 'markAllRead'] });
    const bar = c.container.querySelector('.list-actions')!;
    expect(bar.querySelector('.w-px')).toBeNull();
  });
});

describe('la barre entière masquée', () => {
  it('la liste commence tout en haut : pas d’en-tête, pas de titre', () => {
    const c = show({ hidden: ['listBar'] });
    expect(c.container.querySelector('.article-list-header')).toBeNull();
    expect(c.container.querySelector('h2')).toBeNull();
  });

  it('en 2 colonnes aussi', () => {
    const c = show({ layout: '2', hidden: ['listBar'] });
    expect(c.container.querySelector('.article-list-header')).toBeNull();
  });

  it('une recherche active reste visible et s’efface', () => {
    const c = show({ hidden: ['listBar'], state: { searchQuery: 'rust' } });
    const clear = btn(c, 'articleList.clearSearch');
    expect(clear).toBeTruthy();
    fireEvent.click(clear);
    expect(useFeedStore.getState().searchQuery).toBe('');
  });

  it('ouvrir la recherche (palette, touche f) fait apparaître le champ', () => {
    const c = show({ hidden: ['listBar'] });
    act(() => { window.dispatchEvent(new CustomEvent('frirss:open-search')); });
    expect(c.container.querySelector('.article-list-header input')).toBeTruthy();
  });

  // Le trait du haut sépare la recherche de la barre ; sans barre, il ne
  // séparait plus rien et soulignait le haut de la colonne.
  it('le champ de recherche n’a pas de trait au-dessus de lui', () => {
    const c = show({ hidden: ['listBar'] });
    act(() => { window.dispatchEvent(new CustomEvent('frirss:open-search')); });
    const first = c.container.querySelector('.article-list-header')!.firstElementChild as HTMLElement;
    expect(first.tagName).toBe('FORM');
    expect(first.style.borderTop).toBe('');
  });

  it('le rappel d’une recherche active non plus', () => {
    const c = show({ hidden: ['listBar'], state: { searchQuery: 'rust' } });
    const first = c.container.querySelector('.article-list-header')!.firstElementChild as HTMLElement;
    expect(first.textContent).toContain('rust');
    expect(first.style.borderTop).toBe('');
  });

  it('barre affichée, le champ garde son trait', () => {
    const c = show();
    act(() => { window.dispatchEvent(new CustomEvent('frirss:open-search')); });
    const form = c.container.querySelector('.article-list-header form') as HTMLElement;
    expect(form.style.borderTop).not.toBe('');
  });
});

describe('hors desktop, les réglages sont ignorés', () => {
  it('tablette : tout masqué, tout reste là', () => {
    bp.value = 'tablet';
    const c = show({ hidden: [...LIST_ITEMS, 'listBar'] });
    expect(c.container.querySelector('.article-list-header')).toBeTruthy();
    expect(btn(c, 'articleList.search')).toBeTruthy();
    expect(btn(c, 'articleList.markAllRead')).toBeTruthy();
    expect(c.container.querySelector('.option-track')).toBeTruthy();
  });
});

describe('les commandes offertes à la palette', () => {
  const commands = () => probeToolbarCommands().map((o) => o.command);

  it('chaque bouton de la barre a sa commande, masqué ou non', () => {
    useUiStore.setState({ viewMode: 'preview' });
    show({ hidden: [...LIST_ITEMS, 'listBar'] });
    expect(commands()).toEqual(expect.arrayContaining([
      'unreadFilter', 'random', 'starredFilter', 'markAllRead',
      'optSource', 'optFavicons', 'optDateSeparators', 'optServerBar',
      'density:simple', 'density:compact',
    ]));
  });

  it('la densité déjà active n’est pas proposée', () => {
    useUiStore.setState({ viewMode: 'compact' });
    show();
    const density = commands().filter((c) => c.startsWith('density:'));
    expect(density).toEqual(['density:preview', 'density:simple']);
  });

  it('« Tout lu » passe par la même confirmation que le bouton', () => {
    useUiStore.setState({ confirmMarkAllRead: true } as never);
    const c = show({ hidden: ['markAllRead'] });
    act(() => { runToolbarCommand('markAllRead'); });
    expect(c.getByRole('dialog')).toBeTruthy();
    expect(api.markAllAsRead).not.toHaveBeenCalled();
  });

  it('pas de densité en grille, pas d’Aléatoire pendant une recherche', () => {
    show({ layout: 'grid', state: { searchQuery: 'mot' } });
    expect(commands().some((c) => c.startsWith('density:'))).toBe(false);
    expect(commands()).not.toContain('random');
  });

  it('Favoris bascule le filtre comme le bouton', () => {
    show();
    act(() => { runToolbarCommand('starredFilter'); });
    expect(useFeedStore.getState().filter).toBe('starred');
  });

  it('les filtres disent ce qu’ils vont faire, selon leur état (et ne se confondent pas avec les vues)', () => {
    const label = (cmd: string) => probeToolbarCommands().find((o) => o.command === cmd)?.label;
    show();
    expect(label('unreadFilter')).toBe('palette.filterUnreadOn');
    expect(label('starredFilter')).toBe('palette.filterStarredOn');
    cleanup();
    show({ state: { filter: 'unread' } });
    expect(label('unreadFilter')).toBe('palette.filterUnreadOff');
    cleanup();
    show({ state: { filter: 'starred' } });
    expect(label('starredFilter')).toBe('palette.filterStarredOff');
  });

  // « Aléatoire » au libellé fixe faisait QUITTER le tirage une fois dedans,
  // bouton masqué, sans que rien ne le dise (campagne 1.9.0, L-18).
  it('Aléatoire dit s’il entre dans le tirage ou en sort', () => {
    const label = () => probeToolbarCommands().find((o) => o.command === 'random')?.label;
    show({ hidden: ['random'] });
    expect(label()).toBe('palette.randomOn');
    cleanup();
    show({ hidden: ['random'], state: { randomView: true } });
    expect(label()).toBe('palette.randomOff');
  });
});

// Aléatoire masqué, un tirage en cours ne se voyait nulle part : la liste
// paraissait en désordre (campagne 1.9.0, L-18).
describe('tirage aléatoire, bouton masqué', () => {
  const chip = (c: ReturnType<typeof render>) => c.queryByRole('button', { name: /^articleList\.random palette\.randomOff$/ });

  it.each(['3', '2'] as const)('%s colonnes : un repère à côté du titre, qui fait sortir du tirage', (layout) => {
    const setRandomView = vi.fn();
    const c = show({ layout, hidden: ['random'], state: { randomView: true, setRandomView } });
    const el = chip(c);
    expect(el?.textContent).toContain('articleList.random');
    fireEvent.click(el!);
    expect(setRandomView).toHaveBeenCalledWith(false);
  });

  // Relecture 1.9.0 : la pastille disparaît au clic, le focus tombait sur
  // <body>. Il passe à la liste, comme « Nouveau tirage ».
  it('sortir du tirage par la pastille met le focus sur la liste', () => {
    const setRandomView = (on: boolean) => useFeedStore.setState({ randomView: on } as never);
    const c = show({ hidden: ['random'], state: { randomView: true, setRandomView } });
    const el = chip(c)!;
    act(() => { el.focus(); });
    act(() => { fireEvent.click(el); });
    expect(chip(c)).toBeNull();
    expect(document.activeElement).toBe(c.container.querySelector('[data-article-scroll]'));
  });

  it('aucun repère hors tirage, ni quand le bouton est là pour le dire', () => {
    expect(chip(show({ hidden: ['random'] }))).toBeNull();
    cleanup();
    expect(chip(show({ state: { randomView: true } }))).toBeNull();
  });
});

// L-27 : les filtres Non lus et Favoris sont des bascules. En icône seule
// (tablette, mobile), leur état ne passait que par la couleur du fond.
describe('les filtres Non lus et Favoris annoncent leur état (L-27)', () => {
  const where = [
    ['desktop, 3 colonnes', 'desktop', '3'],
    ['desktop, 2 colonnes', 'desktop', '2'],
    ['desktop, grille', 'desktop', 'grid'],
    ['tablette', 'tablet', '3'],
    ['mobile', 'mobile', '3'],
  ] as const;

  it.each(where)('%s : aria-pressed suit le filtre, nom fixe', (_name, breakpoint, layout) => {
    bp.value = breakpoint;
    const pressed = (c: ReturnType<typeof render>, name: string) => btn(c, name)?.getAttribute('aria-pressed');
    let c = show({ layout });
    expect(pressed(c, 'articleList.unread')).toBe('false');
    expect(pressed(c, 'articleList.starred')).toBe('false');
    cleanup();
    c = show({ layout, state: { filter: 'unread' } });
    expect(pressed(c, 'articleList.unread')).toBe('true');
    expect(pressed(c, 'articleList.starred')).toBe('false');
    cleanup();
    c = show({ layout, state: { filter: 'starred' } });
    expect(pressed(c, 'articleList.unread')).toBe('false');
    expect(pressed(c, 'articleList.starred')).toBe('true');
  });
});

// L-10 : sur un écran large tactile sans clavier (iPad paysage), la barre
// latérale ET la barre de la liste masquées ne laissaient plus rien pour
// rouvrir la barre latérale (le ☰ vit dans la barre de la liste, `b` et la
// palette demandent un clavier). Décision du 2026-11-05 : un ☰ de secours, dans
// ce seul cas.
describe('☰ de secours, barre latérale et barre de la liste masquées (L-10)', () => {
  const menus = (c: ReturnType<typeof render>) => c.queryAllByRole('button', { name: 'sidebar.showSidebar' });

  it.each(['3', '2', 'grid'] as const)('desktop, disposition %s : un ☰ en haut de la liste rouvre la barre latérale', (layout) => {
    const c = show({ layout, hidden: ['listBar'], sidebar: false });
    expect(menus(c)).toHaveLength(1);
    expect(c.container.querySelector('.article-list-header')).toBeNull();
    fireEvent.click(menus(c)[0]);
    expect(useUiStore.getState().sidebarVisible).toBe(true);
  });

  // Relecture 1.9.0 : le ☰ disparaît au clic, le focus tombait sur <body>. Il
  // passe dans la barre latérale ouverte.
  it('le ☰ de secours met le focus dans la barre latérale qu’il ouvre', () => {
    function SidebarStub() {
      const open = useUiStore((s) => s.sidebarVisible);
      return open ? <div className="sidebar"><button>header</button><nav><button>tous</button></nav></div> : null;
    }
    show({ hidden: ['listBar'], sidebar: false });
    cleanup();
    const c = render(<><SidebarStub /><ArticleList /></>);
    const menu = menus(c)[0];
    act(() => { menu.focus(); });
    act(() => { fireEvent.click(menu); });
    expect(menus(c)).toHaveLength(0);
    expect(document.activeElement).toBe(c.getByText('tous'));
  });

  it('barre latérale visible : pas de ☰', () => {
    expect(menus(show({ hidden: ['listBar'], sidebar: true }))).toHaveLength(0);
  });

  it('barre de la liste visible : seul le ☰ de la barre, pas de second', () => {
    const c = show({ sidebar: false });
    expect(menus(c)).toHaveLength(1);
    expect(menus(c)[0].closest('.article-list-header')).not.toBeNull();
  });

  it('recherche ouverte sans la barre : le ☰ reste, sous la zone de recherche', () => {
    const c = show({ hidden: ['listBar'], sidebar: false, state: { searchQuery: 'rust' } });
    expect(menus(c)).toHaveLength(1);
    expect(menus(c)[0].closest('.article-list-header')).toBeNull();
  });

  it('tablette : le réglage est ignoré, le ☰ reste celui de la barre', () => {
    bp.value = 'tablet';
    const c = show({ hidden: ['listBar'], sidebar: false });
    expect(menus(c)).toHaveLength(1);
    expect(menus(c)[0].closest('.article-list-header')).not.toBeNull();
  });
});

// Relecture 1.9.0 : en 2 colonnes, le titre et le compte de non-lus vivent
// dans la barre repliée. Un autre titre (ou un compte qui grandit) déplace
// le passage à la ligne sans changer la taille de la barre : les traits
// orphelins restaient marqués selon l'ancien titre.
describe('traits orphelins remesurés quand le titre change', () => {
  it('2 colonnes : un autre titre, un autre compte de non-lus → nouvelle mesure', () => {
    show({ layout: '2' });
    vi.mocked(markOrphanSeparators).mockClear();
    act(() => { useFeedStore.setState({ selectedFeed: { ...FEED, title: 'Un titre bien plus long que le précédent' } } as never); });
    expect(markOrphanSeparators).toHaveBeenCalled();
    vi.mocked(markOrphanSeparators).mockClear();
    act(() => { useFeedStore.setState({ unreadCounts: { 'feed/1': 1234 } } as never); });
    expect(markOrphanSeparators).toHaveBeenCalled();
  });
});
