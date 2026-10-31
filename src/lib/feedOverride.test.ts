import { describe, it, expect } from 'vitest';
import { feedOverride, isServerKey, serverViewKey } from './feedOverride';
import { effectiveLayout } from './effectiveLayout';
import { effectiveOrder } from './effectiveOrder';

/*
 * FreshRSS numérote les flux par serveur : `feed/12` n'est pas le même flux d'un
 * serveur à l'autre, et son ordre ou sa disposition passaient de l'un à l'autre.
 */
describe('réglages d’un flux, par serveur', () => {
  it('la clé porte le serveur et la vue', () => {
    expect(serverViewKey(1, 'feed/12')).toBe('1|feed/12');
    expect(serverViewKey('2', '')).toBe('2|');
  });

  it('reconnaît une clé de serveur, pas un flux ni une étiquette contenant une barre', () => {
    expect(isServerKey('1|feed/12')).toBe(true);
    expect(isServerKey('feed/12')).toBe(false);
    expect(isServerKey('user/-/label/a|b')).toBe(false);
  });

  it('un serveur ne voit pas le réglage de l’autre', () => {
    const settings = { '1|feed/12': { order: 'oldest', layout: 'grid' } } as never;
    expect(effectiveOrder('newest', settings, 'feed/12', 1)).toBe('oldest');
    expect(effectiveOrder('newest', settings, 'feed/12', 2)).toBe('newest');
    expect(effectiveLayout('3', settings, 'feed/12', 1)).toBe('grid');
    expect(effectiveLayout('3', settings, 'feed/12', 2)).toBe('3');
  });

  // Avant l'adoption, un réglage de la version publiée ne doit pas sauter.
  it('un ancien réglage reste lu tant qu’il n’est pas rattaché', () => {
    const settings = { 'feed/12': { order: 'oldest' } } as never;
    expect(effectiveOrder('newest', settings, 'feed/12', 1)).toBe('oldest');
    expect(feedOverride(settings, 1, 'feed/12').order).toBe('oldest');
  });

  it('le réglage du serveur passe devant l’ancien', () => {
    const settings = { 'feed/12': { layout: '2' }, '1|feed/12': { layout: 'grid' } } as never;
    expect(effectiveLayout('3', settings, 'feed/12', 1)).toBe('grid');
  });

  it('sans serveur, l’ancienne lecture reste', () => {
    expect(effectiveOrder('newest', { 'feed/1': { order: 'oldest' } }, 'feed/1')).toBe('oldest');
  });
});
