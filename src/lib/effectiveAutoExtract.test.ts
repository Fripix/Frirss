import { describe, it, expect } from 'vitest';
import { effectiveAutoExtract } from './effectiveAutoExtract';

// Discussion #19 : « article complet » se réglait flux par flux ; un lecteur
// qui lit toujours l'article entier veut un défaut global. Même moule que la
// disposition et l'ordre : surcharge du flux ?? global.
describe('effectiveAutoExtract', () => {
  it('suit le global quand le flux n’a pas de surcharge', () => {
    expect(effectiveAutoExtract(false, {}, 'feed/1')).toBe(false);
    expect(effectiveAutoExtract(true, {}, 'feed/1')).toBe(true);
  });

  it('la surcharge du flux gagne, dans les deux sens', () => {
    expect(effectiveAutoExtract(false, { 'feed/1': { autoExtract: true } }, 'feed/1')).toBe(true);
    expect(effectiveAutoExtract(true, { 'feed/1': { autoExtract: false } }, 'feed/1')).toBe(false);
  });

  it('ignore la surcharge d’un autre flux', () => {
    expect(effectiveAutoExtract(false, { 'feed/9': { autoExtract: true } }, 'feed/1')).toBe(false);
  });

  it('sans flux connu, suit le global', () => {
    expect(effectiveAutoExtract(true, { 'feed/1': { autoExtract: false } }, undefined)).toBe(true);
  });

  it('un réglage « disposition » seul ne vaut pas surcharge', () => {
    expect(effectiveAutoExtract(true, { 'feed/1': { layout: 'grid' } }, 'feed/1')).toBe(true);
  });
});
