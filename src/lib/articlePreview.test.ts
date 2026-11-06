// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { previewText, PREVIEW_LENGTH } from './articlePreview';

describe('previewText', () => {
  it('retire les balises et décode les entités (M-14)', () => {
    expect(previewText('<p>Health &amp; Bioscience, AT&amp;T&#8217;s</p>')).toBe('Health & Bioscience, AT&T’s');
  });

  it('une balise échappée reste du texte : le décodage vient après le retrait', () => {
    expect(previewText('Vec&lt;String&gt;')).toBe('Vec<String>');
  });

  it('coupe au nombre de caractères décodés, pas à celui du HTML', () => {
    expect(previewText('&eacute;'.repeat(PREVIEW_LENGTH + 10))).toBe('é'.repeat(PREVIEW_LENGTH));
  });

  it('un très long corps ne laisse pas d’entité coupée dans l’aperçu', () => {
    const out = previewText(`<p>${'mot '.repeat(2000)}&amp; fin</p>`);
    expect(out).toHaveLength(PREVIEW_LENGTH);
    expect(out).not.toContain('&');
  });

  it('vide sans résumé', () => {
    expect(previewText(undefined)).toBe('');
    expect(previewText('')).toBe('');
  });
});
