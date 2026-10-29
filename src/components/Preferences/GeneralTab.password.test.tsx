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
vi.mock('../../api/backend', () => ({
  changePassword: vi.fn(),
  getOidcConfig: vi.fn().mockResolvedValue({ enabled: false }),
  linkOidcAccount: vi.fn().mockResolvedValue(undefined),
}));

import GeneralTab from './GeneralTab';
import { useAuthStore } from '../../stores/authStore';
import { changePassword, getOidcConfig, linkOidcAccount } from '../../api/backend';

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

  // Les réponses de connexion locale n'envoyaient pas `auth_provider` : une
  // session ouverte avant la 1.8.0 n'a pas le champ. Absent = connexion locale
  // (le retour SSO lit l'utilisateur par /me, qui l'inclut toujours).
  it('apparaît pour une session locale qui ne connaît pas encore son fournisseur', () => {
    useAuthStore.setState({ backendUser: { id: 1, username: 'root', role: 'user' } as never });
    render(<GeneralTab />);
    expect(screen.getByLabelText('preferences.account.current')).toBeTruthy();
  });

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

  // La confirmation était insérée avec son texte (souvent non annoncée), puis
  // restait affichée pendant qu'on retapait un autre mot de passe.
  it('annonce la réussite dans une région déjà montée, effacée dès qu’on retape', async () => {
    vi.mocked(changePassword).mockResolvedValue(undefined);
    render(<GeneralTab />);
    const region = screen.getAllByRole('status').find((r) => r.closest('form'));
    expect(region?.textContent).toBe('');
    fill('old-secret', 'new-secret', 'new-secret');
    await submit();
    expect(region?.textContent).toBe('preferences.account.done');
    fireEvent.change(screen.getByLabelText('preferences.account.current'), { target: { value: 'x' } });
    expect(region?.textContent).toBe('');
  });

  // Sans champ identifiant, un gestionnaire de mots de passe ne sait pas à
  // quel compte rattacher le nouveau mot de passe (Chrome le signale).
  it('porte l’identifiant du compte pour les gestionnaires de mots de passe', () => {
    const { container } = render(<GeneralTab />);
    const user = container.querySelector('input[autocomplete="username"]') as HTMLInputElement | null;
    expect(user?.value).toBe('root');
    expect(user?.closest('form')).toBe(screen.getByLabelText('preferences.account.current').closest('form'));
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

// Seul chemin de rattachement au SSO depuis 1.8.0 : depuis le compte, connecté.
// Le rattachement d'office par adresse e-mail donnait le compte (admin compris)
// à qui inscrivait cette adresse dans son profil chez le fournisseur.
describe('Préférences › Général — lier son compte au SSO', () => {
  afterEach(cleanup);

  it('propose le rattachement quand le SSO est actif et le compte pas encore lié', async () => {
    vi.mocked(getOidcConfig).mockResolvedValue({ enabled: true, buttonLabel: 'Authentik' });
    useAuthStore.setState({ backendUser: { id: 1, username: 'root', role: 'admin', auth_provider: 'local', sso_linked: false } as never });
    render(<GeneralTab />);
    const btn = await screen.findByRole('button', { name: 'preferences.account.ssoLink' });
    await act(async () => { fireEvent.click(btn); });
    expect(linkOidcAccount).toHaveBeenCalled();
  });

  // Une session ouverte avant la 1.8.0 ne connaît pas `sso_linked` : un compte
  // déjà lié voyait « Lier », et le 409 du serveur passait pour un échec.
  it('un compte déjà lié (409) s’affiche lié, sans message d’échec', async () => {
    vi.mocked(getOidcConfig).mockResolvedValue({ enabled: true, buttonLabel: 'Authentik' });
    vi.mocked(linkOidcAccount).mockRejectedValueOnce(http(409, 'Account already linked'));
    useAuthStore.setState({ backendUser: { id: 1, username: 'root', role: 'admin', auth_provider: 'local' } as never });
    render(<GeneralTab />);
    const btn = await screen.findByRole('button', { name: 'preferences.account.ssoLink' });
    await act(async () => { fireEvent.click(btn); });
    expect(await screen.findByText('preferences.account.ssoLinked')).toBeTruthy();
    expect(useAuthStore.getState().backendUser?.sso_linked).toBe(true);
  });

  it('dit que le compte est lié, sans bouton', async () => {
    vi.mocked(getOidcConfig).mockResolvedValue({ enabled: true, buttonLabel: 'Authentik' });
    useAuthStore.setState({ backendUser: { id: 1, username: 'root', role: 'admin', auth_provider: 'local', sso_linked: true } as never });
    render(<GeneralTab />);
    expect(await screen.findByText('preferences.account.ssoLinked')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'preferences.account.ssoLink' })).toBeNull();
  });

  it('ne montre rien quand le SSO est éteint', async () => {
    vi.mocked(getOidcConfig).mockResolvedValue({ enabled: false });
    useAuthStore.setState({ backendUser: { id: 1, username: 'root', role: 'admin', auth_provider: 'local' } as never });
    render(<GeneralTab />);
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'preferences.account.ssoLink' })).toBeNull();
  });
});
