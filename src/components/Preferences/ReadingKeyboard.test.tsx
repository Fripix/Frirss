// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

// Translations aren't under test here — return the key so assertions are stable.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'fr', changeLanguage: vi.fn() } }),
}));
vi.mock('../../i18n', () => ({ loadLanguage: vi.fn() }));
// The view on screen is feed/A; the real feedStore would pull in the API layer.
vi.mock('../../stores/feedStore', () => ({
  useFeedStore: { getState: () => ({ selectedFeed: { id: 'feed/A' } }) },
}));

import ReadingTab from './ReadingTab';
import KeyboardTab from './KeyboardTab';
import { useUiStore } from '../../stores/uiStore';

describe('ReadingTab — portée du filtre Non lus', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ unreadOnlyScope: 'feed', unreadOnlyAll: false, unreadOnlyByFeed: { 'feed/A': true } });
  });

  afterEach(() => {
    cleanup();
    useUiStore.setState({ unreadOnlyScope: 'feed', unreadOnlyAll: false, unreadOnlyByFeed: {} });
  });

  it('marks the active scope as checked', () => {
    const { getByRole } = render(<ReadingTab />);
    expect(getByRole('radio', { name: 'preferences.general.unreadScopeFeed' }).getAttribute('aria-checked')).toBe('true');
    expect(getByRole('radio', { name: 'preferences.general.unreadScopeAll' }).getAttribute('aria-checked')).toBe('false');
  });

  it('gives the checked segment a readable label colour', () => {
    const { getByRole } = render(<ReadingTab />);
    const checked = getByRole('radio', { name: 'preferences.general.unreadScopeFeed' }) as HTMLElement;
    expect(checked.style.color).toBe('var(--on-accent)');
  });

  it('switching to all feeds takes the choice of the view on screen', () => {
    const { getByRole } = render(<ReadingTab />);
    fireEvent.click(getByRole('radio', { name: 'preferences.general.unreadScopeAll' }));
    const s = useUiStore.getState();
    expect(s.unreadOnlyScope).toBe('all');
    expect(s.unreadOnlyAll).toBe(true); // feed/A, on screen, was unread-only
    expect(getByRole('radio', { name: 'preferences.general.unreadScopeAll' }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('KeyboardTab — éditeur de raccourcis', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.getState().resetShortcuts();
  });
  afterEach(cleanup);

  // The markRead row's button shows its key (`R`); clicking it starts the capture.
  function startCapture(getByText: (t: string) => HTMLElement): HTMLElement {
    const button = getByText('R');
    fireEvent.click(button);
    return button;
  }

  it.each(['F5', 'F12', 'Tab', ' ', 'Enter', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', '/', "'", '?'])(
    'refuses %j, keeps the shortcut and says why',
    (key) => {
      const { getByText, queryByText } = render(<KeyboardTab />);
      const button = startCapture(getByText);
      fireEvent.keyDown(button, { key });
      expect(useUiStore.getState().shortcuts.markRead).toBe('r');
      expect(queryByText('preferences.shortcuts.keyReserved')).not.toBeNull();
    },
  );

  it('refuses a key held with ⌘, Ctrl or Alt, and leaves it to the browser', () => {
    const { getByText, queryByText } = render(<KeyboardTab />);
    const button = startCapture(getByText);
    const notCancelled = fireEvent.keyDown(button, { key: 'x', ctrlKey: true });
    expect(notCancelled).toBe(true);
    expect(useUiStore.getState().shortcuts.markRead).toBe('r');
    expect(queryByText('preferences.shortcuts.keyReserved')).not.toBeNull();
  });

  it('refuses a key already given to another action', () => {
    const { getByText, queryByText } = render(<KeyboardTab />);
    const button = startCapture(getByText);
    fireEvent.keyDown(button, { key: 'd' });
    expect(useUiStore.getState().shortcuts.markRead).toBe('r');
    expect(useUiStore.getState().shortcuts.toggleStar).toBe('d');
    expect(queryByText('preferences.shortcuts.keyTaken')).not.toBeNull();
  });

  it('accepts an arrow key', () => {
    const { getByText, queryByText } = render(<KeyboardTab />);
    const button = startCapture(getByText);
    fireEvent.keyDown(button, { key: 'ArrowLeft' });
    expect(useUiStore.getState().shortcuts.markRead).toBe('ArrowLeft');
    expect(queryByText('preferences.shortcuts.keyReserved')).toBeNull();
  });

  it('accepts a free letter', () => {
    const { getByText } = render(<KeyboardTab />);
    const button = startCapture(getByText);
    fireEvent.keyDown(button, { key: 'x' });
    expect(useUiStore.getState().shortcuts.markRead).toBe('x');
  });

  it('Escape cancels the capture and clears the message', () => {
    const { getByText, queryByText } = render(<KeyboardTab />);
    const button = startCapture(getByText);
    fireEvent.keyDown(button, { key: 'F5' });
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(useUiStore.getState().shortcuts.markRead).toBe('r');
    expect(queryByText('preferences.shortcuts.keyReserved')).toBeNull();
    expect(getByText('R')).toBeTruthy();
  });
});

describe('KeyboardTab — a shortcut without a key', () => {
  it('says so on its button, never an empty button', () => {
    const before = useUiStore.getState().shortcuts;
    useUiStore.setState({ shortcuts: { ...before, summarize: '' } });
    const { getAllByText } = render(<KeyboardTab />);
    expect(getAllByText('preferences.shortcuts.unassigned').length).toBe(1);
    useUiStore.setState({ shortcuts: before });
    cleanup();
  });
});
