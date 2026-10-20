import { describe, it, expect } from 'vitest';
import { stripMediaForSummary, fitSummaryPayload, MAX_SUMMARY_HTML_BYTES } from './aiPayload';

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

describe('fitSummaryPayload', () => {
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  const noDanglingTag = (s: string) => s.lastIndexOf('<') < s.lastIndexOf('>') || !s.includes('<');
  it('stays below the server limit of 200 KiB', () => {
    expect(MAX_SUMMARY_HTML_BYTES).toBeLessThanOrEqual(200 * 1024);
  });
  it('leaves a payload under the limit untouched', () => {
    const html = '<p>' + 'mot '.repeat(1000) + '</p>';
    expect(fitSummaryPayload(html)).toBe(html);
  });
  it('cuts a 250 KB article under the limit, never inside a tag', () => {
    // Le paragraphe est calé pour que la coupe brute tombe DANS une balise.
    const para = '<p class="paragraphe">' + 'texte '.repeat(30) + '</p>';
    let html = 'a'.repeat((MAX_SUMMARY_HTML_BYTES % para.length) + para.length - 10);
    while (bytes(html) < 250_000) html += para;
    const raw = html.slice(0, MAX_SUMMARY_HTML_BYTES);
    expect(noDanglingTag(raw)).toBe(false);
    const out = fitSummaryPayload(html);
    expect(bytes(out)).toBeLessThanOrEqual(MAX_SUMMARY_HTML_BYTES);
    expect(html.startsWith(out)).toBe(true);
    expect(noDanglingTag(out)).toBe(true);
    expect(html[out.length]).toBe('<');
    expect(bytes(out)).toBeGreaterThan(MAX_SUMMARY_HTML_BYTES - para.length);
  });
  it('keeps the text of one huge paragraph, counting bytes and never splitting a character', () => {
    const html = '<p>' + 'é€😀'.repeat(40_000) + '</p>';
    const out = fitSummaryPayload(html);
    expect(bytes(out)).toBeLessThanOrEqual(MAX_SUMMARY_HTML_BYTES);
    expect(bytes(out)).toBeGreaterThan(MAX_SUMMARY_HTML_BYTES - 4);
    expect(out.startsWith('<p>é€😀')).toBe(true);
    expect(/[\uD800-\uDBFF]$/.test(out)).toBe(false);
    expect(noDanglingTag(out)).toBe(true);
  });
});
