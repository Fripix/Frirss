// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';

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
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'fr', changeLanguage: () => {} } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => 'desktop' }));
// Deux sections factices, chacune avec ses sous-parties : c'est la navigation
// qui est sous test, pas leur contenu.
vi.mock('./ReadingTab', async () => {
  const { PrefHeading } = await import('./prefsUi');
  return { default: () => <><PrefHeading>Liste</PrefHeading><PrefHeading>Aléatoire</PrefHeading></> };
});
vi.mock('./LayoutTab', async () => {
  const { PrefHeading } = await import('./prefsUi');
  return { default: () => <><PrefHeading tag="Sur ordinateur">Barre de la liste</PrefHeading><PrefHeading>Colonne</PrefHeading></> };
});
vi.mock('./FeedsTab', () => ({ default: () => null }));
vi.mock('./AdminTab', () => ({ default: () => null }));
vi.mock('./OfflineTab', () => ({ default: () => null }));
vi.mock('./LabelsTab', () => ({ default: () => null }));
vi.mock('./AppearanceTab', () => ({ default: () => null }));
vi.mock('./KeyboardTab', () => ({ default: () => null }));
vi.mock('./AccountTab', () => ({ default: () => null }));
vi.mock('./AiTab', () => ({ default: () => null }));

import Preferences from './Preferences';
import { useThemeStore } from '../../stores/themeStore';
import { useUiStore } from '../../stores/uiStore';

const section = (id: string) => screen.getByRole('button', { name: `preferences.sections.${id}` });
const expanded = (id: string) => section(id).getAttribute('aria-expanded');

beforeEach(() => {
  localStorage.clear();
  useThemeStore.setState({ preferencesTab: null });
});
afterEach(cleanup);

describe('Préférences — navigation dépliable', () => {
  it('liste les sous-titres de la section ouverte, sans l’étiquette accolée au titre', () => {
    render(<Preferences />);
    expect(expanded('reading')).toBe('true');
    fireEvent.click(section('layout'));
    expect(screen.getByRole('button', { name: 'Barre de la liste' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Sur ordinateur/ })).toBeNull();
  });

  it('par défaut, ouvrir une autre section laisse la précédente dépliée', () => {
    useUiStore.setState({ prefsNavAutoCollapse: false });
    render(<Preferences />);
    fireEvent.click(section('layout'));
    expect(expanded('reading')).toBe('true');
    expect(expanded('layout')).toBe('true');
  });

  it('avec « Replier les autres sections », ouvrir une section replie les autres', () => {
    useUiStore.setState({ prefsNavAutoCollapse: true });
    render(<Preferences />);
    fireEvent.click(section('layout'));
    expect(expanded('reading')).toBe('false');
    expect(expanded('layout')).toBe('true');
  });

  it('un clic sur la section ouverte la replie, un second la redéplie', () => {
    render(<Preferences />);
    fireEvent.click(section('reading'));
    expect(expanded('reading')).toBe('false');
    fireEvent.click(section('reading'));
    expect(expanded('reading')).toBe('true');
  });

  it('teinte la sous-partie choisie, et seulement elle, jusqu’au changement de section', () => {
    render(<Preferences />);
    fireEvent.click(screen.getByRole('button', { name: 'Aléatoire' }));
    const marked = document.querySelectorAll('[data-pref-marked]');
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toBe('Aléatoire');
    expect(document.querySelector('.prefs-submark')).not.toBeNull();
    fireEvent.click(section('layout'));
    expect(document.querySelector('[data-pref-marked]')).toBeNull();
    expect(document.querySelector('.prefs-submark')).toBeNull();
  });

  it('un sous-titre d’une autre section dépliée ouvre cette section', () => {
    useUiStore.setState({ prefsNavAutoCollapse: false });
    render(<Preferences />);
    fireEvent.click(section('layout'));
    fireEvent.click(screen.getByRole('button', { name: 'Aléatoire' }));
    expect(section('reading').getAttribute('aria-current')).toBe('page');
  });
});
