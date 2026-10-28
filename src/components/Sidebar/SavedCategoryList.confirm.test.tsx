// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, act, within } from '@testing-library/react';
import { SavedCategoryList } from './Sidebar';
import { useFeedStore } from '../../stores/feedStore';
import { useUiStore } from '../../stores/uiStore';
import { CONFIRM_GRACE_MS } from '../ConfirmDialog';
import type { Tag } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

afterEach(cleanup);

const ID = 'user/-/label/À lire plus tard/Recettes';

// La croix supprimait la catégorie — et l'étiquette sur le serveur — d'un seul clic.
describe('Barre latérale — supprimer une catégorie de Favoris / À lire plus tard', () => {
  let deleteLabel: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    deleteLabel = vi.fn();
    useUiStore.setState({ toasts: [], savedCollapsed: {}, savedCategoryNames: {} } as never);
    useFeedStore.setState({ labels: [{ id: ID, type: 'tag' }] as Tag[], deleteLabel } as never);
  });

  it('demande confirmation, et un double-clic ne valide pas', async () => {
    deleteLabel.mockResolvedValue(true);
    render(<SavedCategoryList prefix="À lire plus tard" />);
    fireEvent.click(screen.getByRole('button', { name: 'saved.deleteCategory' }));
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'saved.deleteCategory' });
    fireEvent.click(confirm);
    expect(deleteLabel).not.toHaveBeenCalled();
    await act(async () => { await new Promise((r) => setTimeout(r, CONFIRM_GRACE_MS + 30)); });
    await act(async () => { fireEvent.click(confirm); });
    expect(deleteLabel).toHaveBeenCalledWith(ID);
  });

  it('un refus le dit, et la catégorie reste', async () => {
    deleteLabel.mockResolvedValue(false);
    render(<SavedCategoryList prefix="À lire plus tard" />);
    fireEvent.click(screen.getByRole('button', { name: 'saved.deleteCategory' }));
    await act(async () => { await new Promise((r) => setTimeout(r, CONFIRM_GRACE_MS + 30)); });
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'saved.deleteCategory' })); });
    expect(useUiStore.getState().toasts.map((x) => x.message)).toContain('preferences.labels.deleteFailed');
    expect(screen.getByText('Recettes')).toBeTruthy();
  });
});
