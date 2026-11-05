// @vitest-environment jsdom
//
// Le sélecteur de couleur d'une étiquette, dans le vrai panneau des
// Préférences : Échap lui appartient (L-19), il vit sous <body> sans perdre
// le clavier, et ses boutons se distinguent à l'oreille (L-33).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, within, act } from '@testing-library/react';

vi.hoisted(() => {
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
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (k === 'app.labelValue' ? `${String(o?.label)} : ${String(o?.value)}` : k),
    i18n: { language: 'fr', changeLanguage: () => {} },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => 'desktop' }));
vi.mock('../../api/backend', () => ({
  getAiProviders: vi.fn(async () => ({ providers: [], settings: {} })), getAiConfig: vi.fn(() => new Promise(() => {})),
}));
vi.mock('./FeedsTab', () => ({ default: () => null }));
vi.mock('./AdminTab', () => ({ default: () => null }));
vi.mock('./OfflineTab', () => ({ default: () => null }));
vi.mock('./GeneralTab', () => ({ default: () => null }));
vi.mock('./AppearanceTab', () => ({ default: () => null }));
vi.mock('./LayoutTab', () => ({ default: () => null }));

import Preferences from './Preferences';
import { useThemeStore } from '../../stores/themeStore';
import { useFeedStore } from '../../stores/feedStore';
import { useAuthStore } from '../../stores/authStore';

const L = (n: string) => `user/-/label/${n}`;

beforeEach(() => {
  useAuthStore.setState({ backendUser: { id: 1, username: 'u', role: 'user' }, backendToken: 'tok' });
  useFeedStore.setState({ labels: [{ id: L('Veille'), type: 'tag' }, { id: L('Tuto'), type: 'tag' }], categoryIds: [], folderIds: [] } as never);
  useThemeStore.getState().openPreferences('labels');
});
afterEach(() => { cleanup(); useThemeStore.getState().closePreferences(); });

function openPicker(label = 'Veille') {
  render(<Preferences />);
  const trigger = screen.getByRole('button', { name: `preferences.labels.chooseColor : ${label}` });
  fireEvent.click(trigger);
  const popover = screen.getByRole('dialog', { name: `preferences.labels.chooseColor : ${label}` });
  return { trigger, popover };
}

describe('Sélecteur de couleur d’étiquette — Échap (L-19)', () => {
  it('Échap ferme le sélecteur seul : les Préférences restent ouvertes, le focus revient au bouton', () => {
    const { trigger, popover } = openPicker();
    // Rendu sous <body>, hors du panneau ; le focus y est entré.
    expect(screen.getByRole('dialog', { name: 'preferences.title' }).contains(popover)).toBe(false);
    expect(popover.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'preferences.labels.chooseColor : Veille' })).toBeNull();
    expect(useThemeStore.getState().preferencesOpen).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it('même focus retombé sur la page (Safari ne focalise pas un bouton cliqué)', () => {
    openPicker();
    (document.activeElement as HTMLElement | null)?.blur();
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => { document.body.dispatchEvent(ev); });
    expect(screen.queryByRole('dialog', { name: 'preferences.labels.chooseColor : Veille' })).toBeNull();
    expect(useThemeStore.getState().preferencesOpen).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('un Échap déjà traité par ce qu’il y a dans le panneau ne ferme pas les Préférences', () => {
    render(<Preferences />);
    const inside = screen.getByRole('button', { name: 'preferences.labels.chooseColor : Veille' });
    inside.addEventListener('keydown', (e) => e.preventDefault());
    fireEvent.keyDown(inside, { key: 'Escape' });
    expect(useThemeStore.getState().preferencesOpen).toBe(true);
  });

  it('Tab reste dans le sélecteur : le piège des Préférences ne le reprend pas', () => {
    const { popover } = openPicker();
    const items = within(popover).getAllByRole('button');
    const last = within(popover).getByRole('textbox', { name: 'preferences.labels.hexColor' });
    items[0].focus();
    fireEvent.keyDown(items[0], { key: 'Tab' });
    // Sans exception, le piège renvoyait le focus au premier élément du panneau.
    expect(popover.contains(document.activeElement) || document.activeElement === items[0]).toBe(true);
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(items[0]);
  });
});

describe('Sélecteur de couleur d’étiquette — noms accessibles (L-33)', () => {
  it('chaque bouton dit son étiquette, chaque nuance son nom', () => {
    render(<Preferences />);
    expect(screen.getByRole('button', { name: 'preferences.labels.chooseColor : Veille' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'preferences.labels.chooseColor : Tuto' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'preferences.labels.chooseColor : Tuto' }));
    const popover = screen.getByRole('dialog', { name: 'preferences.labels.chooseColor : Tuto' });
    expect(within(popover).getByRole('button', { name: 'preferences.labelSwatches.red' })).toBeTruthy();
    expect(within(popover).getByRole('button', { name: 'preferences.labelSwatches.forest' })).toBeTruthy();
    expect(within(popover).queryByRole('button', { name: '#ef4444' })).toBeNull();
  });

  it('« Supprimer la couleur » dit aussi de quelle étiquette', () => {
    useThemeStore.setState({ labelColors: { [L('Veille')]: { color: '#ef4444' } } } as never);
    render(<Preferences />);
    expect(screen.getByRole('button', { name: 'preferences.labels.removeColor : Veille' })).toBeTruthy();
  });
});
