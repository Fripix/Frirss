import { isBackendAuthFailure } from './loginErrors';
import type { User } from '../types';

/** Attentes avant chacun des quatre réessais de `getMe()` (en ms). */
export const OIDC_RETRY_WAITS_MS = [1000, 2000, 4000, 8000];

/**
 * Délai de chaque lecture de l'utilisateur pendant ces réessais. Avec le délai
 * par défaut (75 s, `TIMEOUT_DEFAULT_MS`), un serveur muet tenait 5 × 75 s +
 * 15 s ≈ 6,5 min avant l'échec final — qui déconnectait une session que
 * l'utilisateur avait pu poursuivre. `/api/auth/me` ne fait aucun appel amont
 * (une lecture de session et d'utilisateur en base) : la règle « le serveur
 * répond avant que le client abandonne » (`requestTimeouts.ts`) tient. Pire
 * cas : 5 × 15 s + 15 s = 90 s.
 */
export const OIDC_GETME_TIMEOUT_MS = 15_000;

export interface OidcReturnDeps {
  getMe: (opts: { timeout: number }) => Promise<User>;
  setAuth: (token: string, user: User) => void;
  logout: () => void;
  wait: (ms: number) => Promise<void>;
  /** Appelé après le dernier échec réseau, pour l'annoncer à l'écran de connexion. */
  onUnavailable?: () => void;
  /**
   * Le jeton de la session en cours (store). Si ce n'est plus celui qu'on
   * termine — déconnexion, ou autre connexion pendant les réessais —, on
   * s'arrête sans rien toucher : ni `setAuth` (qui ressusciterait la session
   * fermée), ni `logout` (qui fermerait celle de quelqu'un d'autre), ni
   * l'annonce d'échec.
   */
  currentToken: () => string | null;
}

/** Pas de réponse (réseau coupé, délai) ou panne serveur : réessayable. */
function isTransient(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status;
  return status === undefined || status >= 500;
}

/**
 * Termine le retour SSO : le jeton vient d'être posé, il reste à lire
 * l'utilisateur.
 *
 * Avant, TOUTE erreur de `getMe()` fermait la session : un hoquet réseau juste
 * après la redirection renvoyait l'utilisateur à l'écran de connexion, alors
 * que son jeton était valide. Désormais seule une session réellement invalide
 * (notre 401, ou tout autre 4xx : le jeton est inutilisable) déconnecte tout
 * de suite ; une panne passagère est réessayée avec une attente croissante, et
 * on ne se déconnecte qu'après le dernier échec — jamais d'écran bloqué avec
 * un jeton et un utilisateur vide.
 */
export async function completeOidcReturn(token: string, deps: OidcReturnDeps): Promise<void> {
  const stale = () => deps.currentToken() !== token;
  for (let attempt = 0; ; attempt++) {
    try {
      const user = await deps.getMe({ timeout: OIDC_GETME_TIMEOUT_MS });
      if (stale()) return;
      deps.setAuth(token, user);
      return;
    } catch (err) {
      if (stale()) return;
      if (isBackendAuthFailure(err) || !isTransient(err)) {
        deps.logout();
        return;
      }
      if (attempt >= OIDC_RETRY_WAITS_MS.length) {
        deps.logout();
        deps.onUnavailable?.();
        return;
      }
      await deps.wait(OIDC_RETRY_WAITS_MS[attempt]);
      if (stale()) return;
    }
  }
}
