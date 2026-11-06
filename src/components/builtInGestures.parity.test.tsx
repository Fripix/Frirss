// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'fr', changeLanguage: vi.fn() } }),
}));
vi.mock('../i18n', () => ({ loadLanguage: vi.fn() }));
vi.mock('../stores/feedStore', () => ({
  useFeedStore: { getState: () => ({ selectedFeed: null }) },
}));

import ShortcutHelp from './ShortcutHelp';
import GeneralTab from './Preferences/GeneralTab';
import { useUiStore } from '../stores/uiStore';

/** Les gestes intégrés d'un écran, en paires [touche, libellé], dans l'ordre. */
function gestures(): Array<[string, string]> {
  const rows = Array.from(document.querySelectorAll('[data-builtin-gestures] [data-gesture-key]'));
  return rows.map((r) => [r.getAttribute('data-gesture-key') ?? '', r.getAttribute('data-gesture-label') ?? '']);
}

beforeEach(() => { useUiStore.setState({ shortcutHelpOpen: true }); });
afterEach(cleanup);

// A4 : l'aide « ? » n'avait pas « Échap → Retour à la grille », que
// Préférences → Général affiche ; ⌘K n'était dans aucune des deux, « ? »
// seulement dans l'aide. FEATURES dit qu'elles portent les mêmes gestes.
describe('gestes intégrés — l’aide « ? » et Préférences → Général portent les mêmes', () => {
  it('mêmes paires touche / libellé, dans le même ordre, Échap → grille et la palette comprises', () => {
    render(<ShortcutHelp />);
    const help = gestures();
    cleanup();
    render(<GeneralTab />);
    const prefs = gestures();
    expect(help.length).toBeGreaterThan(0);
    expect(prefs).toEqual(help);
    const labels = help.map(([, label]) => label);
    expect(labels).toEqual(expect.arrayContaining([
      'preferences.shortcuts.escExitFocus',
      'preferences.shortcuts.escBackToGrid',
      'palette.title',
      'preferences.shortcuts.helpTitle',
    ]));
    // La touche de la palette dit celle du clavier : Ctrl+K hors Apple (jsdom).
    expect(help.find(([, label]) => label === 'palette.title')?.[0]).toBe('Ctrl+K');
  });
});
