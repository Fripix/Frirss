// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Readability } from '@mozilla/readability';
import { extractFromPage, extractFullContent, forgetExtractFailures, guardForTests } from './extractContent';
import { headerPageHtml, heroPageHtml, ledePageHtml, shortLandingPageHtml, TOC_ONLY_HEADING, tocPageHtml } from '../test/guardPageFixtures';
import { advisoryPageHtml } from '../test/advisoryPageFixture';
import { embeddedTweetsPageHtml } from '../test/embedConsentFixture';
import { blogPageHtml, newsPageHtml, pressPageHtml, shortPostPageHtml } from '../test/boilerplatePageFixtures';
import { splitBodyAcrossEmbedPageHtml, splitBodyAcrossHeadingsPageHtml, splitBodyAcrossImagesPageHtml, splitBodyPageHtml, splitBodyWithBioPageHtml } from '../test/splitBodyPageFixtures';

// Copie, pour le repli du navigateur, de `server/test/extractNonLoss.test.ts` :
// mêmes pages, mêmes formes, mêmes attentes (la garde est copiée à l'identique).
const parseHTML = (html: string) => ({ document: new DOMParser().parseFromString(html, 'text/html') });
const extractArticle = (url: string, html: string) => extractFromPage(url, html);
const extractWithoutGuard = (url: string, html: string) => extractFromPage(url, html, false);

// ── Garde de non-perte, repli du navigateur (REG-220 à REG-222) ──────
// Le nettoyage et la réunion du corps réparti changeaient le bloc que choisit
// Readability : le chapeau, l'image ou la légende d'en-tête, frères du corps,
// sortaient. La garde compare le résultat à la page lue intacte (le témoin) et
// remet, dans le conteneur de l'article, ce qui précède le corps — ou le suit,
// quand le résultat est sous le seuil.

const norm = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();
const textOf = (html: string) => norm(parseHTML(`<html><body>${html}</body></html>`).document.body.textContent);
const pick = (html: string, selector: string, n = 0) => parseHTML(html).document.querySelectorAll(selector)[n] as Element | undefined;
const occurrences = (text: string, needle: string) => text.split(needle).length - 1;

/** Passes Readability faites pendant `run` (le coût de la garde se compte en passes). */
function countPasses(run: () => void): number {
  const proto = Readability.prototype as unknown as { parse: (...args: unknown[]) => unknown };
  const original = proto.parse;
  let passes = 0;
  proto.parse = function (this: unknown, ...args: unknown[]) { passes++; return original.apply(this, args); };
  try { run(); } finally { proto.parse = original; }
  return passes;
}

/**
 * Le repli du navigateur de bout en bout : la route serveur répond 404, la
 * page arrive par le proxy. L'URL change à chaque appel (mémoire des échecs).
 */
let fallbackRun = 0;
async function viaFallback(url: string, html: string) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
    if (String(input).startsWith('/api/extract')) return new Response('', { status: 404 });
    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }));
  return extractFullContent(`${url}${url.includes('?') ? '&' : '?'}essai=${++fallbackRun}`);
}

afterEach(() => { vi.unstubAllGlobals(); forgetExtractFailures(); });

