// @vitest-environment jsdom
//
// Les entités nommées que la table de `readingBody.ts` ne porte pas : dans le
// navigateur, il les décode lui-même (relecture du troisième round : « décode
// toutes les entités nommées »).
import { describe, it, expect } from 'vitest';
import { extractWorthShowing } from './readingBody';

describe('extractWorthShowing — entités hors table, dans le navigateur', () => {
  it('&fjlig; (HTML 5) compte comme « fj » : le navigateur décode ce que la table ne connaît pas', () => {
    const words = Array.from({ length: 24 }, (_, i) => `fj${String.fromCharCode(97 + i)}ord`);
    const encoded = words.join(' ').replace(/fj/g, '&fjlig;');
    expect(extractWorthShowing(`<p>${encoded}</p>`, `<p>${words.join(' ')}.</p>`)).toBe(true);
  });
  it('une entité inconnue reste un séparateur, sans rien injecter', () => {
    const words = Array.from({ length: 24 }, (_, i) => `mot${String.fromCharCode(97 + i)}long`);
    const feed = `<p>${words.join(' &pasuneentite; ')}</p>`;
    expect(extractWorthShowing(feed, `<p>${words.join(' ')}.</p>`)).toBe(true);
  });
});
