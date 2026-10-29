// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import DOMPurify from 'dompurify';
import { releaseDocument, purifyToString } from './parsedDocument';
import { sanitizeHtml, sanitizeArticleBody } from '../utils/sanitizeHtml';
import { sanitizeExtracted } from '../utils/extractContent';
import { segmentArticle } from './articleSegments';
import { plainText } from '../components/ReadingPane/useArticleTranslation';

/*
 * Chrome garde en mémoire tout document analysé (DOMParser, DOMPurify) qui
 * contient une `<video>` ou une `<picture><source media>` : leurs « activités
 * en attente » le retiennent, même quand plus rien ne s'y réfère. Mesuré sur
 * Android : 20 documents sur 20 retenus, 0 une fois le document vidé ; et 434
 * documents (365 000 nœuds) au bout d'une préparation hors ligne de 6 600
 * articles. jsdom ne retient rien : ces tests vérifient que chaque document
 * analysé est vidé après usage, ce qui suffit à le libérer dans Chrome.
 */
const MEDIA = '<p>texte</p><video preload="metadata" src="https://example.com/v.mp4"></video>'
  + '<picture><source media="(min-width: 600px)" srcset="https://example.com/a.jpg"><img src="https://example.com/b.jpg"></picture>';

/** Les documents internes de DOMPurify, relevés par un crochet. */
function watchPurify() {
  const seen = new Set<Document>();
  const hook = (node: Node) => { if (node.ownerDocument) seen.add(node.ownerDocument); };
  DOMPurify.addHook('afterSanitizeAttributes', hook);
  return { seen, stop: () => DOMPurify.removeHook('afterSanitizeAttributes') };
}
/** Les documents créés par `DOMParser`. */
function watchParser() {
  const seen: Document[] = [];
  const parse = DOMParser.prototype.parseFromString;
  vi.spyOn(DOMParser.prototype, 'parseFromString').mockImplementation(function (this: DOMParser, ...a: Parameters<typeof parse>) {
    const d = parse.apply(this, a);
    seen.push(d);
    return d;
  });
  return seen;
}
const allReleased = (docs: Iterable<Document>) => [...docs].every((d) => d !== document && d.documentElement === null);

afterEach(() => { vi.restoreAllMocks(); });

describe('releaseDocument', () => {
  it('vide un document analysé', () => {
    const doc = new DOMParser().parseFromString(MEDIA, 'text/html');
    releaseDocument(doc);
    expect(doc.documentElement).toBeNull();
  });

  it('ne touche jamais au document de l’application', () => {
    releaseDocument(document);
    expect(document.documentElement).not.toBeNull();
    expect(document.body).not.toBeNull();
  });

  it('accepte l’absence de document', () => {
    expect(() => releaseDocument(null)).not.toThrow();
  });
});

describe('purifyToString', () => {
  // Sans `<`, DOMPurify rend le texte tel quel, sans l'analyser : « Tom &
  // Jerry » ne doit pas devenir « Tom &amp; Jerry ».
  const samples = [MEDIA, '<p onclick="x()">a <b>b</b></p><script>alert(1)</script>', 'texte & <i>entités</i>', '', 'Tom & Jerry', 'a > b'];
  it('rend ce que rendait DOMPurify.sanitize', () => {
    for (const s of samples) expect(purifyToString(s, {})).toBe(DOMPurify.sanitize(s, {}));
  });

  it('vide le document interne de DOMPurify', () => {
    const w = watchPurify();
    try {
      purifyToString(MEDIA, {});
      expect(w.seen.size).toBeGreaterThan(0);
      expect(allReleased(w.seen)).toBe(true);
    } finally { w.stop(); }
  });
});

describe('chaque analyse de HTML de l’app vide son document', () => {
  for (const [label, run] of [
    ['sanitizeHtml', () => sanitizeHtml(MEDIA)],
    ['sanitizeArticleBody', () => sanitizeArticleBody(MEDIA, 1)],
    ['sanitizeExtracted', () => sanitizeExtracted(MEDIA)],
  ] as const) {
    it(label, () => {
      const w = watchPurify();
      try {
        const out = run();
        expect(out).toContain('<video');
        expect(allReleased(w.seen)).toBe(true);
      } finally { w.stop(); }
    });
  }

  it('plainText (titre et résumé traduits)', () => {
    const parsed = watchParser();
    expect(plainText(`<p>Bonjour</p>${MEDIA}`)).toContain('Bonjour');
    expect(parsed.length).toBeGreaterThan(0);
    expect(allReleased(parsed)).toBe(true);
  });

  it('segmentArticle et son apply (traduction du corps)', () => {
    const parsed = watchParser();
    const seg = segmentArticle('Titre', `<p>Un paragraphe.</p>${MEDIA}`);
    const out = seg.apply(seg.segments.map((s) => s.toUpperCase()), (h) => h);
    expect(out).toContain('UN PARAGRAPHE.');
    expect(out).toContain('<video');
    expect(allReleased(parsed)).toBe(true);
  });
});
