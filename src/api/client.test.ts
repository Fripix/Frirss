import { describe, it, expect, vi, beforeEach } from 'vitest';

// L'intercepteur appelle `logout()` sur le store d'authentification ; on ne
// veut ni sa persistance ni son vrai effet, seulement savoir s'il a été
// appelé. Les champs lus par l'intercepteur de requête sont vides : aucune
// requête n'est émise ici, seul le chemin d'erreur est exercé.
const logout = vi.fn();
vi.mock('../stores/authStore', () => ({
  useAuthStore: {
    getState: () => ({ serverUrl: '', activeServerId: null, backendToken: null, logout }),
  },
}));

import { BACKEND_AUTH_MARKERS } from '../lib/loginErrors';
import client from './client';

/**
 * Le gestionnaire d'erreur de l'intercepteur de réponse, tel qu'axios le
 * garde. On l'exerce directement : monter un vrai serveur pour observer un
 * appel à `logout` coûterait bien plus que ce que ce test vérifie.
 */
const rejected = (
  client.interceptors.response as unknown as {
    handlers: { rejected: (e: unknown) => Promise<unknown> }[];
  }
).handlers[0].rejected;

const proxyError = (status: number, data: unknown) => ({ response: { status, data } });

const reject = async (err: unknown): Promise<unknown> => {
  // L'intercepteur doit TOUJOURS rejeter : il ne fait que décider s'il
  // déconnecte au passage.
  await expect(rejected(err)).rejects.toBe(err);
  return err;
};

beforeEach(() => {
  logout.mockClear();
});

describe('client — l’intercepteur de réponse et les deux couches d’authentification', () => {
  // Le compte FriRSS (JWT sur `/api/*`) et le serveur FreshRSS rattaché sont
  // deux couches sans rapport. Le proxy relaie le statut amont TEL QUEL : un
  // 401 de FreshRSS — session expirée là-bas, mot de passe d'API changé —
  // arrivait donc avec le même statut que l'expiration de notre JWT, et
  // déconnectait l'utilisateur de FriRSS pour une panne qui ne le concernait
  // pas. Deux couches, une seule réaction.
  it('déconnecte quand le 401 est le nôtre', async () => {
    for (const marker of BACKEND_AUTH_MARKERS) {
      logout.mockClear();
      await reject(proxyError(401, { error: marker }));
      expect(logout, marker).toHaveBeenCalledTimes(1);
    }
  });

  it('ne touche pas à la session quand le 401 vient de FreshRSS', async () => {
    await reject(proxyError(401, 'Unauthorized!'));
    expect(logout).not.toHaveBeenCalled();
  });

  it('ne touche pas à la session sur un corps illisible', async () => {
    // `responseType: 'blob'` / `'arraybuffer'` (images, favicons) : rien à
    // lire. Ne rien affirmer coûte une requête en erreur ; se tromper coûte la
    // session.
    await reject(proxyError(401, new ArrayBuffer(8)));
    expect(logout).not.toHaveBeenCalled();
  });

  it('ne déconnecte sur aucun autre statut', async () => {
    for (const status of [400, 403, 429, 500, 502]) {
      await reject(proxyError(status, { error: 'Token required' }));
    }
    await reject(new Error('Network Error'));
    expect(logout).not.toHaveBeenCalled();
  });
});
