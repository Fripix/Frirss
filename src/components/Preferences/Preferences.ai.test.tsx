// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

const bp = vi.hoisted(() => {
  if (typeof window !== 'undefined' && !window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (q: string) => ({
        matches: false, media: q, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
      }),
    });
  }
  return { value: 'desktop' as 'mobile' | 'tablet' | 'desktop' };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'fr', changeLanguage: () => {} } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => bp.value }));
// Les sections ne sont pas sous test : seul l'en-tête compte ici.
vi.mock('./FeedsTab', () => ({ default: () => null }));
vi.mock('./AdminTab', () => ({ default: () => null }));
vi.mock('./OfflineTab', () => ({ default: () => null }));
vi.mock('./LabelsTab', () => ({ default: () => null }));
vi.mock('./GeneralTab', () => ({ default: () => null }));
vi.mock('./AppearanceTab', () => ({ default: () => null }));
vi.mock('./LayoutTab', () => ({ default: () => null }));
vi.mock('./AiTab', () => ({ default: () => null }));

import Preferences from './Preferences';
import { useThemeStore, SHIPPED_THEMES } from '../../stores/themeStore';
import { useAuthStore } from '../../stores/authStore';
import { useAiStore } from '../../stores/aiStore';

afterEach(() => { cleanup(); useAiStore.getState().reset(); });

const config = (enabled: boolean) => ({ enabled, providers: [], userKeysAllowed: false, dailyCap: 0, usageToday: 0, defaultProvider: null });

function renderAs(role: 'admin' | 'user', enabled: boolean) {
  bp.value = 'desktop';
  useThemeStore.setState({ savedThemes: SHIPPED_THEMES });
  useAuthStore.setState({ backendUser: { id: 1, username: 'u', role } });
  useAiStore.setState({ config: config(enabled) });
  return render(<Preferences />);
}

describe('Préférences — section IA dans la navigation', () => {
  it('is hidden from a user while the feature is off', () => {
    renderAs('user', false);
    expect(screen.queryByText('preferences.sections.ai')).toBeNull();
  });
  it('is shown to a user once the feature is on', () => {
    renderAs('user', true);
    expect(screen.getByText('preferences.sections.ai')).toBeTruthy();
  });
  it('is always shown to the admin, even while the feature is off', () => {
    renderAs('admin', false);
    expect(screen.getByText('preferences.sections.ai')).toBeTruthy();
  });
});
