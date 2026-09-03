import { describe, it, expect } from 'vitest';
import { readProgressPercent } from './readProgress';

describe('readProgressPercent', () => {
  it('rend 100 % pour un article qui tient à l’écran', () => {
    expect(readProgressPercent(0, 600, 800)).toBe(100);
    expect(readProgressPercent(0, 800, 800)).toBe(100);
  });

  it('rend 0 % en haut d’un article défilable', () => {
    expect(readProgressPercent(0, 5000, 800)).toBe(0);
  });

  it('rend 100 % en bas', () => {
    expect(readProgressPercent(4200, 5000, 800)).toBe(100);
  });

  it('arrondit la position intermédiaire', () => {
    expect(readProgressPercent(2100, 5000, 800)).toBe(50);
  });

  // Le rebond élastique d'iOS remonte au-dessus de zéro et pousse au-delà du
  // bas : la barre ne doit ni devenir négative ni dépasser sa piste.
  it('borne le rebond élastique des deux côtés', () => {
    expect(readProgressPercent(-120, 5000, 800)).toBe(0);
    expect(readProgressPercent(4600, 5000, 800)).toBe(100);
  });
});
