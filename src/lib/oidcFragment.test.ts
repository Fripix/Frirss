import { describe, it, expect } from 'vitest';
import { readOidcFragment } from './oidcFragment';

// Ce que le serveur rend dans le fragment au retour du fournisseur SSO.
describe('readOidcFragment', () => {
  it('lit une connexion, une erreur de connexion, un rattachement et son échec', () => {
    expect(readOidcFragment('#oidc_token=abc')).toEqual({ kind: 'token', token: 'abc' });
    expect(readOidcFragment('#oidc_error=link_required')).toEqual({ kind: 'error', error: 'link_required' });
    expect(readOidcFragment('#oidc_linked=1')).toEqual({ kind: 'linked' });
    expect(readOidcFragment('#oidc_link_error=already_linked')).toEqual({ kind: 'linkError', error: 'already_linked' });
  });

  it('ne lit rien d’autre', () => {
    expect(readOidcFragment('')).toBeNull();
    expect(readOidcFragment('#feed=1')).toBeNull();
  });
});
