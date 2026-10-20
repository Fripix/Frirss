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

  it('translates text sitting next to a nested list, in place', () => {
    const s = segmentArticle('T', '<ul><li>Fruits<ul><li>Apple</li></ul></li></ul>');
    expect(s.segments).toEqual(['T', 'Fruits', 'Apple']);
    expect(s.apply(['T', 'Fruits FR', 'Pomme'], (h) => h)).toBe('<ul><li>Fruits FR<ul><li>Pomme</li></ul></li></ul>');
  });

  it('translates the intro of a blockquote that holds paragraphs', () => {
    const s = segmentArticle('T', '<blockquote>Intro <em>here</em><p>Body</p></blockquote>');
    expect(s.segments).toEqual(['T', 'Intro <em>here</em>', 'Body']);
    expect(s.apply(['T', 'Intro FR', 'Corps'], (h) => h)).toBe('<blockquote>Intro FR<p>Corps</p></blockquote>');
  });

  it('translates trailing text after a paragraph in a list item, in document order', () => {
    const s = segmentArticle('T', '<ul><li>Lead<p>Para</p>trailing</li><li>Next</li></ul>');
    expect(s.segments).toEqual(['T', 'Lead', 'Para', 'trailing', 'Next']);
    expect(s.apply(['T', 'A', 'B', 'C', 'D'], (h) => h)).toBe('<ul><li>A<p>B</p>C</li><li>D</li></ul>');
  });

  it('does not segment text around a pre inside a block, and skips letterless runs', () => {
    const s = segmentArticle('T', '<li>Before<pre>code</pre>After<ul><li>x1</li></ul> 12</li>');
    expect(s.segments).toEqual(['T', 'Before', 'After', 'x1']);
  });

  it('translates bare root text, keeping the br inside the run', () => {
    const s = segmentArticle('T', 'Hello<br>World');
    expect(s.segments).toEqual(['T', 'Hello<br>World']);
    expect(s.apply(['T', 'Bonjour<br>Monde'], (h) => h)).toBe('Bonjour<br>Monde');
  });

  it('translates text around a paragraph inside a div', () => {
    const s = segmentArticle('T', '<div>Intro<p>Body</p>Outro</div>');
    expect(s.segments).toEqual(['T', 'Intro', 'Body', 'Outro']);
    expect(s.apply(['T', 'A', 'B', 'C'], (h) => h)).toBe('<div>A<p>B</p>C</div>');
  });

  it('walks nested containers instead of joining them into a run', () => {
    const s = segmentArticle('T', '<div><div>Deep</div></div>');
    expect(s.segments).toEqual(['T', 'Deep']);
    expect(s.apply(['T', 'Profond'], (h) => h)).toBe('<div><div>Profond</div></div>');
  });

  it('translates text around a pre in a div and leaves the pre alone', () => {
    const s = segmentArticle('T', '<div>x<pre>c</pre>y</div>');
    expect(s.segments).toEqual(['T', 'x', 'y']);
    expect(s.apply(['T', 'X', 'Y'], (h) => h)).toBe('<div>X<pre>c</pre>Y</div>');
  });

  it('never segments script, style or svg content', () => {
    const s = segmentArticle('T', '<style>p{color:red}</style>Text<script>var a=1</script><svg><text>lab</text></svg>');
    expect(s.segments).toEqual(['T', 'Text']);
  });

  it('apply never throws on bad model output and keeps the original block', () => {
    const s = segmentArticle('T', '<p>One</p><p>Two</p><p>Three</p><p>Four</p>');
    const bad = ['T', null, 42, ''] as unknown as string[];
    expect(s.apply(bad, (h) => h)).toBe('<p>One</p><p>Two</p><p>Three</p><p>Four</p>');
    const boom = () => { throw new Error('nope'); };
    expect(s.apply(['T', 'Un', 'Deux'], boom)).toBe('<p>One</p><p>Two</p><p>Three</p><p>Four</p>');
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

  it('treats a tag as a word boundary', () => {
    expect(wordCount('a<br>b')).toBe(2);
  });

  it('weighs CJK, Hangul and Thai text by characters', () => {
    expect(wordCount('日'.repeat(1000))).toBe(500);
    expect(wordCount('가'.repeat(10))).toBe(5);
    expect(wordCount('ก'.repeat(10))).toBe(5);
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

  it('splits a long CJK article into several batches', () => {
    const segs = Array.from({ length: 10 }, () => '日'.repeat(1000));
    expect(batchSegments(segs, 1200, 200_000)).toEqual([[0, 1], [2, 3], [4, 5], [6, 7], [8, 9]]);
  });

  it('returns no batch for no segment', () => {
    expect(batchSegments([])).toEqual([]);
  });
});
