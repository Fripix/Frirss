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
