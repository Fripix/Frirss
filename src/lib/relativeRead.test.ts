import { describe, it, expect } from 'vitest';
import { exclusiveOlderThanUsec, exclusiveNewerThanSec } from './relativeRead';

describe('exclusiveOlderThanUsec', () => {
  it('convertit les millisecondes en microsecondes', () => {
    // 1 700 000 000 000 ms → 1 700 000 000 000 000 µs, moins une pour l'exclusion
    expect(exclusiveOlderThanUsec(1_700_000_000_000)).toBe('1699999999999999');
  });

  it("exclut l'article cliqué : sa propre borne est strictement avant lui", () => {
    const published = 1_700_000_000_000;
    expect(Number(exclusiveOlderThanUsec(published))).toBeLessThan(published * 1000);
  });

  it("rend une chaîne — l'horodatage part tel quel, sans arithmétique possible", () => {
    expect(typeof exclusiveOlderThanUsec(1_700_000_000_000)).toBe('string');
  });
});

describe('exclusiveNewerThanSec', () => {
  it('convertit les millisecondes en secondes', () => {
    expect(exclusiveNewerThanSec(1_700_000_000_000)).toBe(1_700_000_001);
  });

  it("exclut l'article cliqué : sa borne est strictement après lui", () => {
    const published = 1_700_000_000_000;
    expect(exclusiveNewerThanSec(published)).toBeGreaterThan(published / 1000);
  });

  it("arrondit vers le bas avant d'exclure, pour ne pas sauter deux secondes", () => {
    expect(exclusiveNewerThanSec(1_700_000_000_900)).toBe(1_700_000_001);
  });
});
