// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import CommandPalette from './CommandPalette';
import { useUiStore } from '../stores/uiStore';
import { useFeedStore } from '../stores/feedStore';
import { useAiStore } from '../stores/aiStore';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const provider = { id: 1, name: 'P', type: 'openai' as const, hasAdminKey: false, shared: false, hasUserKey: false, available: true };
const ON = { enabled: true, providers: [provider], userKeysAllowed: false, dailyCap: 0, usageToday: 0, defaultProvider: 1 };
const article = { id: 'a1', title: 'T' } as never;
const LABEL = 'preferences.shortcuts.summarize';

beforeEach(() => {
  // jsdom has no layout: the palette scrolls its cursor row into view.
  Element.prototype.scrollIntoView = vi.fn();
  useUiStore.setState({ commandPaletteOpen: true });
  useFeedStore.setState({ selectedArticle: article });
  useAiStore.setState({ config: ON });
});
afterEach(cleanup);

describe('CommandPalette — summarize action', () => {
  it('is offered when an article is open and AI is usable', () => {
    const { getByText } = render(<CommandPalette />);
    expect(getByText(LABEL)).toBeTruthy();
  });

  it('is not offered without an open article', () => {
    useFeedStore.setState({ selectedArticle: null });
    const { queryByText } = render(<CommandPalette />);
    expect(queryByText(LABEL)).toBeNull();
  });

  it('is not offered while AI is off', () => {
    useAiStore.setState({ config: { ...ON, enabled: false } });
    const { queryByText } = render(<CommandPalette />);
    expect(queryByText(LABEL)).toBeNull();
  });

  it('is not offered while no provider is usable', () => {
    useAiStore.setState({ config: { ...ON, providers: [{ ...provider, available: false }] } });
    const { queryByText } = render(<CommandPalette />);
    expect(queryByText(LABEL)).toBeNull();
  });

  it('closes the palette and broadcasts the summarize event when chosen', () => {
    const heard = vi.fn();
    window.addEventListener('frirss:ai-summarize', heard);
    const { getByText } = render(<CommandPalette />);
    fireEvent.click(getByText(LABEL));
    window.removeEventListener('frirss:ai-summarize', heard);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().commandPaletteOpen).toBe(false);
  });
});
