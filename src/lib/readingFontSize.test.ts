import { describe, it, expect } from 'vitest';
import { READING_BODY_BOUNDS, MOBILE_READING_DEFAULT, clampReadingBody } from './readingFontSize';

describe('taille du corps de lecture', () => {
  it('une seule paire de bornes par appareil, partagée par le curseur et A− / A+', () => {
    expect(READING_BODY_BOUNDS.desktop).toEqual({ min: 10, max: 24 });
    expect(READING_BODY_BOUNDS.touch).toEqual({ min: 13, max: 26 });
    expect(MOBILE_READING_DEFAULT).toBe(17);
  });

  it('ramène une valeur hors bornes dans la plage de son appareil', () => {
    expect(clampReadingBody(8, false)).toBe(10);
    expect(clampReadingBody(30, false)).toBe(24);
    expect(clampReadingBody(8, true)).toBe(13);
    expect(clampReadingBody(30, true)).toBe(26);
    expect(clampReadingBody(15, true)).toBe(15);
  });
});
