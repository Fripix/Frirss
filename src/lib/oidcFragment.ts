/**
 * Ce que le serveur rend dans le fragment (`#…`) au retour du fournisseur SSO.
 * Un fragment, pas une chaîne de requête : il n'est jamais envoyé au serveur
 * ni écrit dans un journal.
 *
 * - `oidc_token` : connexion réussie ;
 * - `oidc_error` : connexion refusée (`link_required` : un compte local porte
 *   cette adresse, il se rattache depuis ses Préférences) ;
 * - `oidc_linked` / `oidc_link_error` : issue d'un rattachement lancé depuis
 *   Préférences › Général › Compte, session inchangée ;
 * - `oidc_link_ticket` : retour d'un rattachement, à valider depuis la session
 *   qui l'a lancé (`completeOidcLink`) — le retour seul ne rattache rien.
 */
export type OidcFragment =
  | { kind: 'token'; token: string }
  | { kind: 'error'; error: string }
  | { kind: 'linked' }
  | { kind: 'linkError'; error: string }
  | { kind: 'linkTicket'; ticket: string };

export function readOidcFragment(hash: string): OidcFragment | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const token = params.get('oidc_token');
  if (token) return { kind: 'token', token };
  const error = params.get('oidc_error');
  if (error) return { kind: 'error', error };
  if (params.get('oidc_linked')) return { kind: 'linked' };
  const linkError = params.get('oidc_link_error');
  if (linkError) return { kind: 'linkError', error: linkError };
  const ticket = params.get('oidc_link_ticket');
  if (ticket) return { kind: 'linkTicket', ticket };
  return null;
}

/**
 * Où dire une `oidc_error`. Le serveur ne la distingue pas selon le parcours
 * quand l'état n'a pas pu être lu (fournisseur annulé, état expiré) : avec une
 * session ouverte, c'est forcément un rattachement — on ne se connecte pas
 * en étant connecté. Sans session, c'est l'écran de connexion.
 */
export function oidcErrorTarget(signedIn: boolean): 'linkToast' | 'loginScreen' {
  return signedIn ? 'linkToast' : 'loginScreen';
}

/** Clé i18n d'une `oidc_error` à l'écran de connexion. */
export function oidcErrorKey(error: string): string {
  if (error === 'unavailable') return 'login.errorUnavailable';
  if (error === 'link_required') return 'login.errorSsoLinkRequired';
  if (error === 'too_many') return 'login.errorTooMany';
  return 'login.errorSso';
}
