import { describe, it, expect } from 'vitest';
import { isPageRefusal } from './extractFailures';

// Un refus n'est retenu pour la session que s'il tient à la PAGE : un refus
// passager du site, ou un refus de FriRSS lui-même, ne doit pas priver
// l'extraction automatique de cette page jusqu'au rechargement.
describe('isPageRefusal', () => {
  it('retient les 4xx propres à la page, que le site a renvoyés', () => {
    for (const status of [400, 401, 403, 404, 410, 451]) expect(isPageRefusal(status, 'site')).toBe(true);
  });

  it('ne retient ni un délai (408) ni une cadence (429), même du site', () => {
    expect(isPageRefusal(408, 'site')).toBe(false);
    expect(isPageRefusal(429, 'site')).toBe(false);
  });

  it('ne retient jamais un 5xx', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(isPageRefusal(status, 'site')).toBe(false);
      expect(isPageRefusal(status, 'proxy')).toBe(false);
    }
  });

  it('ne retient pas un 401/403 de /api/proxy : il peut venir de FriRSS (session expirée, cible refusée)', () => {
    expect(isPageRefusal(401, 'proxy')).toBe(false);
    expect(isPageRefusal(403, 'proxy')).toBe(false);
    expect(isPageRefusal(404, 'proxy')).toBe(true);
  });
});
