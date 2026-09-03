/**
 * Clé i18n décrivant un échec de connexion.
 *
 * L'écran affirmait « identifiants incorrects » pour TOUTE panne : un 429, un
 * 500 ou une coupure réseau donnaient le même message qu'un mot de passe
 * erroné. Le message accusait une cause qu'il n'avait pas vérifiée, et envoyait
 * l'utilisateur retaper indéfiniment un mot de passe pourtant juste.
 *
 * Seul un 401 dit réellement « ces identifiants ne conviennent pas ».
 */
export function loginErrorKey(err: unknown): string {
  const status = (err as { response?: { status?: number } })?.response?.status;
  if (status === 401 || status === 403) return 'login.errorLogin';
  if (status === 429) return 'login.errorTooMany';
  return 'login.errorUnavailable';
}

/**
 * Marqueur renvoyé par la garde anti-SSRF du proxy quand elle refuse une
 * cible (`server/routes/proxy.ts`). Le corps est notre propre JSON, jamais
 * celui de FreshRSS : c'est ce qui permet de distinguer notre refus d'un 403
 * relayé depuis l'amont, puisque le proxy transmet le statut amont tel quel.
 */
export const BLOCKED_TARGET_MARKER = 'Target host not allowed';

/**
 * Messages des 401 émis par NOTRE middleware d'authentification
 * (`server/middleware/auth.ts`), avant que la requête n'atteigne FreshRSS.
 *
 * Le tri des 401 se fait par exclusion — voir `serverConnectErrorKey`.
 */
export const BACKEND_AUTH_MARKERS = ['Token required', 'Session expired', 'Invalid token'];

/**
 * Ce 401 est-il le NÔTRE, c'est-à-dire celui de `server/middleware/auth.ts` ?
 *
 * FriRSS a deux couches d'authentification sans rapport : le compte FriRSS (un
 * JWT qui protège `/api/*`) et le serveur FreshRSS rattaché (API Google
 * Reader). Le proxy relaie le **statut amont tel quel**, donc un 401 de
 * FreshRSS — session expirée là-bas, mot de passe d'API changé — arrive avec
 * le même statut que l'expiration de notre JWT. L'intercepteur de
 * `src/api/client.ts` déconnectait sur les deux : une panne d'une couche
 * fermait la session de l'autre.
 *
 * Seuls nos propres messages font foi. Un corps illisible (`responseType`
 * binaire des images et des favicons) ou inconnu n'est PAS attribué à FriRSS :
 * ne rien affirmer coûte une requête en erreur, se tromper coûte la session.
 */
export function isBackendAuthFailure(err: unknown): boolean {
  const res = (err as { response?: { status?: number; data?: unknown } })?.response;
  if (res?.status !== 401) return false;
  const body = bodyText(res.data);
  return BACKEND_AUTH_MARKERS.some((m) => body.includes(m));
}

/** Corps de réponse rendu en texte, que axios l'ait parsé ou non. */
function bodyText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object') {
    const err = (data as { error?: unknown }).error;
    if (typeof err === 'string') return err;
  }
  return '';
}

/**
 * Clé i18n décrivant l'échec d'un rattachement de serveur FreshRSS.
 *
 * L'écran affichait « connexion au serveur impossible » pour toute panne, y
 * compris celle que le backend savait nommer précisément : héberger FreshRSS
 * sur une IP privée fait refuser la cible par la garde anti-SSRF, et rien ne
 * disait que `PROXY_INTERNAL_HOSTS` existait. Le cas majoritaire de
 * l'auto-hébergement produisait le message le moins exploitable.
 *
 * Seul notre propre refus est nommé. Tout le reste — 401 de FreshRSS, hôte
 * injoignable, coupure réseau — garde le message générique : mieux vaut ne
 * rien affirmer que d'accuser une cause non vérifiée.
 */
export function serverConnectErrorKey(err: unknown): string {
  const res = (err as { response?: { status?: number; data?: unknown } })?.response;
  if (res?.status === 403 && bodyText(res.data).includes(BLOCKED_TARGET_MARKER)) {
    return 'login.errorServerBlocked';
  }
  // Un 401 vient soit de FreshRSS (greader.php répond « Unauthorized! » pour un
  // mot de passe d'API faux **comme** pour un mot de passe jamais défini), soit
  // de notre propre middleware si le JWT FriRSS a expiré. Le second cas est
  // écarté par ses marqueurs plutôt que le premier reconnu par les siens : les
  // nôtres sont dans ce dépôt, donc vérifiables contre la dérive, alors qu'une
  // reformulation côté FreshRSS nous échapperait — et se tromper de sens ferait
  // accuser le mot de passe de l'utilisateur quand c'est sa session qui a fondu.
  if (res?.status === 401) {
    const body = bodyText(res.data);
    if (!BACKEND_AUTH_MARKERS.some((m) => body.includes(m))) {
      return 'login.errorServerCredentials';
    }
  }
  return 'login.errorServer';
}
