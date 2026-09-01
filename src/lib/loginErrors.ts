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
  return 'login.errorServer';
}
