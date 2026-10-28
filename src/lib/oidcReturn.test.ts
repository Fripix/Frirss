import { describe, it, expect, vi } from 'vitest';
import { completeOidcReturn, OIDC_RETRY_WAITS_MS, OIDC_GETME_TIMEOUT_MS } from './oidcReturn';
import type { User } from '../types';

const user = { id: 1, username: 'alice' } as unknown as User;
const networkError = () => Object.assign(new Error('Network Error'), { response: undefined });
const httpError = (status: number, data: unknown) => ({ response: { status, data } });

function setup(getMe: () => Promise<User>) {
  const deps = {
    getMe: vi.fn(getMe),
    setAuth: vi.fn(),
    logout: vi.fn(),
    wait: vi.fn(async () => {}),
    onUnavailable: vi.fn(),
    currentToken: vi.fn(() => 'tok' as string | null),
  };
  return deps;
}

describe('completeOidcReturn — le retour SSO ne déconnecte pas sur une panne passagère', () => {
  it('enregistre l’utilisateur dès le premier succès', async () => {
    const d = setup(async () => user);
    await completeOidcReturn('tok', d);
    expect(d.setAuth).toHaveBeenCalledWith('tok', user);
    expect(d.logout).not.toHaveBeenCalled();
    expect(d.wait).not.toHaveBeenCalled();
  });

  it('réessaie après deux erreurs réseau puis réussit, sans jamais déconnecter', async () => {
    let n = 0;
    const d = setup(async () => {
      if (++n <= 2) throw networkError();
      return user;
    });
    await completeOidcReturn('tok', d);
    expect(d.getMe).toHaveBeenCalledTimes(3);
    expect(d.setAuth).toHaveBeenCalledWith('tok', user);
    expect(d.logout).not.toHaveBeenCalled();
    expect(d.wait.mock.calls.map((c) => (c as unknown[])[0])).toEqual([1000, 2000]);
  });

  it('traite un 5xx comme une panne passagère', async () => {
    let n = 0;
    const d = setup(async () => {
      if (++n === 1) throw httpError(503, { error: 'down' });
      return user;
    });
    await completeOidcReturn('tok', d);
    expect(d.setAuth).toHaveBeenCalledWith('tok', user);
    expect(d.logout).not.toHaveBeenCalled();
  });

  it('déconnecte aussitôt sur un 401 de session invalide', async () => {
    const d = setup(async () => {
      throw httpError(401, { error: 'Session expired' });
    });
    await completeOidcReturn('tok', d);
    expect(d.getMe).toHaveBeenCalledTimes(1);
    expect(d.logout).toHaveBeenCalledTimes(1);
    expect(d.setAuth).not.toHaveBeenCalled();
    expect(d.onUnavailable).not.toHaveBeenCalled();
  });

  it('déconnecte aussitôt sur tout autre 4xx : le jeton est inutilisable', async () => {
    const d = setup(async () => {
      throw httpError(403, { error: 'Forbidden' });
    });
    await completeOidcReturn('tok', d);
    expect(d.getMe).toHaveBeenCalledTimes(1);
    expect(d.logout).toHaveBeenCalledTimes(1);
  });

  it('abandonne après quatre réessais (1, 2, 4, 8 s), déconnecte et le dit à l’écran de connexion', async () => {
    const d = setup(async () => {
      throw networkError();
    });
    await completeOidcReturn('tok', d);
    expect(d.getMe).toHaveBeenCalledTimes(5);
    expect(d.wait.mock.calls.map((c) => (c as unknown[])[0])).toEqual([1000, 2000, 4000, 8000]);
    expect(OIDC_RETRY_WAITS_MS).toEqual([1000, 2000, 4000, 8000]);
    expect(d.logout).toHaveBeenCalledTimes(1);
    expect(d.onUnavailable).toHaveBeenCalledTimes(1);
    expect(d.setAuth).not.toHaveBeenCalled();
  });

  // Avec un serveur muet, chaque lecture attendait le délai par défaut
  // (75 s) : 5 × 75 s + 15 s ≈ 6,5 min avant l'échec final, qui déconnectait
  // une session que l'utilisateur avait pu poursuivre. `/api/auth/me` ne fait
  // aucun appel amont : un délai court tient la règle « serveur avant client ».
  it('lit l’utilisateur avec un délai court, propre à ces réessais', async () => {
    const d = setup(async () => user);
    await completeOidcReturn('tok', d);
    expect(d.getMe).toHaveBeenCalledWith({ timeout: OIDC_GETME_TIMEOUT_MS });
    expect(OIDC_GETME_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
    const worst = 5 * OIDC_GETME_TIMEOUT_MS + OIDC_RETRY_WAITS_MS.reduce((a, b) => a + b, 0);
    expect(worst).toBeLessThanOrEqual(90_000);
  });

  it('s’arrête sans rien faire si la session a changé pendant les réessais (déconnexion)', async () => {
    const d = setup(async () => { throw networkError(); });
    d.wait.mockImplementation(async () => { d.currentToken.mockReturnValue(null); });
    await completeOidcReturn('tok', d);
    expect(d.getMe).toHaveBeenCalledTimes(1);
    expect(d.setAuth).not.toHaveBeenCalled();
    expect(d.logout).not.toHaveBeenCalled();
    expect(d.onUnavailable).not.toHaveBeenCalled();
  });

  it('n’enregistre pas l’utilisateur si un autre jeton a remplacé celui-ci pendant la lecture', async () => {
    const d = setup(async () => { d.currentToken.mockReturnValue('autre'); return user; });
    await completeOidcReturn('tok', d);
    expect(d.setAuth).not.toHaveBeenCalled();
    expect(d.logout).not.toHaveBeenCalled();
  });

  it('ne déconnecte pas une autre session sur un 401 arrivé après le changement', async () => {
    const d = setup(async () => { d.currentToken.mockReturnValue('autre'); throw httpError(401, { error: 'Session expired' }); });
    await completeOidcReturn('tok', d);
    expect(d.logout).not.toHaveBeenCalled();
  });
});
