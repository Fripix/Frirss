import { describe, it, expect } from 'vitest';
import { languageDir } from './textDirection';

describe('languageDir', () => {
  it('droite à gauche pour les langues en écriture arabe ou hébraïque', () => {
    for (const l of ['ar', 'fa', 'fa-IR', 'he', 'iw', 'ur', 'ps', 'yi', 'ckb', 'dv', 'AR']) expect([l, languageDir(l)]).toEqual([l, 'rtl']);
  });
  it('gauche à droite pour une langue connue qui ne l’est pas', () => {
    for (const l of ['fr', 'en-US', 'zh-Hans', 'ja', 'uk', 'hi', 'th']) expect([l, languageDir(l)]).toEqual([l, 'ltr']);
  });
  it('la sous-étiquette d’écriture l’emporte : kurde ou pendjabi en écriture arabe, arabe latinisé', () => {
    expect(languageDir('ku-Arab')).toBe('rtl');
    expect(languageDir('pa-Arab-PK')).toBe('rtl');
    expect(languageDir('ar-Latn')).toBe('ltr');
    expect(languageDir('ku')).toBe('ltr');
  });
  it('auto quand la langue est inconnue ou illisible', () => {
    expect(languageDir(null)).toBe('auto');
    expect(languageDir(undefined)).toBe('auto');
    expect(languageDir('')).toBe('auto');
    expect(languageDir('!!')).toBe('auto');
  });
});
