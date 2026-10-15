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
});
