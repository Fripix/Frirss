// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, screen, act } from '@testing-library/react';
import AdminTab from './AdminTab';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import { CONFIRM_GRACE_MS } from '../ConfirmDialog';
import { getAdminUsers, getAdminSettings, updateAdminUser, deleteAdminUser } from '../../api/backend';
import type { User } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: { name?: string }) => (o?.name ? `${k}:${o.name}` : k) }),
}));
vi.mock('../../api/backend', () => ({
  getAdminUsers: vi.fn(), getAdminSettings: vi.fn(), createAdminUser: vi.fn(),
  updateAdminUser: vi.fn(), deleteAdminUser: vi.fn(), setAdminUserPassword: vi.fn(), updateAdminSettings: vi.fn(),
}));
vi.mock('./admin/BackupBlock', () => ({ default: () => null }));

const me = { id: 1, username: 'root', role: 'admin', active: true, auth_provider: 'local' } as unknown as User;
const bob = { id: 2, username: 'bob', display_name: 'Bob', role: 'admin', active: true, auth_provider: 'local' } as unknown as User;

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ backendUser: me as never });
  useUiStore.setState({ toasts: [] });
  vi.mocked(getAdminUsers).mockResolvedValue([me, bob]);
  vi.mocked(getAdminSettings).mockResolvedValue({});
});
afterEach(cleanup);

/** Franchit la garde anti-double-clic de la boîte, puis valide. */
async function confirmer(label: string) {
  await act(async () => { await new Promise((r) => setTimeout(r, CONFIRM_GRACE_MS + 30)); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: label })); });
}

// Les pastilles « Admin » et « Actif » ressemblent à des étiquettes, mais un
// clic retirait les droits ou désactivait le compte, sans rien demander. Et
// « Supprimer » validait au second clic d'un double-clic (« × » puis « ? »).
describe('Administration — les actions sur un compte se confirment', () => {
  it('retirer les droits d’administrateur demande confirmation', async () => {
    render(<AdminTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'admin.demoteUserName:Bob' }));
    expect(updateAdminUser).not.toHaveBeenCalled();
    expect(screen.getByText('admin.confirmDemoteTitle:Bob')).toBeTruthy();
    vi.mocked(updateAdminUser).mockResolvedValue({ ...bob, role: 'user' } as User);
    await confirmer('admin.confirmDemote');
    expect(updateAdminUser).toHaveBeenCalledWith(2, { role: 'user' });
  });

  it('désactiver un compte demande confirmation', async () => {
    render(<AdminTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'admin.deactivateUser:Bob' }));
    expect(updateAdminUser).not.toHaveBeenCalled();
    vi.mocked(updateAdminUser).mockResolvedValue({ ...bob, active: false } as User);
    await confirmer('admin.confirmDeactivate');
    expect(updateAdminUser).toHaveBeenCalledWith(2, { active: false });
  });

  it('supprimer un compte passe par la boîte, et un double-clic ne valide pas', async () => {
    render(<AdminTab />);
    const del = await screen.findByRole('button', { name: 'admin.deleteUserName:Bob' });
    fireEvent.click(del);
    fireEvent.click(screen.getByRole('button', { name: 'admin.confirmDelete' }));
    expect(deleteAdminUser).not.toHaveBeenCalled();
    vi.mocked(deleteAdminUser).mockResolvedValue(undefined as never);
    await confirmer('admin.confirmDelete');
    expect(deleteAdminUser).toHaveBeenCalledWith(2);
    expect(screen.queryByText('Bob')).toBeNull();
  });

  it('un échec le dit, au lieu de laisser croire que c’est fait', async () => {
    render(<AdminTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'admin.deactivateUser:Bob' }));
    vi.mocked(updateAdminUser).mockRejectedValue(new Error('HTTP 500'));
    await confirmer('admin.confirmDeactivate');
    expect(useUiStore.getState().toasts.map((x) => x.message)).toContain('admin.errorUpdate');
  });

  it('un chargement en échec le dit, au lieu d’afficher zéro utilisateur', async () => {
    vi.mocked(getAdminUsers).mockRejectedValue(new Error('HTTP 500'));
    render(<AdminTab />);
    expect(await screen.findByText('admin.errorLoad')).toBeTruthy();
  });
});
