// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import CommandPalette from './CommandPalette';
import { useUiStore } from '../stores/uiStore';
import { useFeedStore } from '../stores/feedStore';
import { useToolbarCommands } from '../lib/toolbarCommands';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  useFeedStore.setState({ selectedArticle: { id: 'a1', title: 'T' } as never });
});
afterEach(cleanup);

// FreshRSS ignore une étiquette posée au nom d'une catégorie : la palette ne
// doit pas proposer de la « créer » (L-14), catégorie vide comprise (L-13).
describe('CommandPalette — pas de « Créer l’étiquette » au nom d’une catégorie', () => {
  function Pane() {
    useToolbarCommands(() => [{ command: 'newLabel', item: 'labels', label: 'palette.labelCreate' }], () => {});
    return null;
  }
  const open = () => {
    useUiStore.setState({ commandPaletteOpen: false });
    useFeedStore.setState({
      labels: [{ id: 'user/-/label/Veille' }],
      categoryIds: ['user/-/label/Tech'],
      folderIds: ['user/-/label/Tech', 'user/-/label/Sans catégorie'],
    } as never);
    const c = render(<><Pane /><CommandPalette /></>);
    act(() => { useUiStore.setState({ commandPaletteOpen: true }); });
    return c;
  };

  it('ni pour une catégorie portée par des flux, ni pour une catégorie vide', () => {
    const c = open();
    const input = c.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'tech' } });
    expect(c.queryByText('palette.labelCreate')).toBeNull();
    fireEvent.change(input, { target: { value: 'Sans catégorie' } });
    expect(c.queryByText('palette.labelCreate')).toBeNull();
    // Un nom libre reste proposé.
    fireEvent.change(input, { target: { value: 'Homelab' } });
    expect(c.queryByText('palette.labelCreate')).not.toBeNull();
  });
});
