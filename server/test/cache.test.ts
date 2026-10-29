import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { extractKey, cacheKey, userCachePattern } from '../cache.js';

describe('extractKey', () => {
  it('donne la même clé pour la même URL', () => {
    expect(extractKey('https://example.com/a')).toBe(extractKey('https://example.com/a'));
  });

  it('donne des clés différentes pour des URL différentes', () => {
    expect(extractKey('https://example.com/a')).not.toBe(extractKey('https://example.com/b'));
  });

  it("n'a pas le même préfixe que le cache de listes", () => {
    // Les deux vivent dans le même Redis : un préfixe distinct permet de
    // purger l'un sans l'autre et rend les clés lisibles en exploitation.
    expect(extractKey('https://example.com/a').startsWith('frirss:x:')).toBe(true);
    expect(cacheKey(1, 'https://example.com/a').startsWith('frirss:x:')).toBe(false);
  });

  it("ne fait entrer AUCUN identifiant d'utilisateur dans la clé", () => {
    // Garde-fou central de la fonctionnalité : la clé par URL est ce qui fait
    // qu'un appareil profite du travail d'un autre, et qu'à dix comptes le
    // travail est fait une fois. Réintroduire `userId` annulerait tout le
    // partage sans rien casser de visible.
    const src = fs.readFileSync(path.join(process.cwd(), 'server/cache.ts'), 'utf8');
    const body = src.slice(src.indexOf('export function extractKey'));
    const fn = body.slice(0, body.indexOf('\n}'));
    expect(fn).not.toMatch(/user/i);
  });
});

// Supprimer un compte laissait ses listes d'articles en cache jusqu'à
// `CACHE_TTL` (24 h par défaut) : une donnée personnelle qui survivait à la
// suppression demandée. La purge vise ses clés, et elles seules.
describe('userCachePattern', () => {
  const matches = (pattern: string, key: string) =>
    new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(key);

  it('couvre toutes les clés du compte', () => {
    expect(matches(userCachePattern(7), cacheKey(7, 'https://rss.example.com/a'))).toBe(true);
  });
  it('ne touche ni un autre compte ni le cache partagé des extraits', () => {
    expect(matches(userCachePattern(7), cacheKey(70, 'https://rss.example.com/a'))).toBe(false);
    expect(matches(userCachePattern(7), cacheKey(17, 'https://rss.example.com/a'))).toBe(false);
    expect(matches(userCachePattern(7), extractKey('https://example.com/a'))).toBe(false);
  });
});
