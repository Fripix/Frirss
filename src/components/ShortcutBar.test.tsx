// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import ShortcutBar from './ShortcutBar';
import { useUiStore } from '../stores/uiStore';
import { useFeedStore } from '../stores/feedStore';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
// Desktop-only bar — force the breakpoint.
vi.mock('../hooks/useBreakpoint', () => ({ useBreakpoint: () => 'desktop' }));

const article = { id: 'a1', title: 'T' } as never;

beforeEach(() => {
  useUiStore.setState({ readingFocus: false, panelLayout: '3' });
  useFeedStore.setState({ selectedArticle: null });
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
