// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, act } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'fr', changeLanguage: () => {} } }),
}));
vi.mock('../../i18n', () => ({ loadLanguage: vi.fn() }));
vi.mock('../../stores/feedStore', () => ({
  useFeedStore: Object.assign(() => ({}), { getState: () => ({ loadArticles: () => {} }) }),
}));
vi.mock('../../api/backend', () => ({ changePassword: vi.fn() }));

import GeneralTab from './GeneralTab';
import { useAuthStore } from '../../stores/authStore';
import { changePassword } from '../../api/backend';

const http = (status: number, error: string) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data: { error } } });

function fill(current: string, next: string, again: string) {
  fireEvent.change(screen.getByLabelText('preferences.account.current'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('preferences.account.new'), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('preferences.account.confirm'), { target: { value: again } });
}
const submit = () => act(async () => { fireEvent.click(screen.getByRole('button', { name: 'preferences.account.submit' })); });

// La route existait depuis toujours, mais aucun écran ne l'appelait depuis
// août : un compte local ne pouvait pas changer son propre mot de passe.
describe('Préférences › Général — changer son mot de passe', () => {
  beforeEach(() => {
    vi.mocked(changePassword).mockReset();
    useAuthStore.setState({ backendUser: { id: 1, username: 'root', role: 'user', auth_provider: 'local' } as never });
  });
  afterEach(cleanup);

  it('n’apparaît pas pour un compte SSO, qui n’a pas de mot de passe ici', () => {
    useAuthStore.setState({ backendUser: { id: 1, username: 'root', role: 'user', auth_provider: 'oidc' } as never });
    render(<GeneralTab />);
    expect(screen.queryByLabelText('preferences.account.current')).toBeNull();
  });

  it('change le mot de passe et le dit', async () => {
    vi.mocked(changePassword).mockResolvedValue(undefined);
    render(<GeneralTab />);
    fill('old-secret', 'new-secret', 'new-secret');
    await submit();
    expect(changePassword).toHaveBeenCalledWith('old-secret', 'new-secret');
    expect(screen.getByText('preferences.account.done')).toBeTruthy();
    expect((screen.getByLabelText('preferences.account.current') as HTMLInputElement).value).toBe('');
  });

  it('refuse deux saisies différentes sans appeler le serveur', async () => {
    render(<GeneralTab />);
    fill('old-secret', 'new-secret', 'new-secreT');
    await submit();
    expect(changePassword).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('preferences.account.mismatch');
  });

  it('refuse un nouveau mot de passe trop court sans appeler le serveur', async () => {
    render(<GeneralTab />);
    fill('old-secret', 'abc', 'abc');
    await submit();
    expect(changePassword).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('preferences.account.tooShort');
  });

  it('dit que le mot de passe actuel est faux', async () => {
    vi.mocked(changePassword).mockRejectedValue(http(401, 'Current password is incorrect'));
    render(<GeneralTab />);
    fill('wrong', 'new-secret', 'new-secret');
    await submit();
    expect(screen.getByRole('alert').textContent).toBe('preferences.account.wrongCurrent');
  });

  it('dit qu’il faut attendre après trop d’essais', async () => {
    vi.mocked(changePassword).mockRejectedValue(http(429, 'Too many attempts, please try again later'));
    render(<GeneralTab />);
    fill('wrong', 'new-secret', 'new-secret');
    await submit();
    expect(screen.getByRole('alert').textContent).toBe('preferences.account.tooMany');
  });
});
