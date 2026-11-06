import { describe, it, expect } from 'vitest';
import { parseHTML } from 'linkedom';
import { markupTooComplex as serverCheck } from '../markupBounds.js';
import { markupTooComplex as clientCheck } from '../../src/lib/markupBounds.js';
import { advisoryPageHtml } from '../../src/test/advisoryPageFixture.js';
import { blogPageHtml, newsPageHtml } from '../../src/test/boilerplatePageFixtures.js';

// ── Relecture 1.9.0 (R1-3) : un refus rapide qui l'est vraiment ──────
// Le refus de M-01 se mesurait APRÈS `parseHTML`, or linkedom est lui-même
// quadratique en profondeur (sa pile d'ouverture insère en tête) : 50 000
// `<div>` imbriqués coûtaient 1,2 s avant le moindre refus, 390 000 `<div>`
// jamais fermés (2 Mo) 42 s — bornés seulement par le délai du worker. Le
// balayage du texte, AVANT l'analyse, est linéaire. Le repli du navigateur,
// lui, n'avait aucune borne de profondeur. Une seule règle, deux copies (le
// serveur et le client ne partagent pas de code) : chaque cas les passe toutes
// les deux.

const LIMITS = { maxDepth: 256, maxElements: 60_000 };

/** Profondeur réelle de l'arbre que linkedom construit (`<html>` compte pour 1). */
function parsedDepth(html: string): number {
  const { document } = parseHTML(html);
  let max = 0;
  const stack: Array<[Element, number]> = [[document.documentElement as unknown as Element, 1]];
  while (stack.length) {
    const [el, d] = stack.pop()!;
    max = Math.max(max, d);
    for (let c = el.firstElementChild; c; c = c.nextElementSibling) stack.push([c, d + 1]);
  }
  return max;
}

const page = (body: string) => `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;

/** Profondeur et nombre d'éléments de TOUT le document construit (tous les éléments de premier niveau). */
function parsedShape(html: string): { depth: number; elements: number } {
  const { document } = parseHTML(html);
  let depth = 0;
  let elements = 0;
  const stack: Array<[Element, number]> = [];
  for (let c = document.firstElementChild as unknown as Element | null; c; c = c.nextElementSibling) stack.push([c, 1]);
  while (stack.length) {
    const [el, d] = stack.pop()!;
    elements++;
    depth = Math.max(depth, d);
    for (let c = el.firstElementChild; c; c = c.nextElementSibling) stack.push([c, d + 1]);
  }
  return { depth, elements };
}

// ── C-01 (quatrième round) : formes étranges ─────────────────────────
// Le balayage s'écartait d'htmlparser2 sur des formes que personne n'écrit,
// mais qu'une page piégée peut écrire : `<div =" >` (htmlparser2 y lit un nom
// d'attribut qui COMMENCE par `=`, et ferme la balise au `>` ; le balayage
// lisait une valeur et sautait au `"` suivant), `<!--->` (un commentaire déjà
// fermé ; le balayage cherchait `-->` plus loin). Tout ce qui suivait
// échappait au comptage. Chaque forme est suivie d'une imbrication et d'une
// « soupe » de fins possibles (guillemets, `-->`, `</script>`…) : un balayage
// qui saute ou ferme ce qu'htmlparser2 ne saute ni ne ferme y sous-estime la
// profondeur. Le balayage peut SURESTIMER (refus prudent), jamais sous-estimer.
const NEST = '<section>'.repeat(6);
const SOUP = `" ' --> ]]> > </script> </style> </textarea> </title> </xmp> --!> ?>`;
const strange = (form: string) => page(`${form}${NEST}x<br>${SOUP}${NEST}<img>y`);
const STRANGE_FORMS = [
  // Attributs : sans valeur, `=` en tête, guillemets non fermés ou mal placés.
  '<div a>', '<div a b c>', '<div =" >', '<div ="x">', '<div ==>', '<div =>', '<div "=">', "<div '='>", '<div a=">', "<div a='>",
  '<div a="x"b>', '<div a"b=">', '<div a=b/>', '<div a=/>', '<div a= >', '<div/ a>', '<div / >', '<div <a>', '<div a<b>', '<div a="', '<div a',
  // Commentaires, déclarations, CDATA, instructions.
  '<!-->', '<!--->', '<!---->', '<!--x--!>', '<!-- -- -->', '<!->', '<!>', '<!-x>', '<!x>', '<!DOCTYPE html>',
  '<![CDATA[x]]>', '<![CDATA[x>', '<![cdata[x]]>', '<![>', '<?x>', '<?x?>', '<?>', '<!--', '<!-',
  // Fermetures étranges ou orphelines.
  '</>', '</ section>', '</1>', '</section/>', '</SECTION>', '</div x=">">', '</p>', '</br>',
  // Texte brut : `script`, `style`, `textarea`, `title`, `xmp`, et ce qui les ferme vraiment.
  '<script></script/>', '<script><\x0fscript>', '<script>\x1c/script>', '<script><s\x1c/script>', '<style></style >',
  '<textarea></textarea\t>', '<title>&</title>', '<title>\x1c/title>', '<title><\x0ftitle>', '<xmp></xmp>',
  '<script/>', '<SCRIPT></Script>', '<scriptx>', '<script a="</script>">', '<script/ x>', '<textarea/>',
  // SVG et MathML.
  '<svg><div/>', '<svg/>', '<math><mi><div/></mi>', '<svg><title><div/></title>', '<svg><foreignObject><div/></foreignObject>', '</svg>', '<math/><div/>',
  // Texte et entités.
  '&lt<div>', '&<div>', '< div>', '<1div>', '<div\x00>',
];