describe('repli local — garde de non-perte : pages réelles (REG-220, REG-221)', () => {
  it('garde le chapeau et l’image d’en-tête que le nettoyage laissait hors du choix de Readability (structure The Verge)', async () => {
    const html = ledePageHtml();
    const dek = norm(pick(html, 'div.duet--article--lede p.duet--article--dangerously-set-cms-markup')?.textContent);
    const hero = pick(html, 'div.duet--article--lede img')!.getAttribute('src')!;
    expect(dek.length).toBeGreaterThan(50);
    const out = await viaFallback('https://example.com/verge', html);
    const text = textOf(out.content);
    expect(text).toContain(dek);
    expect(occurrences(text, dek)).toBe(1);
    expect(out.content).toContain(`https://example.com${hero}`);
    // Le chapeau ouvre l'article, avant le corps.
    const body = norm(pick(html, 'div.duet--article--article-body-component p')?.textContent);
    expect(text.indexOf(dek)).toBeLessThan(text.indexOf(body));
    // REG-140 tient : ni la lettre d'information ni le bloc « Related ».
    for (const form of Array.from(parseHTML(html).document.querySelectorAll('form')) as Element[]) {
      expect(text).not.toContain(norm(form.textContent).slice(0, 60));
    }
    expect(text).not.toContain(norm(pick(html, 'div.duet--article--related')?.textContent).slice(0, 60));
  });

  it('garde le chapeau et l’image d’en-tête d’un corps réuni (structure du blog de Google)', async () => {
    const html = heroPageHtml();
    const abstract = norm(pick(html, 'p.uni-article-hero__abstract')?.textContent);
    const hero = pick(html, 'img.uni-article-hero__image')!.getAttribute('src')!;
    const out = await viaFallback('https://example.com/google', html);
    const text = textOf(out.content);
    expect(text).toContain(abstract);
    expect(out.content).toContain(`https://example.com${hero}`);
    // Tout le corps réparti reste, après l'en-tête.
    const blocks = (Array.from(parseHTML(html).document.querySelectorAll('div.rich-text p')) as Element[]).map((p) => norm(p.textContent)).filter((t) => t.length > 40);
    expect(blocks.length).toBeGreaterThan(5);
    for (const block of blocks) expect(text).toContain(block);
    expect(text.indexOf(abstract)).toBeLessThan(text.indexOf(blocks[0]));
  });

  it('garde le chapeau et la légende d’en-tête d’un corps réuni, sans la notice de l’auteur ni le compteur de commentaires (structure Ars Technica)', async () => {
    const html = headerPageHtml();
    const dek = norm(pick(html, 'article > header p.text-gray-550')?.textContent);
    const caption = norm(pick(html, 'div.caption-content', 1)?.textContent);
    const out = await viaFallback('https://example.com/ars', html);
    const text = textOf(out.content);
    expect(text).toContain(dek);
    expect(text).toContain(caption);
    // REG-175 tient : ni notice ni compteur.
    expect(text).not.toContain(norm(pick(html, '.author-mini-bio')?.textContent).slice(-60));
    expect(text).not.toContain(norm(pick(html, 'a.view-comments', 1)?.textContent));
    // Tout le corps réparti reste.
    for (const block of Array.from(parseHTML(html).document.querySelectorAll('div.post-content p')) as Element[]) {
      const t = norm(block.textContent);
      if (t.length > 40) expect(text).toContain(t);
    }
  });

  it('rend, sous le seuil, ce que le conteneur de la page porte aussi après le résultat (page courte)', async () => {
    const html = shortLandingPageHtml();
    const intro = norm(pick(html, 'div.header p')?.textContent);
    const question = norm(pick(html, 'main > h2')?.textContent);
    const lastTier = norm(pick(html, 'div.donate ul', 2)?.textContent);
    const out = await viaFallback('https://example.com/', html);
    const text = textOf(out.content);
    expect(text).toContain(intro);
    expect(text).toContain(question);
    expect(text).toContain(lastTier);
    // Dans l'ordre de la page, et sans le pied.
    expect(text.indexOf(intro)).toBeLessThan(text.indexOf(question));
    expect(text).not.toContain(norm(pick(html, 'footer')?.textContent).slice(0, 20));
  });
});

describe('repli local — sommaire de l’article (REG-222)', () => {
  it('garde le sommaire, seul endroit où se lit un intertitre dont l’id porte « header »', async () => {
    const out = await viaFallback('https://example.com/billet', tocPageHtml());
    expect(textOf(out.content)).toContain(TOC_ONLY_HEADING);
  });

  it('retire toujours un menu de site, un « Aller au contenu » et une navigation vers des repères qui ne sont pas des titres', async () => {
    const para = '<p>Un paragraphe d’article inventé, assez long pour que Readability le retienne comme le corps de la page entière.</p>';
    const page = `<!doctype html><html><body><main><article>
      <nav class="menu"><a href="/">Accueil</a> <a href="/blog/">Blog</a></nav>
      <nav class="skip"><a href="#corps">Aller au contenu inventé de la page</a></nav>
      <nav class="ancres"><a href="#corps">Vers le corps de la page inventée</a> <a href="#haut">Vers le haut de la page inventée</a></nav>
      <div id="haut"></div><div id="corps">${para.repeat(4)}</div></article></main></body></html>`;
    const text = textOf((await viaFallback('https://example.com/menu', page)).content);
    expect(text).not.toContain('Accueil');
    expect(text).not.toContain('Aller au contenu');
    expect(text).not.toContain('Vers le haut');
  });
});

