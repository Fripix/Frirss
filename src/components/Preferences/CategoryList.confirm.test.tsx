// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, screen, act, within } from '@testing-library/react';
import CategoryList from './CategoryList';
import { useFeedStore } from '../../stores/feedStore';
import { useUiStore } from '../../stores/uiStore';
import { CONFIRM_GRACE_MS } from '../ConfirmDialog';
import type { Subscription } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: { name?: string }) => (o?.name ? `${k}:${o.name}` : k) }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

afterEach(cleanup);

describe('Préférences › Flux › Catégories — supprimer', () => {
  let deleteCategory: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    deleteCategory = vi.fn();
    useUiStore.setState({ toasts: [] });
    useFeedStore.setState({
      subscriptions: [{ id: 'feed/1', title: 'Un flux', categories: [{ id: 'user/-/label/Tech', label: 'Tech' }] }] as Subscription[],
      deleteCategory,
    } as never);
  });

  // La confirmation s'ouvrait en place sous la ligne : un double-clic sur la
  // corbeille pouvait tomber sur « Supprimer la catégorie ».
  it('passe par la boîte, qui dit ce que deviennent les flux, et ferme après un échec', async () => {
    deleteCategory.mockResolvedValue(false);
    render(<CategoryList />);
    fireEvent.click(screen.getByRole('button', { name: 'preferences.categories.delete : Tech' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('preferences.categories.deleteTitle:Tech')).toBeTruthy();
    expect(within(dialog).getByText('preferences.categories.deleteWarning')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'preferences.categories.confirmDelete' }));
    expect(deleteCategory).not.toHaveBeenCalled();
    await act(async () => { await new Promise((r) => setTimeout(r, CONFIRM_GRACE_MS + 30)); });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'preferences.categories.confirmDelete' })); });
    expect(deleteCategory).toHaveBeenCalledWith('user/-/label/Tech');
    expect(useUiStore.getState().toasts.map((x) => x.message)).toContain('preferences.categories.failed');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