for (const [name, check] of [['serveur', serverCheck], ['navigateur', clientCheck]] as const) {
  describe(`markupTooComplex (${name})`, () => {
    it('refuse en quelques millisecondes 50 000 niveaux, et 390 000 `<div>` jamais fermés', () => {
      const started = performance.now();
      expect(check(page(`${'<div>'.repeat(50_000)}x${'</div>'.repeat(50_000)}`), LIMITS)).toBe('depth');
      expect(check(`<html><body>${'<div>'.repeat(390_000)}</body></html>`, LIMITS)).toBe('depth');
      expect(performance.now() - started).toBeLessThan(200);
    });

    it('refuse une page qui dépasse le nombre d’éléments, même plate', () => {
      expect(check(page('<b>x</b>'.repeat(LIMITS.maxElements + 10)), LIMITS)).toBe('elements');
    });

    it('suit la profondeur que linkedom construit, à la limite près', () => {
      for (const n of [10, 200, 300]) {
        const html = page(`${'<div>'.repeat(n)}x${'</div>'.repeat(n)}`);
        expect(check(html, LIMITS)).toBe(parsedDepth(html) > LIMITS.maxDepth ? 'depth' : null);
      }
      const atLimit = page(`${'<div>'.repeat(LIMITS.maxDepth - 2)}x${'</div>'.repeat(LIMITS.maxDepth - 2)}`);
      expect(parsedDepth(atLimit)).toBe(LIMITS.maxDepth);
      expect(check(atLimit, LIMITS)).toBeNull();
      const overLimit = page(`${'<div>'.repeat(LIMITS.maxDepth - 1)}x${'</div>'.repeat(LIMITS.maxDepth - 1)}`);
      expect(check(overLimit, LIMITS)).toBe('depth');
    });

    it('ne compte pas ce qui ne s’imbrique pas : fins implicites, éléments vides, SVG auto-fermé', () => {
      // `<p>`, `<li>`, `<td>`, `<option>` non fermés se ferment l'un l'autre ;
      // `<br>`, `<img>`, `<input>` ne s'ouvrent pas ; `<path/>` se ferme en SVG.
      const html = page([
        '<p>a'.repeat(1000),
        `<ul>${'<li>b'.repeat(1000)}</ul>`,
        `<table>${'<tr><td>c<td>d'.repeat(500)}</table>`,
        `<select>${'<option>e'.repeat(500)}</select>`,
        '<br><img src="x"><input>'.repeat(500),
        `<svg viewBox="0 0 1 1">${'<path d="M0 0"/>'.repeat(1000)}</svg>`,
        `<div><span>${'<em>f</em>'.repeat(200)}</div>`,
      ].join(''));
      expect(parsedDepth(html)).toBeLessThan(20);
      expect(check(html, LIMITS)).toBeNull();
    });

    it('ne lit pas les balises écrites dans un script, un style, un commentaire ou un attribut', () => {
      const tags = '<div>'.repeat(1000);
      const html = page(`<script>var s = "${tags}";</script><style>/* ${tags} */</style><!-- ${tags} --><textarea>${tags}</textarea><title>${tags}</title><a title="${tags}">lien</a><p>x</p>`);
      expect(check(html, LIMITS)).toBeNull();
    });

    it('compte un `<div/>` hors SVG comme une ouverture, comme le fait linkedom', () => {
      const html = page('<div/>'.repeat(300));
      expect(parsedDepth(html)).toBeGreaterThan(LIMITS.maxDepth);
      expect(check(html, LIMITS)).toBe('depth');
    });

    it('accepte les pages réelles des fixtures', () => {
      for (const html of [advisoryPageHtml(), newsPageHtml(), blogPageHtml()]) expect(check(html, LIMITS)).toBeNull();
    });

    it('ne sous-estime jamais la profondeur ni le nombre d’éléments que linkedom construit, sur des formes étranges', () => {
      const under: string[] = [];
      for (const form of STRANGE_FORMS) {
        const html = strange(form);
        const { depth, elements } = parsedShape(html);
        // Le balayage voit au moins `depth` niveaux et `elements` éléments.
        if (check(html, { maxDepth: depth - 1, maxElements: 1e9 }) !== 'depth'
          || check(html, { maxDepth: 1e9, maxElements: elements - 1 }) !== 'elements') under.push(JSON.stringify(form));
      }
      expect(under).toEqual([]);
    });

    it('refuse une page piégée par un nom d’attribut qui commence par `=`, ou par `<!--->`', () => {
      // Sondes du quatrième round : 3 000 niveaux réels, que le balayage ne voyait pas.
      const deep = '<div>'.repeat(3000);
      for (const html of [`<html><body><div =" >${deep}"></body></html>`, `<html><body><!--->${deep}--></body></html>`, `<html><body><!-->${deep}--></body></html>`]) {
        expect(parsedShape(html).depth).toBeGreaterThan(LIMITS.maxDepth);
        expect(check(html, LIMITS)).toBe('depth');
      }
    });

    it('reste linéaire sur une entrée hostile', () => {
      const started = performance.now();
      check('<'.repeat(1_000_000), LIMITS);
      check('<a title="'.repeat(200_000), LIMITS);
      check('<!--'.repeat(300_000), LIMITS);
      check('<script>'.repeat(200_000), LIMITS);
      check(`<div>${'</span>'.repeat(200_000)}`, LIMITS);
      check('<div =" '.repeat(200_000), LIMITS);
      check('<!>'.repeat(300_000), LIMITS);
      check(`<title>${'<\x1c/titl'.repeat(150_000)}`, LIMITS);
      check(`<script>${'</scrip'.repeat(150_000)}`, LIMITS);
      check('</ '.repeat(300_000), LIMITS);
      expect(performance.now() - started).toBeLessThan(1000);
    });
  });
}
