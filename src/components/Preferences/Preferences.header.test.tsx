// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react';
import { CONFIRM_GRACE_MS } from '../ConfirmDialog';

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

afterEach(cleanup);

const themeShortcut = () => document.querySelector('.prefs-panel-head select');

function renderAt(breakpoint: 'mobile' | 'tablet' | 'desktop') {
  bp.value = breakpoint;
  useThemeStore.setState({ savedThemes: SHIPPED_THEMES });
  return render(<Preferences />);
}

describe('Préférences — en-tête', () => {
  it('keeps the theme shortcut in the header on tablet and desktop', () => {
    for (const breakpoint of ['desktop', 'tablet'] as const) {
      renderAt(breakpoint);
      expect(themeShortcut()).not.toBeNull();
      cleanup();
    }
  });

  it('drops the theme shortcut on a phone, where it covered « Tout réinitialiser » at 320 px', () => {
    // Mesuré à 320 px : le sélecteur (137→213) chevauchait le bouton (159→252).
    // Les thèmes restent tous accessibles dans la section Apparence.
    renderAt('mobile');
    expect(themeShortcut()).toBeNull();
    expect(screen.getByText('preferences.resetTheme')).toBeTruthy();
    expect(screen.getByLabelText('app.close')).toBeTruthy();
  });

  // « Tout réinitialiser » devenait « Confirmer ? » pendant 3 s à la même
  // place : un double-clic validait. Et il promettait de tout remettre à zéro
  // (« couleurs, tailles, raccourcis… ») alors qu'il ne rétablit que le thème.
  it('réinitialiser le thème passe par une confirmation, qu’un double-clic ne valide pas', async () => {
    renderAt('desktop');
    const resetToDefault = vi.fn();
    useThemeStore.setState({ resetToDefault });
    const button = screen.getByText('preferences.resetTheme');
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'preferences.resetThemeConfirm' }));
    expect(resetToDefault).not.toHaveBeenCalled();
    expect(screen.getByText('preferences.resetThemeTitle')).toBeTruthy();
    await act(async () => { await new Promise((r) => setTimeout(r, CONFIRM_GRACE_MS + 30)); });
    fireEvent.click(screen.getByRole('button', { name: 'preferences.resetThemeConfirm' }));
    expect(resetToDefault).toHaveBeenCalledTimes(1);
  });
});
