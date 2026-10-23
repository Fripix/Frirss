import { describe, it, expect } from 'vitest';
import { htmlToText, countWords, isEcho, segmentWordCount } from './text.js';

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
  it('strips script/style blocks whatever their case, and keeps the text after an unclosed one', () => {
    expect(htmlToText('<p>a</p><SCRIPT type="x">bad()</Script><p>b</p>')).toBe('a\n\nb');
    expect(htmlToText('<p>a <script>b c</p>')).toBe('a b c');
  });
});

// Entrées hostiles de 200 Ko : un motif quadratique y bloquait la boucle d'événements 4 à 22 s.
describe('linear time on adversarial input', () => {
  const N = 200_000;
  const timed = (fn: () => unknown) => { const t = performance.now(); fn(); return performance.now() - t; };
  const adversarial: Record<string, string> = {
    spaces: ' '.repeat(N),
    'lone <': '<'.repeat(N),
    '<a': '<a'.repeat(N / 2),
    '<script ': '<script '.repeat(N / 8),
    '<script>': '<script>'.repeat(N / 8),
    '<br + spaces': '<br' + ' '.repeat(N),
  };
  for (const [name, input] of Object.entries(adversarial)) {
    it(`htmlToText on 200 KB of ${name} returns under 250 ms`, () => {
      expect(timed(() => htmlToText(input))).toBeLessThan(250);
    });
  }
  it('countWords on 200 KB of spaces returns under 250 ms', () => {
    expect(timed(() => countWords(' '.repeat(N)))).toBeLessThan(250);
  });
});

describe('countWords', () => {
  it('counts space-separated words', () => {
    expect(countWords('mot '.repeat(60))).toBe(60);
  });
  it('counts words in scripts without spaces', () => {
    expect(countWords('汉字'.repeat(1000))).toBeGreaterThan(40);
  });
});

describe('isEcho', () => {
  const ten = Array.from({ length: 10 }, (_, i) => `The quick brown fox number ${i} jumps`);
  const fr = (s: string) => s.replace('The quick brown fox', 'Le rapide renard brun').replace('jumps', 'saute');

  it('is true for an output identical to its input', () => {
    expect(isEcho(ten, [...ten])).toBe(true);
  });
  it('is true at 90 % (one significant segment out of ten translated)', () => {
    expect(isEcho(ten, ten.map((s, i) => (i === 0 ? fr(s) : s)))).toBe(true);
  });
  it('is false at 70 % (three out of ten translated)', () => {
    expect(isEcho(ten, ten.map((s, i) => (i < 3 ? fr(s) : s)))).toBe(false);
  });
  it('ignores short identical segments (names, URLs): they are not judged', () => {
    const input = ['Linus Torvalds', 'https://example.com/a', 'The quick brown fox jumps over', 'A lazy dog sleeps in the sun'];
    const output = ['Linus Torvalds', 'https://example.com/a', 'Le rapide renard brun saute', 'Un chien paresseux dort au soleil'];
    expect(isEcho(input, output)).toBe(false);
  });
  it('counts a segment differing only by case, whitespace or tags as identical', () => {
    const input = ['<p>The quick <b>brown</b> fox jumps</p>', 'A lazy dog sleeps in the sun'];
    const output = ['  the QUICK brown   fox jumps ', '<em>A lazy dog</em> sleeps\n in the sun'];
    expect(isEcho(input, output)).toBe(true);
  });
  it('is false when no segment is significant (nothing to judge)', () => {
    expect(isEcho(['Hello', 'Linus Torvalds'], ['Hello', 'Linus Torvalds'])).toBe(false);
    expect(isEcho([], [])).toBe(false);
  });
  it('is false for a shorter output array', () => {
    expect(isEcho(ten, ten.slice(0, 9))).toBe(false);
  });
});

describe('linear time on hostile input (a request must never block the event loop)', () => {
  // `/<[^>]*>/g` est quadratique sur une suite de `<` sans `>` : 200 Ko — la
  // taille qu'accepte /api/ai/translate — bloquaient le serveur ≈ 17 s.
  const hostile = '<'.repeat(200_000);
  it('segmentWordCount', () => {
    const t = performance.now();
    segmentWordCount(hostile);
    expect(performance.now() - t).toBeLessThan(300);
  });
  it('isEcho', () => {
    const t = performance.now();
    isEcho([hostile], [hostile]);
    expect(performance.now() - t).toBeLessThan(300);
  });
});
