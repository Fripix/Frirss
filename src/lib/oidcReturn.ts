import { isBackendAuthFailure } from './loginErrors';
import type { User } from '../types';

/** Attentes avant chacun des quatre réessais de `getMe()` (en ms). */
export const OIDC_RETRY_WAITS_MS = [1000, 2000, 4000, 8000];

export interface OidcReturnDeps {
  getMe: () => Promise<User>;
  setAuth: (token: string, user: User) => void;
  logout: () => void;
  wait: (ms: number) => Promise<void>;
  /** Appelé après le dernier échec réseau, pour l'annoncer à l'écran de connexion. */
  onUnavailable?: () => void;
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
  for (let attempt = 0; ; attempt++) {
    try {
      const user = await deps.getMe();
      deps.setAuth(token, user);
      return;
    } catch (err) {
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
    }
  }
}
