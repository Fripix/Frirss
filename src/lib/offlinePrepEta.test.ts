import { describe, it, expect } from 'vitest';
import { prepRemainingMs, etaParts } from './offlinePrepEta';

// Idée de la campagne 1.9.0 : une préparation de 6 000 articles dure ~40 min,
// et rien ne le disait.
describe('prepRemainingMs', () => {
  it('extrapole le rythme observé sur ce qui reste', () => {
    // 100 articles en 40 s → 0,4 s l'article ; 5 900 restants → 2 360 s.
    expect(prepRemainingMs({ startedAt: 0, now: 40_000, done: 100, total: 6000 })).toBe(2_360_000);
  });

  it('se tait tant que la mesure est trop jeune pour valoir quelque chose', () => {
    expect(prepRemainingMs({ startedAt: 0, now: 40_000, done: 5, total: 6000 })).toBeNull();
    expect(prepRemainingMs({ startedAt: 0, now: 2_000, done: 50, total: 6000 })).toBeNull();
  });

  it('se tait sans départ connu, ou une fois tout fait', () => {
    expect(prepRemainingMs({ startedAt: undefined, now: 40_000, done: 100, total: 6000 })).toBeNull();
    expect(prepRemainingMs({ startedAt: 0, now: 40_000, done: 6000, total: 6000 })).toBeNull();
  });
});

describe('etaParts', () => {
  it('moins d’une minute', () => {
    expect(etaParts(30_000)).toEqual({ kind: 'soon' });
  });

  it('en minutes, arrondies à la minute supérieure', () => {
    expect(etaParts(61_000)).toEqual({ kind: 'minutes', minutes: 2 });
    expect(etaParts(39 * 60_000 + 1)).toEqual({ kind: 'minutes', minutes: 40 });
  });

  it('en heures et minutes au-delà d’une heure', () => {
    expect(etaParts(2 * 3_600_000 + 9 * 60_000 + 1)).toEqual({ kind: 'hours', hours: 2, minutes: 10 });
    expect(etaParts(3_600_000)).toEqual({ kind: 'minutes', minutes: 60 });
  });
});
