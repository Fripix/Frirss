import { describe, it, expect } from 'vitest';
import { isValidEmail, stripTrailingSlashes, rateLimitIpKey } from '../validate.js';

// Relecture de sécurité 1.8.0 (seconde passe) : deux expressions dont le
// retour arrière était quadratique, appliquées à des valeurs venues du client
// — l'une sans compte, avant même le contrôle « inscriptions fermées ».
const fast = (fn: () => unknown, ms = 50) => {
  const t0 = performance.now();
  fn();
  expect(performance.now() - t0).toBeLessThan(ms);
};

describe('isValidEmail', () => {
  it('accepte une adresse ordinaire', () => {
    expect(isValidEmail('owner@example.com')).toBe(true);
    expect(isValidEmail('a.b+tag@sub.example.co.uk')).toBe(true);
  });

  it('refuse ce qui n’en est pas une', () => {
    for (const v of ['', 'a', 'a@b', '@b.c', 'a@.c', 'a b@c.d', 'a@b..c', 'a@b.c.', 42, null, undefined, {}]) {
      expect(isValidEmail(v)).toBe(false);
    }
  });

  it('refuse une adresse de plus de 254 caractères', () => {
    expect(isValidEmail(`${'a'.repeat(250)}@b.cd`)).toBe(false);
  });

  // `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` : 40 000 points → 1,4 s, 5 Mo → des heures.
  it('répond en temps linéaire sur une rafale de points', () => {
    fast(() => isValidEmail(`a@${'.'.repeat(200_000)} `));
  });
});

describe('stripTrailingSlashes', () => {
  it('retire toutes les barres finales, et elles seules', () => {
    expect(stripTrailingSlashes('https://rss.example.com///')).toBe('https://rss.example.com');
    expect(stripTrailingSlashes('https://rss.example.com/p/')).toBe('https://rss.example.com/p');
    expect(stripTrailingSlashes('https://rss.example.com')).toBe('https://rss.example.com');
    expect(stripTrailingSlashes('///')).toBe('');
  });

  // `/\/+$/` : 40 000 barres suivies d'un caractère → 1,1 s.
  it('répond en temps linéaire sur une rafale de barres non finales', () => {
    fast(() => stripTrailingSlashes(`https://e.com/${'/'.repeat(200_000)}x`));
  });
});

describe('rateLimitIpKey', () => {
  // Derrière `real_ip`, chaque client a son seau : en IPv6, changer d'adresse
  // dans sa /64 (voire /56) en donnait un neuf à chaque essai.
  it('regroupe une IPv6 par /56', () => {
    expect(rateLimitIpKey('2001:db8:1234:5600::1')).toBe(rateLimitIpKey('2001:db8:1234:56ff:ffff::9'));
    expect(rateLimitIpKey('2001:db8:1234:5600::1')).not.toBe(rateLimitIpKey('2001:db8:1234:5700::1'));
  });

  it('comprend les formes abrégées', () => {
    expect(rateLimitIpKey('2001:db8::1')).toBe(rateLimitIpKey('2001:0db8:0000:00ff:1:2:3:4'));
  });

  it('juge une IPv4 mappée comme l’IPv4, et garde une IPv4 telle quelle', () => {
    expect(rateLimitIpKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(rateLimitIpKey('203.0.113.7')).toBe('203.0.113.7');
  });

  it('ne plante pas sans adresse', () => {
    expect(rateLimitIpKey(undefined)).toBe('');
  });
});
