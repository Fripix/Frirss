// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'fr', changeLanguage: vi.fn() } }),
}));
vi.mock('../../i18n', () => ({ loadLanguage: vi.fn() }));
vi.mock('../../stores/feedStore', () => ({
  useFeedStore: { getState: () => ({ selectedFeed: null }) },
}));

import GeneralTab from './GeneralTab';
import { useUiStore } from '../../stores/uiStore';

describe('GeneralTab — signaler les nouveaux articles', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ showNewArticlesPill: true });
  });

  afterEach(() => {
    cleanup();
    useUiStore.setState({ showNewArticlesPill: true });
  });

  it('shows the setting on, and turns it off', () => {
    render(<GeneralTab />);
    const toggle = screen.getByLabelText('preferences.general.newArticlesPill');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    expect(useUiStore.getState().showNewArticlesPill).toBe(false);
  });
});