// Les formes réelles que la garde pourrait abîmer (TESTING.md, « Corriger sans
// en casser d'autres », règle 3) : ses règles, jugées sur des morceaux
// donnés, sans dépendre du choix de Readability.
describe('repli local — garde de non-perte : formes qui pourraient casser', () => {
  const s = (word: string) => `${word} : une phrase inventée assez longue pour être suivie par la garde de non-perte.`;
  const page = (inner: string, outside = '') => `<!doctype html><html><head><title>T</title></head><body>${outside}<main><article>${inner}</article></main></body></html>`;
  const result = (inner: string) => `<div id="readability-page-1" class="page">${inner}</div>`;
  const p = (word: string) => `<p>${s(word)}</p>`;

  const body = ['un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept'].map((n) => p(`Corps ${n}`)).join('');

  it('un témoin qui lit ailleurs (les billets liés de Docker) ne remet rien', () => {
    const out = guardForTests({
      page: page(`<header>${p('Chapeau')}</header><div class="corps">${body}</div><div class="cartes">${p('Carte une')}${p('Carte deux')}</div>`),
      result: result(body),
      witness: result(`${p('Chapeau')}${p('Carte une')}${p('Carte deux')}`),
    });
    expect(out.asked).toBe(true);
    expect(textOf(out.content)).toBe(textOf(result(body)));
  });

  // Le revers assumé de la règle du résultat court : sous le seuil, tout ce que
  // le témoin lit dans le conteneur après l'ouverture revient, parasite compris.
  it('sous le seuil, ce que le témoin lit dans le conteneur après le résultat revient (règle assumée)', () => {
    const out = guardForTests({
      page: page(`<div class="corps">${p('Corps un')}</div><div class="cartes">${p('Carte une')}</div>`),
      result: result(p('Corps un')),
      witness: result(`${p('Corps un')}${p('Carte une')}`),
    });
    expect(textOf(out.content)).toContain(s('Carte une'));
  });

  it('ce qui suit le corps ne revient pas quand le résultat dépasse le seuil : notice de l’auteur, commentaires (Ars Technica)', () => {
    const out = guardForTests({
      page: page(`<header>${p('Chapeau')}</header><div class="corps">${body}</div><div class="notice">${p('Notice de l’auteur')}</div><a class="commentaires" href="/x">${s('22 commentaires')}</a>`),
      result: result(body),
      witness: result(`${p('Chapeau')}${body}${p('Notice de l’auteur')}<p>${s('22 commentaires')}</p>`),
    });
    const text = textOf(out.content);
    expect(text).toContain(s('Chapeau'));
    expect(text.indexOf(s('Chapeau'))).toBeLessThan(text.indexOf(s('Corps un')));
    expect(text).not.toContain('Notice de l’auteur');
    expect(text).not.toContain('22 commentaires');
  });

  it('un chapeau repris en premier paragraphe n’est pas doublé', () => {
    const out = guardForTests({
      page: page(`<header>${p('Chapeau et ouverture')}<img src="/une.jpg" width="1200"></header><div class="corps">${p('Chapeau et ouverture')}${p('Corps deux')}${p('Corps trois')}</div>`),
      result: result(`${p('Chapeau et ouverture')}${p('Corps deux')}${p('Corps trois')}`),
      witness: result(`${p('Chapeau et ouverture')}<p><img src="/une.jpg" width="1200"></p>${p('Chapeau et ouverture')}${p('Corps deux')}`),
    });
    const text = textOf(out.content);
    expect(occurrences(text, s('Chapeau et ouverture'))).toBe(1);
  });

  it('une page de liste (plusieurs `<article>`) n’a pas de conteneur : le témoin n’est pas demandé', () => {
    const list = `<!doctype html><html><body><main><article>${p('Chapeau')}${p('Billet un')}</article><article>${p('Billet deux')}</article></main></body></html>`;
    const out = guardForTests({ page: list, result: result(p('Billet un')), witness: result(`${p('Chapeau')}${p('Billet un')}`) });
    expect(out.asked).toBe(false);
    expect(textOf(out.content)).toBe(textOf(result(p('Billet un'))));
  });

  it('un billet court ne ramasse pas la colonne voisine, hors du conteneur (Simon Willison, REG-172), mais garde sa propre fin', () => {
    const post = '<p>Un billet très court, inventé pour la mesure.</p>';
    const out = guardForTests({
      page: page(`${post}${p('Rubrique du billet')}`, `<div id="secondary">${p('Colonne voisine')}</div>`),
      result: result(post),
      witness: result(`${post}${p('Rubrique du billet')}${p('Colonne voisine')}`),
    });
    const text = textOf(out.content);
    expect(text).toContain(s('Rubrique du billet'));
    expect(text).not.toContain('Colonne voisine');
  });

  it('avant le corps, rien hors du conteneur : ni lien d’évitement, ni accroche du site', () => {
    const out = guardForTests({
      page: page(`<header>${p('Chapeau')}</header><div>${p('Corps un')}${p('Corps deux')}</div>`, `<p>${s('Accroche du site')}</p>`),
      result: result(`${p('Corps un')}${p('Corps deux')}`),
      witness: result(`<p>${s('Accroche du site')}</p>${p('Chapeau')}${p('Corps un')}${p('Corps deux')}`),
    });
    const text = textOf(out.content);
    expect(text).toContain(s('Chapeau'));
    expect(text).not.toContain('Accroche du site');
  });

  it('une icône ou un portrait d’auteur n’est pas remis ; l’image d’en-tête, si', () => {
    const out = guardForTests({
      page: page(`<header><img src="/portrait.jpg" width="48" height="48"><img src="/une.jpg" width="1200"></header><div>${p('Corps un')}${p('Corps deux')}</div>`),
      result: result(`${p('Corps un')}${p('Corps deux')}`),
      witness: result(`<p><img src="https://example.com/portrait.jpg" width="48" height="48"></p><figure><img src="https://example.com/une.jpg" width="1200"></figure>${p('Corps un')}`),
    });
    expect(out.content).toContain('https://example.com/une.jpg');
    expect(out.content).not.toContain('portrait.jpg');
  });

  it('une date ou une rubrique seule (moins de 25 caractères) ne demande pas de témoin', () => {
    const out = guardForTests({
      page: page(`<header><p>Rubrique</p><p>6 nov. 2026</p></header><div>${p('Corps un')}${p('Corps deux')}</div>`),
      result: result(`${p('Corps un')}${p('Corps deux')}`),
      witness: result(`<p>Rubrique</p><p>6 nov. 2026</p>${p('Corps un')}`),
    });
    expect(out.asked).toBe(false);
  });

  it('rien d’absent avant le corps (le titre mis à part) : le témoin n’est pas demandé', () => {
    const out = guardForTests({
      page: page(`<h1>${s('Le titre')}</h1>${p('Corps un')}${p('Corps deux')}`),
      result: result(`${p('Corps un')}${p('Corps deux')}`),
      witness: null,
      title: s('Le titre'),
    });
    expect(out.asked).toBe(false);
  });

  it('un chapeau que le témoin n’a pas non plus n’est pas inventé', () => {
    const out = guardForTests({
      page: page(`<header>${p('Chapeau')}</header><div>${p('Corps un')}${p('Corps deux')}</div>`),
      result: result(`${p('Corps un')}${p('Corps deux')}`),
      witness: result(`${p('Corps un')}${p('Corps deux')}`),
    });
    expect(out.asked).toBe(true);
    expect(textOf(out.content)).not.toContain('Chapeau');
  });
});

