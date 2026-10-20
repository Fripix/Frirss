// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { segmentArticle, batchSegments, wordCount, BLOCK_SELECTOR } from './articleSegments';

describe('segmentArticle', () => {
  it('segments leaf blocks, keeps inline markup, skips blocks without letters and pre', () => {
    const s = segmentArticle('Titre', '<p>Un <a href="/x">lien</a></p><ul><li>a</li><li>123</li></ul><pre>code</pre><blockquote><p>q</p></blockquote>');
    expect(s.segments).toEqual(['Titre', 'Un <a href="/x">lien</a>', 'a', 'q']);
  });

  it('ignores blocks nested inside pre', () => {
    const s = segmentArticle('T', '<pre><p>code here</p></pre><p>text</p>');
    expect(s.segments).toEqual(['T', 'text']);
  });

  it('counts a letter from any script as text', () => {
    const s = segmentArticle('T', '<p>日本語</p><p>—</p>');
    expect(s.segments).toEqual(['T', '日本語']);
  });

  it('apply puts translations back in place, through the sanitiser, images untouched', () => {
    const s = segmentArticle('T', '<p>Hello</p><img src="/i.png"><p>World</p>');
    const out = s.apply(['T2', 'Bonjour', 'Monde <script>x</script>'], (h) => h.replace(/<script>.*?<\/script>/g, ''));
    expect(out).toBe('<p>Bonjour</p><img src="/i.png"><p>Monde </p>');
  });

  it('apply can be called more than once and leaves the original untouched', () => {
    const s = segmentArticle('T', '<p>Hello</p>');
    expect(s.apply(['T', 'Un'], (h) => h)).toBe('<p>Un</p>');
    expect(s.apply(['T', 'Deux'], (h) => h)).toBe('<p>Deux</p>');
    expect(s.segments).toEqual(['T', 'Hello']);
  });

  it('keeps the original text of a segment that has no translation', () => {
    const s = segmentArticle('T', '<p>Hello</p><p>World</p>');
    expect(s.apply(['T', 'Bonjour'], (h) => h)).toBe('<p>Bonjour</p><p>World</p>');
  });

  it('exposes the selector with the documented blocks', () => {
    expect(BLOCK_SELECTOR).toBe('p, li, h1, h2, h3, h4, h5, h6, blockquote, figcaption, td, th, dt, dd');
  });
});

describe('wordCount', () => {
  it('counts words of the text content, not of the markup', () => {
    expect(wordCount('Un <a href="/a b c">lien</a> <em>en</em> italique')).toBe(4);
    expect(wordCount('')).toBe(0);
  });
});

describe('batchSegments', () => {
  it('batches by words and bytes, leaving an oversized segment out', () => {
    const segs = ['w '.repeat(700), 'w '.repeat(700), 'x'.repeat(300_000)];
    expect(batchSegments(segs, 1200, 200_000)).toEqual([[0], [1]]);
  });

  it('packs consecutive small segments together', () => {
    expect(batchSegments(['a b', 'c d', 'e f'], 4, 1000)).toEqual([[0, 1], [2]]);
  });

  it('starts a new batch when bytes would overflow', () => {
    expect(batchSegments(['aaaa', 'bbbb', 'cccc'], 1000, 9)).toEqual([[0, 1], [2]]);
  });

  it('gives a segment heavier than maxWords a batch of its own', () => {
    expect(batchSegments(['a', 'w '.repeat(50), 'b'], 10, 10_000)).toEqual([[0], [1], [2]]);
  });

  it('counts UTF-8 bytes, not characters', () => {
    expect(batchSegments(['é'.repeat(6)], 1000, 10)).toEqual([]);
  });

  it('returns no batch for no segment', () => {
    expect(batchSegments([])).toEqual([]);
  });
});
