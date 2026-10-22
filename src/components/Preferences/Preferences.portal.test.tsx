// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, within } from '@testing-library/react';

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
  return {};
});
void bp;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o?.name ? `${k}:${String(o.name)}` : k), i18n: { language: 'fr', changeLanguage: () => {} } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => 'desktop' }));
vi.mock('../../api/backend', () => ({
  getAiProviders: vi.fn(), createAiProvider: vi.fn(), updateAiProvider: vi.fn(), deleteAiProvider: vi.fn(),
  reorderAiProviders: vi.fn(), testAiProvider: vi.fn(), updateAiSettings: vi.fn(), getAiConfig: vi.fn(), listAiModels: vi.fn(), setAiUserKey: vi.fn(),
}));
// Les autres sections ne sont pas sous test.
vi.mock('./FeedsTab', () => ({ default: () => null }));
vi.mock('./AdminTab', () => ({ default: () => null }));
vi.mock('./OfflineTab', () => ({ default: () => null }));
vi.mock('./LabelsTab', () => ({ default: () => null }));
vi.mock('./GeneralTab', () => ({ default: () => null }));
vi.mock('./AppearanceTab', () => ({ default: () => null }));
vi.mock('./LayoutTab', () => ({ default: () => null }));

import { getAiProviders, getAiConfig } from '../../api/backend';
import Preferences from './Preferences';
import { useThemeStore, SHIPPED_THEMES } from '../../stores/themeStore';
import { useAuthStore } from '../../stores/authStore';
import { useAiStore } from '../../stores/aiStore';

const mk = (id: number, name: string, position: number) => ({ id, name, type: 'openai' as const, baseUrl: 'http://o', model: 'm', hasAdminKey: false, shared: true, position });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAiProviders).mockResolvedValue({ providers: [mk(7, 'Ollama', 0), mk(8, 'Other', 1)], settings: { enabled: true, userKeysAllowed: false, dailyCap: 50, defaultProvider: 7 } });
  vi.mocked(getAiConfig).mockReturnValue(new Promise(() => {}));
  useThemeStore.setState({ savedThemes: SHIPPED_THEMES });
  useAuthStore.setState({ backendUser: { id: 1, username: 'root', role: 'admin' }, backendToken: 'tok' });
  useAiStore.setState({ config: { enabled: true, providers: [], userKeysAllowed: false, dailyCap: 0, usageToday: 0, defaultProvider: null } });
  useThemeStore.getState().openPreferences('ai');
});
afterEach(() => { cleanup(); useAiStore.getState().reset(); useThemeStore.getState().closePreferences(); });

describe('Préférences — surfaces rendues sous <body>', () => {
  it('a click inside the provider « ⋯ » menu does not close Preferences, and Delete reaches its confirmation', async () => {
    render(<Preferences />);
    fireEvent.click(await screen.findByRole('button', { name: 'ai.admin.more — Ollama' }));
    // Le menu est un portail sous <body> : hors du panneau, mais dans l'arbre React.
    const menu = screen.getByRole('menu');
    expect(screen.getByRole('dialog', { name: 'preferences.title' }).contains(menu)).toBe(false);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'ai.admin.delete — Ollama' }));
    expect(useThemeStore.getState().preferencesOpen).toBe(true);
    expect(screen.getByRole('dialog', { name: 'preferences.title' })).toBeTruthy();
    // La confirmation est là, et Préférences toujours derrière.
    expect(await screen.findAllByRole('dialog')).toHaveLength(2);
  });

  it('a click on the backdrop itself still closes Preferences', () => {
    const { container } = render(<Preferences />);
    const backdrop = container.firstElementChild as HTMLElement;
    fireEvent.click(backdrop);
    expect(useThemeStore.getState().preferencesOpen).toBe(false);
  });
});