// Les pages des corrections précédentes : la garde n'y change rien. Le
// résultat est comparé à celui de la passe nettoyée seule.
describe('repli local — garde de non-perte : les pages déjà corrigées ne bougent pas', () => {
  const pages: Array<[string, () => string]> = [
    ['avis du CERT-FR (REG-117, REG-122)', () => advisoryPageHtml()],
    ['gros avis du CERT-FR, liste de références (REG-199)', () => advisoryPageHtml(200)],
    ['Clubic, corps coupé par des images (REG-186)', splitBodyAcrossImagesPageHtml],
    ['Clubic, intertitres seuls (REG-198)', splitBodyAcrossHeadingsPageHtml],
    ['Clubic, message intégré (REG-198)', splitBodyAcrossEmbedPageHtml],
    ['Ars Technica, corps réparti (REG-175)', splitBodyPageHtml],
    ['Ars Technica, notice de l’auteur (REG-175)', splitBodyWithBioPageHtml],
    ['Numerama, messages intégrés et voile (REG-216)', embeddedTweetsPageHtml],
    ['Numerama, encart produit (N-1)', pressPageHtml],
    ['The Verge, lettre et « Related » (REG-140)', newsPageHtml],
    ['Schneier, billet court (REG-141)', blogPageHtml],
    ['Simon Willison, billet très court (REG-172)', shortPostPageHtml],
  ];
  for (const [label, html] of pages) {
    it(`${label} : même résultat qu’avant la garde`, () => {
      const page = html();
      expect(extractArticle('https://example.com/page', page).content).toBe(extractWithoutGuard('https://example.com/page', page).content);
    });
  }
});

