import { describe, it, expect } from 'vitest';
import { stripMediaForSummary } from './aiPayload';

describe('stripMediaForSummary', () => {
  it('drops images and media blocks, keeps the text around them', () => {
    const html = '<p>Avant <img src="a.png" alt="x"> après</p>'
      + '<svg viewBox="0 0 1 1"><path d="M0"/></svg>'
      + '<video controls><source src="v.mp4"></video>'
      + '<AUDIO src="a.mp3"><track></AUDIO>'
      + '<iframe src="https://example.com"></iframe>'
      + '<picture><source srcset="b.webp"><img src="b.png"></picture><p>Fin</p>';
    expect(stripMediaForSummary(html)).toBe('<p>Avant  après</p><p>Fin</p>');
  });
  it('removes any attribute carrying a data: URI, quoted or not', () => {
    const big = 'data:image/png;base64,' + 'A'.repeat(300_000);
    const html = `<p>Texte</p><a href="${big}">lien</a><div style="color:red" data-x='data:text/plain,abc'>bloc</div><object data=${big}>o</object>`;
    const out = stripMediaForSummary(html);
    expect(out).not.toContain('data:');
    expect(out).toContain('<p>Texte</p>');
    expect(out).toContain('<a>lien</a>');
    expect(out).toContain('style="color:red"');
    expect(out.length).toBeLessThan(200);
  });
  it('keeps the text after an unclosed media element, dropping only its tag', () => {
    expect(stripMediaForSummary('<p>a</p><video controls><p>b</p>')).toBe('<p>a</p><p>b</p>');
  });
  it('leaves an article without media untouched', () => {
    const html = '<h1>Titre</h1><p>Un <b>mot</b>.</p>';
    expect(stripMediaForSummary(html)).toBe(html);
  });
  it('stays linear on many unclosed openings', () => {
    const t = performance.now();
    stripMediaForSummary('<svg>'.repeat(40_000) + '<video '.repeat(30_000));
    expect(performance.now() - t).toBeLessThan(250);
  });
});
