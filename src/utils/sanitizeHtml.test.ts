// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sanitizeHtml, sanitizeArticleBody } from './sanitizeHtml';

describe('sanitizeHtml', () => {
  it('removes <script> tags', () => {
    expect(sanitizeHtml('<p>ok</p><script>alert(1)</script>')).not.toContain('<script');
  });

  it('strips inline event handlers', () => {
    const out = sanitizeHtml('<img src="x" onerror="alert(1)">');
    expect(out).not.toMatch(/onerror/i);
  });

  it('drops javascript: URLs', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toMatch(/javascript:/i);
  });

  it('keeps safe markup and links', () => {
    const out = sanitizeHtml('<a href="https://example.com">link</a><strong>b</strong>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('<strong>');
  });

  it('hardens target=_blank links with rel', () => {
    const out = sanitizeHtml('<a href="https://example.com" target="_blank">x</a>');
    expect(out).toMatch(/rel="noopener noreferrer"/);
  });

  it('returns empty string for falsy input', () => {
    expect(sanitizeHtml('')).toBe('');
    expect(sanitizeHtml(null)).toBe('');
  });
});

// La passe « corps d'article » ne fait qu'AJOUTER `dir` / `loading` : elle ne
// retire ni ne repose jamais un attribut existant. DOMPurify garde des noms
// `data-*` que le parseur HTML accepte mais que la vérification de nom XML
// refuse (`data-a;b`) ; les reposer levait `InvalidCharacterError` sur les
// moteurs à l'ancienne règle, et l'exception remontait jusqu'à la seule
// frontière d'erreur de l'application : un article de flux la faisait tomber.
describe('sanitizeArticleBody', () => {
  // `data-a×b` : DOMPurify le garde (sa règle `data-*` admet U+00D7), le
  // parseur HTML aussi, mais `×` n'est pas un caractère de nom XML.
  // `data-a;b` : DOMPurify 3.4.13 l'écarte lui-même ; il ne doit pas lever.
  it.each(['data-a×b', 'data-a;b'])('never throws on an attribute named %s', (name) => {
    expect(() => sanitizeArticleBody(`<p ${name}="1">x</p>`, 2)).not.toThrow();
    expect(() => sanitizeArticleBody(`<img src="1.jpg"><img src="2.jpg"><img ${name}="1" src="3.jpg">`, 2)).not.toThrow();
  });

  it('keeps an attribute with an XML-invalid name on a block, and adds dir', () => {
    const out = sanitizeArticleBody('<p data-a×b="1">x</p>', 2);
    const p = new DOMParser().parseFromString(out, 'text/html').querySelector('p')!;
    expect(p.getAttribute('data-a×b')).toBe('1');
    expect(p.getAttribute('dir')).toBe('auto');
  });

  it('keeps an attribute with an XML-invalid name on a lazy image', () => {
    const out = sanitizeArticleBody('<img src="1.jpg"><img src="2.jpg"><img data-a×b="1" src="3.jpg">', 2);
    const img = new DOMParser().parseFromString(out, 'text/html').querySelectorAll('img')[2];
    expect(img.getAttribute('data-a×b')).toBe('1');
    expect(img.getAttribute('loading')).toBe('lazy');
  });

  it('appends the attribute after the existing ones', () => {
    expect(sanitizeArticleBody('<p class="c">x</p>', 2)).toBe('<p class="c" dir="auto">x</p>');
    expect(sanitizeArticleBody('<img src="1.jpg"><img src="2.jpg"><img src="3.jpg" alt="">', 2))
      .toBe('<img src="1.jpg"><img src="2.jpg"><img src="3.jpg" alt="" loading="lazy">');
  });

  it('overrides loading="eager" to lazy past the eager images, in place', () => {
    expect(sanitizeArticleBody('<img src="1.jpg"><img src="2.jpg"><img loading="eager" src="3.jpg">', 2))
      .toBe('<img src="1.jpg"><img src="2.jpg"><img loading="lazy" src="3.jpg">');
  });
});
