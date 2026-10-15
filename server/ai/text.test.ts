import { describe, it, expect } from 'vitest';
import { htmlToText } from './text.js';

describe('htmlToText', () => {
  it('drops tags, scripts and styles, keeps paragraph breaks', () => {
    const html = '<h1>Titre</h1><script>x()</script><style>p{}</style><p>Un <b>mot</b>.</p><p>Deux.</p>';
    expect(htmlToText(html)).toBe('Titre\n\nUn mot.\n\nDeux.');
  });
  it('decodes the common entities and collapses whitespace', () => {
    expect(htmlToText('<p>a &amp; b&nbsp;c &lt;d&gt;   e\n\n\n f</p>')).toBe('a & b c <d> e f');
  });
  it('caps the output at maxChars', () => {
    expect(htmlToText('<p>' + 'x'.repeat(50) + '</p>', 10)).toHaveLength(10);
  });
  it('never throws on out-of-range or surrogate numeric entities, and keeps them as text', () => {
    const html = '<p>a &#99999999; b &#xD800; c</p>';
    expect(() => htmlToText(html)).not.toThrow();
    expect(htmlToText(html)).toBe('a &#99999999; b &#xD800; c');
  });
  it('only accepts digits for decimal references and hex digits for hex ones', () => {
    expect(htmlToText('<p>&#12ab;</p>')).toBe('&#12ab;');
  });
  it('trims the maxChars cut so it never ends in a space', () => {
    expect(htmlToText('<p>' + 'x '.repeat(10) + '</p>', 5)).toBe('x x x');
    expect(htmlToText('<p>' + 'x '.repeat(10) + '</p>', 4)).toBe('x x');
  });
  it('drops a lone high surrogate left at the end of the cut', () => {
    // 'a'*3 puis U+1F600 (paire 😀) : une coupe à 4 laisse le surrogate haut seul.
    expect(htmlToText('<p>aaa😀</p>', 4)).toBe('aaa');
  });
});
