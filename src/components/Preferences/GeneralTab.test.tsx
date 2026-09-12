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

import GeneralTab from './GeneralTab';
import { useUiStore } from '../../stores/uiStore';

describe('GeneralTab — portée du filtre Non lus', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ unreadOnlyScope: 'feed', unreadOnlyAll: false, unreadOnlyByFeed: { 'feed/A': true } });
  });

  afterEach(() => {
    cleanup();
    useUiStore.setState({ unreadOnlyScope: 'feed', unreadOnlyAll: false, unreadOnlyByFeed: {} });
  });

  it('marks the active scope as checked', () => {
    const { getByRole } = render(<GeneralTab />);
    expect(getByRole('radio', { name: 'preferences.general.unreadScopeFeed' }).getAttribute('aria-checked')).toBe('true');
    expect(getByRole('radio', { name: 'preferences.general.unreadScopeAll' }).getAttribute('aria-checked')).toBe('false');
  });

  it('gives the checked segment a readable label colour', () => {
    const { getByRole } = render(<GeneralTab />);
    const checked = getByRole('radio', { name: 'preferences.general.unreadScopeFeed' }) as HTMLElement;
    expect(checked.style.color).toBe('var(--on-accent)');
  });

  it('switching to all feeds takes the choice of the view on screen', () => {
    const { getByRole } = render(<GeneralTab />);
    fireEvent.click(getByRole('radio', { name: 'preferences.general.unreadScopeAll' }));
    const s = useUiStore.getState();
    expect(s.unreadOnlyScope).toBe('all');
    expect(s.unreadOnlyAll).toBe(true); // feed/A, on screen, was unread-only
    expect(getByRole('radio', { name: 'preferences.general.unreadScopeAll' }).getAttribute('aria-checked')).toBe('true');
  });
});
