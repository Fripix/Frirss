// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { createPortal } from 'react-dom';

const store = vi.hoisted(() => ({
  selectedArticle: { id: 'a1', read: false, url: 'https://example.com/a' } as { id: string; read: boolean; url: string } | null,
  selectedFeed: null,
  articles: [],
  selectNextArticle: vi.fn(),
  selectPrevArticle: vi.fn(),
  selectArticle: vi.fn(),
  toggleRead: vi.fn(),
  toggleStar: vi.fn(),
  toggleReadLater: vi.fn(),
  // Ce que lisent les surfaces flottantes rendues pour de bon plus bas.
  labels: [],
  toggleArticleLabel: vi.fn(),
  feedErrors: {},
  refreshResult: null,
  loadArticles: vi.fn(),
}));
vi.mock('../stores/feedStore', () => ({
  useFeedStore: Object.assign((sel: (s: unknown) => unknown) => sel(store), { getState: () => store }),
  READ_LATER_LABEL: 'user/-/label/Read later',
  getSampleArticleUrl: () => undefined,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('../lib/openExternal', () => ({ openExternal: vi.fn() }));

import { useKeyboardNav } from './useKeyboardNav';
import { useUiStore } from '../stores/uiStore';
import { openExternal } from '../lib/openExternal';
import { useAiStore } from '../stores/aiStore';
import ArticleContextMenu from '../components/ArticleList/ArticleContextMenu';
import SavedCategoryPicker from '../components/ArticleList/SavedCategoryPicker';
import Popover from '../components/ReadingPane/Popover';
import { FeedContextMenu } from '../components/Sidebar/Sidebar';
import type { Article, Subscription } from '../types';

function Harness() {
  useKeyboardNav();
  return null;
}

function press(init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init });
  window.dispatchEvent(e);
  return e;
}

describe('useKeyboardNav — the browser keeps its keys', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.getState().resetShortcuts();
    useUiStore.setState({ shortcutHelpOpen: false, commandPaletteOpen: false, sidebarVisible: true });
    store.selectedArticle = { id: 'a1', read: false, url: 'https://example.com/a' };
    vi.clearAllMocks();
    render(<Harness />);
  });
  afterEach(cleanup);

  it('handles a plain shortcut key', () => {
    const e = press({ key: 'r' });
    expect(store.toggleRead).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it.each([
    ['metaKey', 'r'], ['ctrlKey', 'r'], ['altKey', 'r'],
    ['metaKey', 'l'], ['ctrlKey', 'd'], ['ctrlKey', 'b'], ['metaKey', 'o'], ['ctrlKey', 'u'], ['metaKey', 'f'],
  ])('leaves %s+%s to the browser', (mod, key) => {
    const listener = vi.fn();
    window.addEventListener('frirss:open-search', listener);
    const sidebarBefore = useUiStore.getState().sidebarVisible;
    const e = press({ key, [mod]: true });
    window.removeEventListener('frirss:open-search', listener);
    expect(e.defaultPrevented).toBe(false);
    expect(store.toggleRead).not.toHaveBeenCalled();
    expect(store.toggleStar).not.toHaveBeenCalled();
    expect(store.toggleReadLater).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(useUiStore.getState().sidebarVisible).toBe(sidebarBefore);
  });

  it('leaves a modified arrow to the browser', () => {
    const e = press({ key: 'ArrowDown', altKey: true });
    expect(store.selectNextArticle).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it('leaves a modified ? to the browser', () => {
    const e = press({ key: '?', metaKey: true, shiftKey: true });
    expect(useUiStore.getState().shortcutHelpOpen).toBe(false);
    expect(e.defaultPrevented).toBe(false);
  });

  it.each(['d', 'l', 'o', 'b', '?'])('does not repeat the toggle on %j when the key is held', (key) => {
    const sidebarBefore = useUiStore.getState().sidebarVisible;
    const e = press({ key, repeat: true });
    expect(e.defaultPrevented).toBe(false);
    expect(store.toggleStar).not.toHaveBeenCalled();
    expect(store.toggleReadLater).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
    expect(useUiStore.getState().sidebarVisible).toBe(sidebarBefore);
    expect(useUiStore.getState().shortcutHelpOpen).toBe(false);
  });

  it('keeps moving through the list while an arrow is held', () => {
    press({ key: 'ArrowDown', repeat: true });
    press({ key: 'ArrowDown', repeat: true });
    expect(store.selectNextArticle).toHaveBeenCalledTimes(2);
  });

  it('still opens the palette on ⌘K', () => {
    const e = press({ key: 'k', metaKey: true });
    expect(useUiStore.getState().commandPaletteOpen).toBe(true);
    expect(e.defaultPrevented).toBe(true);
  });
});

// Une surface flottante ouverte possède le clavier, QUEL QUE SOIT le focus.
// Le menu contextuel d'article n'a pas de role (boutons simples, voulu),
// FeedContextMenu et SavedCategoryPicker sont des portails nus, et un Popover
// peut rester ouvert pendant que le focus est ailleurs : la garde sur
// `[role="dialog"]` / `[role="menu"]` focalisé ne voyait aucun des quatre, et
// `s` / `t` lançaient un appel d'IA payant derrière le menu.
describe('useKeyboardNav — sous une surface flottante', () => {
  const noop = () => {};
  const yes = async () => true;
  const article = { id: 'a1', title: 'T', url: 'https://example.com/a', read: false, starred: false, labels: [] } as unknown as Article;
  const feed = { id: 'feed/1', title: 'The Register' } as Subscription;
  const provider = { id: 1, name: 'P', type: 'openai' as const, hasAdminKey: false, shared: false, hasUserKey: false, available: true };

  const SURFACES: Record<string, () => React.ReactElement> = {
    'le menu contextuel d\'article': () => (
      <ArticleContextMenu
        article={article} isReadLater={false} canMarkRange x={30} y={40} sheet={false}
        onClose={noop} onOpenSource={noop} onToggleRead={noop} onMarkRange={noop}
        onToggleStar={noop} onToggleReadLater={noop} onCopyLink={noop}
      />
    ),
    'le menu d\'un flux': () => <FeedContextMenu feed={feed} x={20} y={20} onRename={yes} onDelete={yes} onClose={noop} />,
    'le sélecteur de catégorie': () => <SavedCategoryPicker prefix="saved/" article={article} anchor={{ x: 50, y: 50 }} onClose={noop} />,
    'un Popover': () => createPortal(
      <Popover anchor={null} onClose={noop} label="Traduire"><button role="menuitem">fr</button></Popover>,
      document.body,
    ),
  };

  // Trois touches qui agissent hors surface : suivant (flèche), résumer, traduire.
  function pressAll(): { next: number; ai: Event[] } {
    const ai: Event[] = [];
    const on = (e: Event) => { ai.push(e); };
    window.addEventListener('frirss:ai-summarize', on);
    window.addEventListener('frirss:ai-translate', on);
    store.selectNextArticle.mockClear();
    press({ key: 'ArrowDown' });
    press({ key: 's' });
    press({ key: 't' });
    window.removeEventListener('frirss:ai-summarize', on);
    window.removeEventListener('frirss:ai-translate', on);
    return { next: store.selectNextArticle.mock.calls.length, ai };
  }

  beforeEach(() => {
    localStorage.clear();
    useUiStore.getState().resetShortcuts();
    useUiStore.setState({ shortcutHelpOpen: false, commandPaletteOpen: false, sidebarVisible: true });
    vi.clearAllMocks();
    render(<Harness />);
    useAiStore.setState({
      config: { enabled: true, providers: [provider], userKeysAllowed: false, dailyCap: 0, usageToday: 0, defaultProvider: 1 },
    });
  });

  afterEach(cleanup);

  it('les touches agissent quand aucune surface n\'est ouverte (témoin)', () => {
    const { next, ai } = pressAll();
    expect(next).toBe(1);
    expect(ai).toHaveLength(2);
  });

  it.each(Object.keys(SURFACES))('coupe les raccourcis tant que %s est ouvert, focus ailleurs', (name) => {
    const view = render(SURFACES[name]());
    (document.activeElement as HTMLElement | null)?.blur?.();
    const open = pressAll();
    expect(open.next).toBe(0);
    expect(open.ai).toHaveLength(0);
    expect(document.querySelector('[data-floating-surface]')).not.toBeNull();
    view.unmount();
    // Refermée, plus rien ne retient les touches : une surface qui resterait
    // marquée après son démontage couperait le clavier pour toujours.
    expect(document.querySelector('[data-floating-surface]')).toBeNull();
    const closed = pressAll();
    expect(closed.next).toBe(1);
    expect(closed.ai).toHaveLength(2);
  });

  // Le corps d'un article peut porter l'attribut (DOMPurify garde les
  // `data-*`) : il ne doit pas couper le clavier tant que l'article est
  // ouvert — même piège que `role="dialog"` dans le corps.
  it('ignore un data-floating-surface venu du corps de l\'article', () => {
    const body = document.createElement('div');
    body.className = 'article-content';
    body.innerHTML = '<div data-floating-surface>pub</div>';
    document.body.appendChild(body);
    try {
      const { next, ai } = pressAll();
      expect(next).toBe(1);
      expect(ai).toHaveLength(2);
    } finally {
      body.remove();
    }
  });

  it('garde ⌘K au-dessus des surfaces flottantes', () => {
    render(SURFACES['un Popover']());
    press({ key: 'k', metaKey: true });
    expect(useUiStore.getState().commandPaletteOpen).toBe(true);
  });
});
