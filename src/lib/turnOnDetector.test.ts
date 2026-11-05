import { describe, it, expect } from 'vitest';
import { createTurnOnDetector } from './turnOnDetector';

describe('createTurnOnDetector', () => {
  it('ne réagit pas à un remontage qui revoit la même valeur', () => {
    // R-5 : chaque remontage de la barre latérale (`b`, sortie du mode Focus)
    // relançait quatre requêtes alors que rien n'avait changé.
    const turnedOn = createTurnOnDetector(true);
    expect(turnedOn(true)).toBe(false);
    expect(turnedOn(true)).toBe(false);
  });

  it('réagit quand le réglage s’allume, une fois', () => {
    const turnedOn = createTurnOnDetector(false);
    expect(turnedOn(false)).toBe(false);
    expect(turnedOn(true)).toBe(true);
    expect(turnedOn(true)).toBe(false);
  });

  it('s’en souvient hors du composant : allumé pendant que la barre était démontée', () => {
    const turnedOn = createTurnOnDetector(false);
    // Démontée : personne n'appelle. Remontée avec le réglage allumé.
    expect(turnedOn(true)).toBe(true);
  });

  it('éteindre ne déclenche rien, rallumer redéclenche', () => {
    const turnedOn = createTurnOnDetector(true);
    expect(turnedOn(false)).toBe(false);
    expect(turnedOn(true)).toBe(true);
  });
});
