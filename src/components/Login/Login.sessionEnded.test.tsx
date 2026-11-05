// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

/*
 * Une session fermée par le serveur (mot de passe changé ailleurs, session
 * révoquée, expirée) ramenait à l'écran de connexion sans un mot : on croyait
 * à une panne, ou à un clic oublié sur « Se déconnecter ».
 */
vi.mock('../../api/backend', () => ({
  getAuthStatus: vi.fn(async () => ({ hasUsers: true, registrationEnabled: false })),
  getOidcConfig: vi.fn(async () => ({ enabled: false })),
  loginUser: vi.fn(), registerUser: vi.fn(), addServer: vi.fn(), updateServer: vi.fn(),
  getServers: vi.fn(async () => []), startOidcLogin: vi.fn(),
}));
vi.mock('./MatrixRain', () => ({ default: () => null }));

import i18n from '../../i18n';
import Login from './Login';
import { useAuthStore } from '../../stores/authStore';

afterEach(() => {
  cleanup();
  useAuthStore.setState({ sessionEnded: false });
});

describe('écran de connexion après une session fermée par le serveur', () => {
  it('dit que la session a été fermée', () => {
    useAuthStore.setState({ backendToken: null, sessionEnded: true });
    render(<Login />);
    expect(i18n.exists('login.sessionEnded')).toBe(true);
    expect(screen.getByText(i18n.t('login.sessionEnded'))).toBeTruthy();
  });

  it('ne dit rien après une déconnexion voulue', () => {
    useAuthStore.setState({ backendToken: null, sessionEnded: false });
    render(<Login />);
    expect(screen.queryByText(i18n.t('login.sessionEnded'))).toBeNull();
  });
});