describe('repli local — garde de non-perte : coût', () => {
  it('aucune passe de plus quand rien ne manque avant le corps', () => {
    for (const html of [advisoryPageHtml(), tocPageHtml(), splitBodyAcrossImagesPageHtml()]) {
      const guarded = countPasses(() => extractArticle('https://example.com/page', html));
      const strict = countPasses(() => extractWithoutGuard('https://example.com/page', html));
      expect(guarded).toBe(strict);
    }
  });

  it('une seule passe de plus quand il faut un témoin', () => {
    const html = ledePageHtml();
    const guarded = countPasses(() => extractArticle('https://example.com/verge', html));
    const strict = countPasses(() => extractWithoutGuard('https://example.com/verge', html));
    expect(guarded).toBe(strict + 1);
  });

  // Une page faite pour coûter : des milliers de phrases absentes avant le
  // corps, chacune cherchée dans un long résultat. Le budget de recherche
  // borne le texte relu à un multiple de la page.
  it('relit au plus un multiple borné du texte, même sur des milliers de phrases absentes', () => {
    const sentence = (i: number) => `<p>Phrase absente numéro ${i}, inventée pour coûter à la garde de non-perte.</p>`;
    const body = Array.from({ length: 2000 }, (_, i) => `<p>Phrase du corps numéro ${i}, inventée elle aussi pour peser dans le résultat.</p>`).join('');
    const before = Array.from({ length: 3000 }, (_, i) => sentence(i)).join('');
    const pageHtml = `<!doctype html><html><body><main><article><header>${before}</header><div>${body}</div></article></main></body></html>`;
    // Seules les recherches de la garde comptent : une phrase normalisée,
    // encadrée d'espaces (`reads`), dans un texte — pas celles de l'analyseur HTML.
    const proto = String.prototype as unknown as { indexOf: (...args: unknown[]) => number; includes: (...args: unknown[]) => boolean };
    const { indexOf, includes } = proto;
    const guardNeedle = (needle: unknown) => typeof needle === 'string' && needle.length > 20 && needle.startsWith(' ') && needle.endsWith(' ');
    let scanned = 0;
    proto.indexOf = function (this: string, ...args: unknown[]) { if (guardNeedle(args[0])) scanned += this.length; return indexOf.apply(this, args); };
    proto.includes = function (this: string, ...args: unknown[]) { if (guardNeedle(args[0])) scanned += this.length; return includes.apply(this, args); };
    const strictResult = `<div class="page">${body}</div>`;
    let out: { content: string } | undefined;
    try {
      out = guardForTests({ page: pageHtml, result: strictResult, witness: `<div class="page">${before}${body}</div>` });
    } finally {
      proto.indexOf = indexOf;
      proto.includes = includes;
    }
    // Sans budget : 3 000 recherches dans ~170 000 caractères, plus de 500 millions.
    expect(scanned).toBeLessThan(64 * pageHtml.length + 20_000_000);
    // Budget épuisé : la garde s'abstient en entier, rien n'est remis à moitié.
    expect(textOf(out!.content)).toBe(textOf(strictResult));
  });
});
