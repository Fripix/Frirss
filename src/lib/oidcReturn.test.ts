import { describe, it, expect, vi } from 'vitest';
import { completeOidcReturn, OIDC_RETRY_WAITS_MS } from './oidcReturn';
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
});
