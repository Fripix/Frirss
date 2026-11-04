// @vitest-environment jsdom
// Préférences → Mise en page : les barres personnalisables sur desktop.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
const bp = vi.hoisted(() => ({ value: 'desktop' as 'desktop' | 'tablet' | 'mobile' }));
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => bp.value }));

import LayoutTab from './LayoutTab';
import { useUiStore } from '../../stores/uiStore';
import { DEFAULT_TOOLBAR_VISIBILITY, TOOLBAR_ITEMS } from '../../lib/toolbarItems';

const toggle = (c: ReturnType<typeof render>, key: string) => c.getByRole('switch', { name: key }) as HTMLButtonElement;
const itemSwitches = (c: ReturnType<typeof render>, zone: 'list' | 'reading') =>
  TOOLBAR_ITEMS.filter((i) => i.zone === zone).map((i) => toggle(c, `preferences.toolbars.items.${i.id}`));

beforeEach(() => {
  bp.value = 'desktop';
  localStorage.clear();
  useUiStore.setState({ toolbarVisibility: { ...DEFAULT_TOOLBAR_VISIBILITY }, topbarVisible: true });
});
afterEach(cleanup);

describe('LayoutTab — barres sur ordinateur', () => {
  it('un interrupteur par élément du registre : 11 pour la liste, 12 pour le volet', () => {
    const c = render(<LayoutTab />);
    expect(itemSwitches(c, 'list')).toHaveLength(11);
    expect(itemSwitches(c, 'reading')).toHaveLength(12);
  });

  it('un interrupteur masque son élément', () => {
    const c = render(<LayoutTab />);
    fireEvent.click(toggle(c, 'preferences.toolbars.items.random'));
    expect(useUiStore.getState().toolbarVisibility.random).toBe(false);
  });

  it('barre de la liste masquée : ses boutons sont grisés, pas ceux du volet', () => {
    useUiStore.setState({ toolbarVisibility: { ...DEFAULT_TOOLBAR_VISIBILITY, listBar: false } });
    const c = render(<LayoutTab />);
    expect(itemSwitches(c, 'list').every((s) => s.disabled)).toBe(true);
    expect(itemSwitches(c, 'reading').some((s) => s.disabled)).toBe(false);
  });

  it('« Tout réafficher » de la liste remet sa zone et elle seule ; inactif sans rien de masqué', () => {
    useUiStore.setState({ toolbarVisibility: { ...DEFAULT_TOOLBAR_VISIBILITY, listBar: false, random: false, star: false } });
    const c = render(<LayoutTab />);
    const [listReset, readingReset, shortcutsReset] = c.getAllByRole('button', { name: 'preferences.toolbars.showAll' }) as HTMLButtonElement[];
    expect(shortcutsReset.disabled).toBe(true);
    fireEvent.click(listReset);
    const v = useUiStore.getState().toolbarVisibility;
    expect(v.listBar).toBe(true);
    expect(v.random).toBe(true);
    expect(v.star).toBe(false);
    expect(readingReset.disabled).toBe(false);
  });

  it('la barre des raccourcis a son interrupteur', () => {
    const c = render(<LayoutTab />);
    fireEvent.click(toggle(c, 'preferences.toolbars.shortcutBarWhole'));
    expect(useUiStore.getState().toolbarVisibility.shortcutBar).toBe(false);
  });

  it('hors desktop, la section dit qu’elle ne vaut que pour l’ordinateur', () => {
    expect(render(<LayoutTab />).queryByText('preferences.toolbars.desktopOnly')).toBeNull();
    cleanup();
    bp.value = 'tablet';
    expect(render(<LayoutTab />).getByText('preferences.toolbars.desktopOnly')).toBeTruthy();
  });
});

describe('LayoutTab — sur tous les écrans', () => {
  it('la barre des serveurs se règle ici aussi', () => {
    const c = render(<LayoutTab />);
    fireEvent.click(toggle(c, 'preferences.toolbars.serverBar'));
    expect(useUiStore.getState().topbarVisible).toBe(false);
  });

  it('les quatre icônes des lignes restent là', () => {
    const c = render(<LayoutTab />);
    for (const k of ['star', 'readLater', 'openSource', 'markRead']) expect(toggle(c, `preferences.layout.${k}`)).toBeTruthy();
  });
});
