// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import ShortcutBar from './ShortcutBar';
import { useUiStore } from '../stores/uiStore';
import { useFeedStore } from '../stores/feedStore';
import { useAiStore } from '../stores/aiStore';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
// Desktop-only bar — force the breakpoint.
vi.mock('../hooks/useBreakpoint', () => ({ useBreakpoint: () => 'desktop' }));

const article = { id: 'a1', title: 'T' } as never;

beforeEach(() => {
  useUiStore.setState({ readingFocus: false, panelLayout: '3' });
  useFeedStore.setState({ selectedArticle: null });
  useAiStore.setState({ config: null });
});
afterEach(cleanup);

describe('ShortcutBar — Escape hint', () => {
  it('is hidden in the plain list view', () => {
    const { queryByText } = render(<ShortcutBar />);
    expect(queryByText('preferences.shortcuts.escExitFocus')).toBeNull();
    expect(queryByText('preferences.shortcuts.escBackToGrid')).toBeNull();
  });

  it('offers "exit focus" while Reading Focus is active', () => {
    useUiStore.setState({ readingFocus: true });
    const { getByText } = render(<ShortcutBar />);
    expect(getByText('preferences.shortcuts.escExitFocus')).toBeTruthy();
  });

  it('offers "back to grid" with an article open in grid layout', () => {
    useUiStore.setState({ panelLayout: 'grid' });
    useFeedStore.setState({ selectedArticle: article });
    const { getByText } = render(<ShortcutBar />);
    expect(getByText('preferences.shortcuts.escBackToGrid')).toBeTruthy();
  });

  it('stays hidden in grid layout while no article is open', () => {
    useUiStore.setState({ panelLayout: 'grid' });
    const { queryByText } = render(<ShortcutBar />);
    expect(queryByText('preferences.shortcuts.escBackToGrid')).toBeNull();
  });
});

describe('ShortcutBar — summarize hint', () => {
  const provider = { id: 1, name: 'P', type: 'openai' as const, hasAdminKey: false, shared: false, hasUserKey: false, available: true };
  const cfg = { enabled: true, providers: [provider], userKeysAllowed: false, dailyCap: 0, usageToday: 0, defaultProvider: 1 };

  it('is hidden while AI is off or not loaded', () => {
    useFeedStore.setState({ selectedArticle: article });
    const { queryByText } = render(<ShortcutBar />);
    expect(queryByText('preferences.shortcuts.summarize')).toBeNull();
  });

  it('is hidden while no provider is usable', () => {
    useAiStore.setState({ config: { ...cfg, providers: [{ ...provider, available: false }] } });
    useFeedStore.setState({ selectedArticle: article });
    const { queryByText } = render(<ShortcutBar />);
    expect(queryByText('preferences.shortcuts.summarize')).toBeNull();
  });

  it('shows next to the reading shortcuts once AI is usable', () => {
    useAiStore.setState({ config: cfg });
    useFeedStore.setState({ selectedArticle: article });
    const { getByText } = render(<ShortcutBar />);
    expect(getByText('preferences.shortcuts.summarize')).toBeTruthy();
  });

  it('stays out of the list context, where no article is open', () => {
    useAiStore.setState({ config: cfg });
    const { queryByText } = render(<ShortcutBar />);
    expect(queryByText('preferences.shortcuts.summarize')).toBeNull();
  });

  it('the translate hint follows the same rule: reading context, AI usable', () => {
    useFeedStore.setState({ selectedArticle: article });
    const off = render(<ShortcutBar />);
    expect(off.queryByText('preferences.shortcuts.translate')).toBeNull();
    cleanup();
    useAiStore.setState({ config: cfg });
    const on = render(<ShortcutBar />);
    expect(on.getByText('preferences.shortcuts.translate')).toBeTruthy();
  });
});

describe('ShortcutBar — an action without a key', () => {
  it('shows no empty key chip', () => {
    const before = useUiStore.getState().shortcuts;
    useUiStore.setState({ shortcuts: { ...before, markRead: '' } });
    useFeedStore.setState({ selectedArticle: { id: 'a1' } as never });
    const { container } = render(<ShortcutBar />);
    expect(Array.from(container.querySelectorAll('kbd')).some((k) => k.textContent === '')).toBe(false);
    expect(container.textContent).not.toContain('preferences.shortcuts.markRead');
    useUiStore.setState({ shortcuts: before });
  });
});

// À 1280 px avec un article ouvert, la barre débordait : barre de défilement
// horizontale et raccourcis du bout cachés, palette et aide comprises. Les
// raccourcis du contexte tiennent sur une ligne et ceux qui ne tiennent pas
// passent à la ligne suivante, rognée ; la palette et l'aide restent hors de
// cette zone, donc toujours visibles.
describe('ShortcutBar — largeur insuffisante', () => {
  it('ne défile plus et garde la palette et l’aide hors de la zone rognée', () => {
    useFeedStore.setState({ selectedArticle: article });
    const { container, getByText } = render(<ShortcutBar />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).not.toContain('overflow-x-auto');
    const context = container.querySelector('[data-shortcut-context]') as HTMLElement;
    expect(context.className).toMatch(/\bflex-wrap\b/);
    expect(context.className).toMatch(/\boverflow-hidden\b/);
    expect(context.className).toMatch(/\bh-\[18px\]/);
    expect(context.contains(getByText('preferences.shortcuts.nextArticle'))).toBe(true);
    expect(context.contains(getByText('palette.title'))).toBe(false);
    expect(context.contains(getByText('preferences.shortcuts.helpTitle'))).toBe(false);
  });
});

describe('ShortcutBar — priorité dans la zone rognée', () => {
  it('Échap passe en tête : la sortie du mode Focus ne disparaît pas la première', () => {
    useUiStore.setState({ readingFocus: true });
    useFeedStore.setState({ selectedArticle: article });
    const { container } = render(<ShortcutBar />);
    const context = container.querySelector('[data-shortcut-context]') as HTMLElement;
    expect(context.firstElementChild?.textContent).toContain('preferences.shortcuts.escExitFocus');
  });
});
