// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../api/feeds', () => ({ clearWriteToken: vi.fn() }));
import { useAuthStore } from './authStore';

/*
 * Deux onglets : A, resté ouvert sur l'ancien compte, reçoit un 401 et se
 * déconnecte. Il effaçait du localStorage le jeton et le serveur actif du
 * compte B, ouvert entre-temps dans un autre onglet — B se retrouvait
 * déconnecté au rechargement suivant.
 */
describe('déconnexion d’un onglet resté sur un ancien compte', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  });

  it('n’efface pas la session qu’un autre onglet a ouverte depuis', () => {
    useAuthStore.setState({ backendToken: 'jwtA', backendUser: { id: 1 } as never, activeServerId: '1' });
    localStorage.setItem('frirss_backendToken', 'jwtB');
    localStorage.setItem('frirss_backendUser', '{"id":2}');
    localStorage.setItem('frirss_activeServerId', '7');
    useAuthStore.getState().logoutBackend();
    expect(useAuthStore.getState().backendToken).toBeNull();
    expect(localStorage.getItem('frirss_backendToken')).toBe('jwtB');
    expect(localStorage.getItem('frirss_activeServerId')).toBe('7');
  });

  it('efface sa propre session', () => {
    useAuthStore.setState({ backendToken: 'jwtA', backendUser: { id: 1 } as never, activeServerId: '1' });
    localStorage.setItem('frirss_backendToken', 'jwtA');
    localStorage.setItem('frirss_activeServerId', '1');
    useAuthStore.getState().logoutBackend();
    expect(localStorage.getItem('frirss_backendToken')).toBeNull();
    expect(localStorage.getItem('frirss_activeServerId')).toBeNull();
  });
});
