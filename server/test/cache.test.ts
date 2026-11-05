import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { extractKey, cacheKey, userCachePattern, cacheableEntry, claimCacheRead, MAX_CACHED_ENTRY_BYTES, MAX_CACHE_READS_AT_ONCE, MAX_CACHE_READ_BYTES_PER_MINUTE } from '../cache.js';
import { EXTRACT_VERSION } from '../extractVersion.js';
import { EXTRACT_VERSION as CLIENT_EXTRACT_VERSION } from '../../src/lib/extractVersion.js';

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

  // A-2 (campagne 1.9.0) : un extrait gardé avant un changement de
  // l'algorithme (l'avis tronqué d'avant L-04/A-1) restait servi jusqu'à
  // `CACHE_TTL`, et le client le recopiait dans son propre cache.
  it('ne relit pas un extrait écrit par une version antérieure de l’extraction', () => {
    expect(extractKey('https://example.com/a')).toBe(extractKey('https://example.com/a', EXTRACT_VERSION));
    expect(extractKey('https://example.com/a')).not.toBe(extractKey('https://example.com/a', EXTRACT_VERSION - 1));
  });

  it('porte la même version d’extraction que le cache du navigateur', () => {
    // Le navigateur garde ce que le serveur lui a rendu : monter l'une sans
    // l'autre laisserait l'ancien extrait vivre d'un côté.
    expect(EXTRACT_VERSION).toBe(CLIENT_EXTRACT_VERSION);
    expect(EXTRACT_VERSION).toBeGreaterThan(1);
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

describe('cacheableEntry', () => {
  it('rend tel quel un JSON ordinaire', () => {
    expect(cacheableEntry('{"items":[{"id":1}]}')).toBe('{"items":[{"id":1}]}');
    expect(cacheableEntry('[1,2]')).toBe('[1,2]');
  });

  it('garde les articles les plus récents', () => {
    const out = cacheableEntry(JSON.stringify({ items: [1, 2, 3], continuation: 'c' }), 2);
    expect(JSON.parse(out as string)).toEqual({ items: [1, 2], continuation: 'c' });
  });

  it('refuse ce qui ne s’analyse pas, ou n’est pas un objet', () => {
    expect(cacheableEntry('pas du JSON')).toBeNull();
    expect(cacheableEntry('')).toBeNull();
    expect(cacheableEntry('null')).toBeNull();
    expect(cacheableEntry('"une chaîne"')).toBeNull();
    expect(cacheableEntry('42')).toBeNull();
  });

  it('refuse ce qui dépasse le plafond, en octets et pas en caractères', () => {
    const fits = (n: number) => cacheableEntry(JSON.stringify({ c: 'é'.repeat(n) }), 50, 1000);
    expect(fits(400)).not.toBeNull();
    expect(fits(600)).toBeNull();
    expect(cacheableEntry(JSON.stringify({ c: 'x'.repeat(MAX_CACHED_ENTRY_BYTES) }))).toBeNull();
  });

  it('coupe à `max` articles ce qui tient sous le plafond', () => {
    const body = JSON.stringify({ items: Array.from({ length: 200 }, () => 'x'.repeat(1000)) });
    const out = cacheableEntry(body, 50, 300_000);
    expect((JSON.parse(out as string) as { items: unknown[] }).items).toHaveLength(50);
  });

  // Le corps vient d'un hôte choisi par le compte : analyser 31 Mio de petits
  // objets à chaque lecture bloquait la boucle d'événements 5 s d'affilée, pour
  // rien puisque ce n'était pas gardé. La taille se juge AVANT l'analyse.
  it('n’analyse pas un corps au-delà du plafond', () => {
    const parse = vi.spyOn(JSON, 'parse');
    try {
      expect(cacheableEntry(JSON.stringify({ c: 'x'.repeat(2000) }), 50, 1000)).toBeNull();
      expect(parse).not.toHaveBeenCalled();
    } finally { parse.mockRestore(); }
  });

  // Un FreshRSS dont une extension PHP préfixe un BOM perdait son cache.
  it('accepte un corps préfixé d’un BOM, et le retire', () => {
    expect(cacheableEntry('\uFEFF{"items":[]}')).toBe('{"items":[]}');
  });
});

// Un compte choisit le corps reçu : il enregistre l'hôte qu'il veut comme serveur.
// Lire pour le cache garde tout en mémoire, l'analyser bloque le serveur pour tous.
describe('claimCacheRead', () => {
  const claims = (user: number, n: number, now = 0) => Array.from({ length: n }, () => claimCacheRead(user, now));

  it('borne les lectures simultanées d’un compte, sans toucher aux autres', () => {
    const held = claims(101, MAX_CACHE_READS_AT_ONCE);
    expect(held.every(Boolean)).toBe(true);
    expect(claimCacheRead(101, 0)).toBeNull();
    expect(claimCacheRead(102, 0)).not.toBeNull();
  });

  it('une lecture finie rend sa place', () => {
    const held = claims(103, MAX_CACHE_READS_AT_ONCE);
    held[0]!.done(0);
    expect(claimCacheRead(103, 0)).not.toBeNull();
  });

  it('borne les octets par minute, puis repart', () => {
    claimCacheRead(104, 0)!.done(MAX_CACHE_READ_BYTES_PER_MINUTE);
    expect(claimCacheRead(104, 59_999)).toBeNull();
    expect(claimCacheRead(104, 60_000)).not.toBeNull();
  });
});

describe('cacheableEntry, imbrication extrême', () => {
  it('rend null au lieu de lever : la réponse est déjà partie', () => {
    const deep = `${'['.repeat(4_000_000)}${']'.repeat(4_000_000)}`;
    const body = `{"items":[${Array(60).fill('1').join(',')}],"x":${deep}}`;
    expect(cacheableEntry(body)).toBeNull();
  });
});
