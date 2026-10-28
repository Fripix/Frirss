import { describe, it, expect, vi, beforeEach } from 'vitest';

// L'intercepteur appelle `logoutBackend()` sur le store d'authentification ; on
// ne veut ni sa persistance ni son vrai effet, seulement savoir s'il a été
// appelé. Aucune requête n'est émise ici, seul le chemin d'erreur est exercé.
const logoutBackend = vi.fn();
vi.mock('../stores/authStore', () => ({
  useAuthStore: {
    getState: () => ({ backendToken: null, logoutBackend }),
  },
}));

import { BACKEND_AUTH_MARKERS } from '../lib/loginErrors';
import backend from './backend';

/** Le gestionnaire d'erreur de l'intercepteur de réponse, tel qu'axios le garde. */
const rejected = (
  backend.interceptors.response as unknown as {
    handlers: { rejected: (e: unknown) => Promise<unknown> }[];
  }
).handlers[0].rejected;

const failure = (status: number, data: unknown) => ({ response: { status, data } });

const reject = async (err: unknown): Promise<void> => {
  // L'intercepteur doit TOUJOURS rejeter : il ne fait que décider s'il
  // déconnecte au passage.
  await expect(rejected(err)).rejects.toBe(err);
};

beforeEach(() => {
  logoutBackend.mockClear();
});

describe('backend — l’intercepteur de réponse ne déconnecte que sur NOTRE 401', () => {
  it('déconnecte sur chaque message de session invalide du middleware', async () => {
    for (const marker of BACKEND_AUTH_MARKERS) {
      logoutBackend.mockClear();
      await reject(failure(401, { error: marker }));
      expect(logoutBackend, marker).toHaveBeenCalledTimes(1);
    }
  });

  it('déconnecte sur « Session expired »', async () => {
    await reject(failure(401, { error: 'Session expired' }));
    expect(logoutBackend).toHaveBeenCalledTimes(1);
  });

  // Changer son mot de passe avec un mauvais mot de passe actuel répond 401 :
  // c'est une erreur de saisie, pas une session morte.
  it('ne déconnecte pas sur un mauvais mot de passe actuel', async () => {
    await reject(failure(401, { error: 'Current password is incorrect' }));
    expect(logoutBackend).not.toHaveBeenCalled();
  });

  it('ne déconnecte pas sur des identifiants refusés', async () => {
    await reject(failure(401, { error: 'Invalid credentials' }));
    expect(logoutBackend).not.toHaveBeenCalled();
  });

  it('ne déconnecte pas sur un 500', async () => {
    await reject(failure(500, { error: 'boom' }));
    expect(logoutBackend).not.toHaveBeenCalled();
  });

  it('ne déconnecte pas sur une coupure réseau (pas de réponse)', async () => {
    await reject({ message: 'Network Error' });
    expect(logoutBackend).not.toHaveBeenCalled();
  });
});
