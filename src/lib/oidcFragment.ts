/**
 * Ce que le serveur rend dans le fragment (`#…`) au retour du fournisseur SSO.
 * Un fragment, pas une chaîne de requête : il n'est jamais envoyé au serveur
 * ni écrit dans un journal.
 *
 * - `oidc_token` : connexion réussie ;
 * - `oidc_error` : connexion refusée (`link_required` : un compte local porte
 *   cette adresse, il se rattache depuis ses Préférences) ;
 * - `oidc_linked` / `oidc_link_error` : issue d'un rattachement lancé depuis
 *   Préférences › Général › Compte, session inchangée.
 */
export type OidcFragment =
  | { kind: 'token'; token: string }
  | { kind: 'error'; error: string }
  | { kind: 'linked' }
  | { kind: 'linkError'; error: string };

export function readOidcFragment(hash: string): OidcFragment | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const token = params.get('oidc_token');
  if (token) return { kind: 'token', token };
  const error = params.get('oidc_error');
  if (error) return { kind: 'error', error };
  if (params.get('oidc_linked')) return { kind: 'linked' };
  const linkError = params.get('oidc_link_error');
  if (linkError) return { kind: 'linkError', error: linkError };
  return null;
}
