// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sanitizeExtracted } from './extractContent';

// L'assainissement du contenu extrait est plus permissif que celui du contenu
// de flux, et il doit l'être : sans <iframe>, une vidéo intégrée à un article
// extrait disparaîtrait avant qu'`injectVideoFacades` puisse la voir. Ces tests
// figent la frontière exacte de cette permission.
describe('sanitizeExtracted', () => {
  it('strips scripts and event handlers like any untrusted HTML', () => {
    expect(sanitizeExtracted('<p>ok</p><script>alert(1)</script>')).not.toContain('<script');
    expect(sanitizeExtracted('<img src="x" onerror="alert(1)">')).not.toMatch(/onerror/i);
  });

  it('keeps a YouTube iframe WITH its src, so the facade can find it', () => {
    const out = sanitizeExtracted('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" allowfullscreen></iframe>');
    expect(out).toContain('<iframe');
    expect(out).toContain('src="https://www.youtube.com/embed/dQw4w9WgXcQ"');
  });

  it('drops an iframe pointing anywhere else', () => {
    expect(sanitizeExtracted('<p>a</p><iframe src="https://attacker.tld/phish"></iframe>'))
      .not.toContain('<iframe');
  });

  it('drops data attributes', () => {
    expect(sanitizeExtracted('<p data-x="1">a</p>')).not.toContain('data-x');
  });
});
