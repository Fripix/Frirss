// @vitest-environment jsdom
//
// Des commandes au même nom ne se distinguent qu'à l'œil : un lecteur d'écran
// entendait deux « Titre », deux « Nom du flux » (Apparence › Tailles) et
// trois « Tout réafficher » (Mise en page). Chacune dit désormais à quoi
// elle appartient.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, within } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (k === 'app.labelValue' ? `${String(o?.label)} : ${String(o?.value)}` : k),
  }),
}));
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => 'desktop' }));

import AppearanceTab from './AppearanceTab';
import LayoutTab from './LayoutTab';
import { useUiStore } from '../../stores/uiStore';
import { DEFAULT_TOOLBAR_VISIBILITY } from '../../lib/toolbarItems';

beforeEach(() => { localStorage.clear(); });
afterEach(cleanup);

describe('Apparence › Tailles — chaque section est un groupe nommé', () => {
  it('« Titre » et « Nom du flux » se lisent dans leur groupe', () => {
    const view = render(<AppearanceTab onHighlight={() => {}} />);
    fireEvent.click(view.getByText('preferences.appearance.sizes'));
    const list = view.getByRole('group', { name: 'preferences.fontSections.articleList' });
    const reading = view.getByRole('group', { name: 'preferences.fontSections.reading' });
    const sidebar = view.getByRole('group', { name: 'preferences.fontSections.sidebar' });
    expect(within(list).getByRole('slider', { name: 'preferences.fontKeys.list-title' })).toBeTruthy();
    expect(within(list).getByRole('slider', { name: 'preferences.fontKeys.list-source' })).toBeTruthy();
    expect(within(reading).getByRole('slider', { name: 'preferences.fontKeys.reading-title' })).toBeTruthy();
    expect(within(sidebar).getByRole('slider', { name: 'preferences.fontKeys.sidebar-feed' })).toBeTruthy();
  });
});

describe('Mise en page — « Tout réafficher » nommé par sa zone (R-7)', () => {
  it('trois boutons, trois noms', () => {
    useUiStore.setState({ toolbarVisibility: { ...DEFAULT_TOOLBAR_VISIBILITY, listBar: false, random: false, shortcutBar: false } });
    const c = render(<LayoutTab />);
    for (const zone of ['listBar', 'readingBar', 'shortcutBar']) {
      expect(c.getByRole('button', { name: `preferences.toolbars.showAll : preferences.toolbars.${zone}` })).toBeTruthy();
    }
  });
});
