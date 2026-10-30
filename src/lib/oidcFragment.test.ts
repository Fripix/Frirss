import { describe, it, expect } from 'vitest';
import { readOidcFragment, oidcErrorTarget, oidcErrorKey } from './oidcFragment';

// Ce que le serveur rend dans le fragment au retour du fournisseur SSO.
describe('readOidcFragment', () => {
  it('lit une connexion, une erreur de connexion, un rattachement et son échec', () => {
    expect(readOidcFragment('#oidc_token=abc')).toEqual({ kind: 'token', token: 'abc' });
    expect(readOidcFragment('#oidc_error=link_required')).toEqual({ kind: 'error', error: 'link_required' });
    expect(readOidcFragment('#oidc_linked=1')).toEqual({ kind: 'linked' });
    expect(readOidcFragment('#oidc_link_error=already_linked')).toEqual({ kind: 'linkError', error: 'already_linked' });
    expect(readOidcFragment('#oidc_link_ticket=a.b.c')).toEqual({ kind: 'linkTicket', ticket: 'a.b.c' });
  });

  it('ne lit rien d’autre', () => {
    expect(readOidcFragment('')).toBeNull();
    expect(readOidcFragment('#feed=1')).toBeNull();
  });
});

describe('oidcErrorTarget', () => {
  // Le retour d'un rattachement annulé chez le fournisseur (ou refusé avant
  // que le serveur ait lu l'état) arrive en `oidc_error`, comme un échec de
  // connexion. Session ouverte, il ne s'affichait nulle part — puis
  // réapparaissait à l'écran de connexion après une déconnexion.
  it('session ouverte : un échec de rattachement, annoncé tout de suite', () => {
    expect(oidcErrorTarget(true)).toBe('linkToast');
  });

  it('sans session : un échec de connexion, sur l’écran de connexion', () => {
    expect(oidcErrorTarget(false)).toBe('loginScreen');
  });
});

describe('oidcErrorKey', () => {
  // Le retour SSO est limité : « trop de tentatives » n'est pas un refus du
  // fournisseur, et le message générique envoyait chercher ailleurs.
  it('nomme chaque refus du retour SSO', () => {
    expect(oidcErrorKey('too_many')).toBe('login.errorTooMany');
    expect(oidcErrorKey('unavailable')).toBe('login.errorUnavailable');
    expect(oidcErrorKey('link_required')).toBe('login.errorSsoLinkRequired');
    expect(oidcErrorKey('state_mismatch')).toBe('login.errorSso');
  });
});
