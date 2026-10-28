import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';

// L'intercepteur appelle `logoutBackend()` sur le store d'authentification ; on
// ne veut ni sa persistance ni son vrai effet, seulement savoir s'il a été
// appelé. Aucune requête n'est émise ici, seul le chemin d'erreur est exercé.
const logoutBackend = vi.fn();
let backendToken: string | null = null;
vi.mock('../stores/authStore', () => ({
  useAuthStore: {
    getState: () => ({ backendToken, logoutBackend }),
  },
}));

import { BACKEND_AUTH_MARKERS } from '../lib/loginErrors';
import { TIMEOUT_DEFAULT_MS, TIMEOUT_AI_MS, TIMEOUT_BACKUP_MS } from '../lib/requestTimeouts';
import backend, {
  requestAiSummary, requestAiTranslation, testAiProvider, listAiModels,
  createBackup, previewRestore, applyRestore, getAuthStatus,
} from './backend';

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

// Une requête partie avec le jeton de A peut recevoir son 401 après qu'un
// autre jeton a été posé (retour SSO pendant les réessais de `getMe`, jeton
// renouvelé). Ce 401 parle de A : il ne ferme pas la session en place.
describe('backend — un 401 ne ferme que la session à laquelle il répond', () => {
  afterEach(() => { backendToken = null; });
  const sentWith = (token: string | null, error: string) => ({
    config: { headers: new AxiosHeaders(token ? { Authorization: `Bearer ${token}` } : {}) },
    response: { status: 401, data: { error } },
  });

  it('déconnecte quand le 401 répond au jeton en place', async () => {
    backendToken = 'A';
    await reject(sentWith('A', 'Session expired'));
    expect(logoutBackend).toHaveBeenCalledTimes(1);
  });

  it('ignore le 401 d’une requête partie avec un jeton remplacé depuis', async () => {
    backendToken = 'B';
    await reject(sentWith('A', 'Session expired'));
    expect(logoutBackend).not.toHaveBeenCalled();
  });

  it('ignore le 401 d’une requête partie sans jeton, une session ouverte depuis', async () => {
    backendToken = 'B';
    await reject(sentWith(null, 'Token required'));
    expect(logoutBackend).not.toHaveBeenCalled();
  });
});

describe('backend — délais', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('borne tout appel par défaut', () => {
    expect(backend.defaults.timeout).toBe(TIMEOUT_DEFAULT_MS);
  });

  it('un appel court garde le délai par défaut', async () => {
    const get = vi.spyOn(backend, 'get').mockResolvedValue({ data: {} });
    await getAuthStatus();
    expect(get.mock.calls[0][1]?.timeout).toBeUndefined();
  });

  // Le serveur borne lui-même ses appels IA (résumé 50 s, traduction jusqu'à
  // 110 s) et nginx coupe à 120 s : le client doit attendre plus longtemps
  // qu'eux, sinon il abandonne avant la réponse et `isUpstreamCut` y lit une
  // coupure amont.
  it('accorde aux appels IA le délai long', async () => {
    const post = vi.spyOn(backend, 'post').mockResolvedValue({ data: {} });
    await requestAiSummary({ articleId: 'a', title: 't', html: '<p>x</p>' });
    await requestAiTranslation({ articleId: 'a', scope: 'article', targetLang: 'fr', segments: ['x'] });
    await testAiProvider(1);
    await listAiModels({ type: 'openai', baseUrl: 'https://example.com' });
    expect(post).toHaveBeenCalledTimes(4);
    for (const c of post.mock.calls) expect(c[2]?.timeout, String(c[0])).toBe(TIMEOUT_AI_MS);
  });

  it('accorde à la sauvegarde et à la restauration le délai long', async () => {
    const post = vi.spyOn(backend, 'post').mockResolvedValue({ data: { backup: {} } });
    await createBackup('phrase');
    await previewRestore({}, 'phrase', false);
    await applyRestore({}, 'phrase', true);
    expect(post).toHaveBeenCalledTimes(3);
    for (const c of post.mock.calls) expect(c[2]?.timeout, String(c[0])).toBe(TIMEOUT_BACKUP_MS);
  });

  // Un délai dépassé n'a pas de réponse : ce n'est jamais un 401, jamais une
  // raison de fermer la session.
  it('ne déconnecte pas sur un délai dépassé (ECONNABORTED)', async () => {
    await reject(new AxiosError(`timeout of ${TIMEOUT_DEFAULT_MS}ms exceeded`, AxiosError.ECONNABORTED));
    expect(logoutBackend).not.toHaveBeenCalled();
  });
});
