import { describe, it, expect } from 'vitest';
import { entryIdUsec, exclusiveOlderThanEntryId, isOlderEntry } from './entryId';

// Identifiant réel relevé sur un compte FreshRSS : 1 788 386 439 680 550 µs,
// soit le 2 septembre 2026.
const ID = 'tag:google.com,2005:reader/item/00065a872a755226';
const PLUS_ANCIEN = 'tag:google.com,2005:reader/item/00065a09a4bb0ee4';

describe('entryIdUsec', () => {
  it('lit l’identifiant d’entrée caché dans l’identifiant greader', () => {
    expect(entryIdUsec(ID)).toBe('1788386439680550');
  });

  it('lit en hexadécimal même quand les seize caractères sont tous des chiffres', () => {
    // ≈ un article sur 450 : aucune lettre a-f ne tombe dans les treize
    // positions libres. Lu comme du décimal, il vaudrait 280 fois moins.
    expect(entryIdUsec('tag:google.com,2005:reader/item/0006181514495856')).toBe('1715328673994838');
  });

  it('accepte un identifiant déjà décimal, tel que le rend stream/items/ids', () => {
    expect(entryIdUsec('1788386439680550')).toBe('1788386439680550');
  });

  it('rend null sur ce qui n’est pas un identifiant — pas une borne fantaisiste', () => {
    for (const mauvais of ['', 'tag:google.com,2005:reader/item/', 'n’importe quoi']) {
      expect(entryIdUsec(mauvais)).toBeNull();
    }
  });
});

describe('exclusiveOlderThanEntryId', () => {
  it('borne juste en dessous de l’article, pour ne pas l’inclure', () => {
    expect(exclusiveOlderThanEntryId(ID)).toBe('1788386439680549');
  });

  it('rend null quand l’identifiant est illisible', () => {
    expect(exclusiveOlderThanEntryId('inconnu')).toBeNull();
  });
});

describe('isOlderEntry', () => {
  it('compare sans passer par un nombre flottant — 16 chiffres ne tiennent pas dans un double', () => {
    expect(isOlderEntry(PLUS_ANCIEN, ID)).toBe(true);
    expect(isOlderEntry(ID, PLUS_ANCIEN)).toBe(false);
    expect(isOlderEntry(ID, ID)).toBe(false);
  });

  it('range un identifiant illisible comme « pas plus ancien » : dans le doute, on ne marque pas', () => {
    expect(isOlderEntry('inconnu', ID)).toBe(false);
    expect(isOlderEntry(ID, 'inconnu')).toBe(false);
  });
});
