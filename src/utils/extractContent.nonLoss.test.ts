// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Readability } from '@mozilla/readability';
import { extractFromPage, extractFullContent, forgetExtractFailures, guardForTests, withoutRepeatsForTests } from './extractContent';
import { repeatLedePageHtml, repeatLightboxPageHtml } from '../test/repeatPageFixtures';
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
    // Ni le nom ni la fonction de l'auteur (RG-04).
    expect(text).not.toContain(norm(pick(html, '.uni-article-hero__author-name')?.textContent));
    expect(text).not.toContain(norm(pick(html, '.uni-article-hero__author-title')?.textContent));
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
    const { document } = parseHTML(html);
    const intro = norm(pick(html, 'div.header p')?.textContent);
    const question = norm(pick(html, 'main > h2')?.textContent);
    // Chaque palier, ses intitulés courts compris (RG-01, voir le serveur).
    const tiers = (Array.from(document.querySelectorAll('div.donate h2, div.donate li')) as Element[]).map((el) => norm(el.textContent));
    expect(tiers).toHaveLength(9);
    const out = await viaFallback('https://example.com/', html);
    const text = textOf(out.content);
    expect(text).toContain(intro);
    expect(text).toContain(question);
    let from = text.indexOf(question);
    for (const tier of tiers) {
      const at = text.indexOf(tier, from);
      expect(at, tier).toBeGreaterThan(from);
      from = at;
    }
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

// Relecture de la garde (RG-01 à RG-05) : chaque point, une forme.
describe('repli local — garde de non-perte : relecture', () => {
  const s = (word: string) => `${word} : une phrase inventée assez longue pour être suivie par la garde de non-perte.`;
  const page = (inner: string) => `<!doctype html><html><head><title>T</title></head><body><main><article>${inner}</article></main></body></html>`;
  const result = (inner: string) => `<div id="readability-page-1" class="page">${inner}</div>`;
  const p = (word: string) => `<p>${s(word)}</p>`;
  const body = ['un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept'].map((n) => p(`Corps ${n}`)).join('');

  it('RG-01 : remet la suite entière du témoin, blocs courts compris entre deux blocs perdus', () => {
    const out = guardForTests({
      page: page(`<header>${p('Chapeau')}<p>6 nov. 2026</p>${p('Sous-titre')}</header><div>${body}</div>`),
      result: result(body),
      witness: result(`${p('Chapeau')}<p>6 nov. 2026</p>${p('Sous-titre')}${body}`),
    });
    const text = textOf(out.content);
    expect(text).toContain('6 nov. 2026');
    expect(text.indexOf(s('Chapeau'))).toBeLessThan(text.indexOf('6 nov. 2026'));
    expect(text.indexOf('6 nov. 2026')).toBeLessThan(text.indexOf(s('Sous-titre')));
  });

  it('RG-04 : la signature de l’auteur ne revient pas, même dans la suite remise', () => {
    const out = guardForTests({
      page: page(`<header>${p('Chapeau')}<div class="hero__author"><p>Camille Exemple</p>${p('Fonction de l’auteur')}</div><figure><img src="/une.jpg" width="1200"></figure></header><div>${body}</div>`),
      result: result(body),
      witness: result(`${p('Chapeau')}<p>Camille Exemple</p>${p('Fonction de l’auteur')}<figure><img src="https://example.com/une.jpg" width="1200"></figure>${body}`),
    });
    const text = textOf(out.content);
    expect(text).toContain(s('Chapeau'));
    expect(out.content).toContain('https://example.com/une.jpg');
    expect(text).not.toContain('Camille Exemple');
    expect(text).not.toContain('Fonction de l’auteur');
  });

  it('RG-02 : un bloc remis ne double pas ce que le résultat lit déjà (légende d’une image perdue, entrée de liste)', () => {
    const caption = s('Légende de l’image');
    const out = guardForTests({
      page: page(`<header><figure><img src="/une.jpg" width="1200"><figcaption>${caption}</figcaption></figure><ul><li>${s('Point lu')}</li><li>${s('Point perdu')}</li></ul></header><div>${body}<p>${caption}</p><p>${s('Point lu')}</p></div>`),
      result: result(`${body}<p>${caption}</p><p>${s('Point lu')}</p>`),
      witness: result(`<figure><img src="https://example.com/une.jpg" width="1200"><figcaption>${caption}</figcaption></figure><ul><li>${s('Point lu')}</li><li>${s('Point perdu')}</li></ul>${body}`),
    });
    const text = textOf(out.content);
    expect(out.content).toContain('https://example.com/une.jpg');
    expect(text).toContain(s('Point perdu'));
    expect(occurrences(text, caption)).toBe(1);
    expect(occurrences(text, s('Point lu'))).toBe(1);
  });

  it('RG-03 : un bloc remis prend sa place dans l’ordre de la page, après ce que le résultat gardait avant lui', () => {
    const out = guardForTests({
      page: page(`<figure><img src="/une.jpg" width="1200"></figure>${p('Chapeau')}<div>${body}</div>`),
      result: result(`<figure><img src="https://example.com/une.jpg" width="1200"></figure>${body}`),
      witness: result(`<figure><img src="https://example.com/une.jpg" width="1200"></figure>${p('Chapeau')}${body}`),
    });
    const html = out.content;
    expect(html.indexOf('une.jpg')).toBeLessThan(html.indexOf(s('Chapeau')));
    expect(html.indexOf(s('Chapeau'))).toBeLessThan(html.indexOf(s('Corps un')));
  });

  // RG-05 : quand le nettoyage a retiré une part coûteuse de la page (un pied
  // fait de chaînes imbriquées), relire la page intacte coûterait bien plus
  // que la passe nettoyée : la garde renonce au témoin.
  it('RG-05 : renonce au témoin quand la page intacte coûterait bien plus à lire que la page nettoyée', () => {
    // Presque sans texte : le nettoyage retire le pied (il ne porte pas la moitié du texte).
    const chain = `${'<div>'.repeat(200)}a${'</div>'.repeat(200)}`;
    const html = headerPageHtml().replace(/<\/body>/i, `<footer>${chain.repeat(60)}</footer></body>`);
    const guarded = countPasses(() => extractArticle('https://example.com/ars', html));
    const strict = countPasses(() => extractWithoutGuard('https://example.com/ars', html));
    expect(guarded).toBe(strict);
    // Sans ce pied, la même page demande son témoin.
    const light = headerPageHtml();
    expect(countPasses(() => extractArticle('https://example.com/ars', light))).toBe(countPasses(() => extractWithoutGuard('https://example.com/ars', light)) + 1);
  });
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

// ── Doublons de l'article complet (REG-225, REG-226) ─────────────────
// Une page porte parfois deux exemplaires d'un même bloc, dont sa feuille de
// style ne montre qu'un : le chapeau et la photo d'en-tête de The Verge, une
// fois par mise en page ; la légende d'Ars Technica, dans la visionneuse puis
// dans le `<figcaption>`. Le HTML ne dit pas lequel est masqué (classes
// hachées, feuille externe) : deux exemplaires qui se suivent, sans rien de
// lisible entre eux, n'en font qu'un.

describe('repli local — doublons : pages réelles (REG-225, REG-226)', () => {
  it('rend une fois le chapeau et la photo d’en-tête que la page porte pour deux mises en page (structure The Verge)', () => {
    const html = repeatLedePageHtml();
    const dek = norm(pick(html, 'div.duet--ledes--standard-lede p.duet--article--dangerously-set-cms-markup')?.textContent);
    expect(dek.length).toBeGreaterThan(50);
    expect(occurrences(textOf(html), dek)).toBe(2);
    const out = extractArticle('https://example.com/verge', html)!;
    expect(occurrences(textOf(out.content), dek)).toBe(1);
    const heroes = (Array.from(parseHTML(out.content).document.querySelectorAll('img')) as Element[]).filter((img) => /\/img\/2\.jpg/.test(img.getAttribute('src') || ''));
    expect(heroes).toHaveLength(1);
  });

  it('rend une fois la légende que la visionneuse double, et garde le `<figcaption>` (structure Ars Technica)', () => {
    const html = repeatLightboxPageHtml();
    const out = extractArticle('https://example.com/ars', html)!;
    const doc = parseHTML(out.content).document;
    const captions = Array.from(doc.querySelectorAll('figcaption')) as Element[];
    expect(captions.length).toBe(2);
    for (const caption of captions) {
      const line = norm(caption.textContent).slice(0, 80);
      expect(line.length).toBeGreaterThan(40);
      expect(occurrences(textOf(out.content), line)).toBe(1);
    }
    expect(doc.querySelectorAll('div.pswp-caption-content').length).toBe(0);
    expect(doc.querySelectorAll('img').length).toBe(2);
  });
});

describe('repli local — doublons : formes qui pourraient casser (REG-225, REG-226)', () => {
  const s = (word: string) => `${word} : une phrase inventée assez longue pour compter comme une phrase suivie.`;
  const p = (word: string) => `<p>${s(word)}</p>`;
  const dedupe = (inner: string) => withoutRepeatsForTests(`<div id="readability-page-1" class="page">${inner}</div>`);

  it('deux exemplaires qui se suivent n’en font qu’un ; le premier reste', () => {
    const out = dedupe(`<div><p class="un">${s('Chapeau')}</p></div><div><div><p class="deux">${s('Chapeau')}</p><p>Par Camille</p></div></div>${p('Corps')}`);
    expect(occurrences(textOf(out), s('Chapeau'))).toBe(1);
    expect(out).toContain('class="un"');
    expect(textOf(out)).toContain('Par Camille');
    expect(textOf(out)).toContain(s('Corps'));
  });

  it('une même phrase dans une liste puis dans un tableau reste deux fois (avis du CERT-FR)', () => {
    const line = 'Bulletin de sécurité Exemple 123 du 02 novembre 2026';
    const out = dedupe(`<table><tr><th>Source(s)</th><td>${line}</td></tr></table><ul><li><p>${line}</p></li></ul>`);
    expect(occurrences(textOf(out), line)).toBe(2);
    const listThenTable = dedupe(`<ul><li>${line}</li></ul><table><tr><td>${line}</td></tr></table>`);
    expect(occurrences(textOf(listThenTable), line)).toBe(2);
  });

  it('une citation reprise plus loin, après d’autre texte, reste (exergue)', () => {
    const out = dedupe(`${p('Citation')}${p('Corps un')}<blockquote>${s('Citation')}</blockquote>${p('Corps deux')}`);
    expect(occurrences(textOf(out), s('Citation'))).toBe(2);
  });

  it('deux paragraphes voisins qui ne sont pas identiques restent tous deux', () => {
    const out = dedupe(`${p('Début')}<p>${s('Début')} Et une suite qui le prolonge.</p>`);
    expect(occurrences(textOf(out), s('Début'))).toBe(2);
  });

  it('du code répété reste tel quel', () => {
    const code = 'const valeur = calculer(une, deux, trois); // assez long';
    const out = dedupe(`<pre><code>${code}</code></pre><pre><code>${code}</code></pre>`);
    expect(occurrences(textOf(out), code)).toBe(2);
  });

  it('la légende de la visionneuse sort, le `<figcaption>` et l’image restent', () => {
    const out = dedupe(`<figure><div class="lightbox"><a href="/a.jpg"><img src="https://example.com/a.jpg"></a><div class="cap">${s('Légende')}<div>Crédit : Exemple</div></div></div><figcaption><div>${s('Légende')} <span>Crédit : Exemple</span></div></figcaption></figure>`);
    expect(occurrences(textOf(out), s('Légende'))).toBe(1);
    expect(out).toContain('<figcaption>');
    expect(out).toContain('https://example.com/a.jpg');
    expect(out).not.toContain('class="cap"');
  });

  it('un bloc qui porte une image n’est jamais retiré pour son texte, ni avant ni après son double', () => {
    const before = dedupe(`<div><img src="https://example.com/a.jpg">${s('Légende')}</div><p>${s('Légende')}</p>`);
    expect(before).toContain('https://example.com/a.jpg');
    const after = dedupe(`<p>${s('Légende')}</p><div><img src="https://example.com/a.jpg">${s('Légende')}</div>`);
    expect(after).toContain('https://example.com/a.jpg');
    expect(occurrences(textOf(after), s('Légende'))).toBe(2);
  });

  it('deux images de même adresse mais de textes de remplacement différents restent deux', () => {
    const out = dedupe(`<img src="https://example.com/x.jpg" alt="Première vue"><img src="https://example.com/x.jpg" alt="Seconde vue">`);
    expect(out.match(/<img/g)).toHaveLength(2);
  });

  it('une légende courte en visionneuse que le `<figcaption>` ne reprend qu’en partie reste', () => {
    const out = dedupe(`<figure><div><img src="https://example.com/a.jpg"><div>${s('Légende de la visionneuse')}</div></div><figcaption>${s('Autre légende')}</figcaption></figure>`);
    expect(textOf(out)).toContain(s('Légende de la visionneuse'));
    const outside = dedupe(`<p>${s('Paragraphe')}</p><figure><img src="https://example.com/a.jpg"><figcaption>${s('Paragraphe')} Crédit : Exemple</figcaption></figure>`);
    expect(occurrences(textOf(outside), s('Paragraphe'))).toBe(2);
  });

  it('la même photo en deux largeurs côte à côte n’en fait qu’une', () => {
    const out = dedupe(`<div><div><img src="https://example.com/une.jpg?w=1080&amp;crop=a"></div><div><img src="https://example.com/une.jpg?w=2400&amp;crop=a"></div></div>${p('Corps')}`);
    expect(out.match(/une\.jpg/g)).toHaveLength(1);
  });

  it('une galerie où la même photo revient après une autre, ou après sa légende, la garde à chaque fois', () => {
    const gallery = dedupe(`<img src="https://example.com/a.jpg"><img src="https://example.com/b.jpg"><img src="https://example.com/a.jpg">`);
    expect(gallery.match(/a\.jpg/g)).toHaveLength(2);
    const captioned = dedupe(`<figure><img src="https://example.com/a.jpg"><figcaption>Avant</figcaption></figure><figure><img src="https://example.com/a.jpg"><figcaption>Après</figcaption></figure>`);
    expect(captioned.match(/a\.jpg/g)).toHaveLength(2);
  });

  it('une photo et sa miniature dans un `srcset` restent une seule image, intacte', () => {
    const html = `<img src="https://example.com/a.jpg" srcset="https://example.com/a-300x200.jpg 300w, https://example.com/a.jpg 1200w">${p('Corps')}`;
    expect(dedupe(html).match(/<img/g)).toHaveLength(1);
    expect(dedupe(html)).toContain('a-300x200.jpg 300w');
  });

  it('rien de répété : le HTML est rendu tel quel', () => {
    const html = `<div id="readability-page-1" class="page">${p('Un')}${p('Deux')}<img src="https://example.com/a.jpg"></div>`;
    expect(withoutRepeatsForTests(html)).toBe(html);
  });
});

// Relecture du correctif (RD-01 à RD-07) : rien de l'article ne doit manquer,
// un doublon vaut mieux qu'une perte. Le texte ne se retire que dans
// l'en-tête (avant le premier paragraphe du corps) et dans une figure.
describe('repli local — doublons : relecture (RD-01 à RD-07)', () => {
  const s = (word: string) => `${word} : une phrase inventée assez longue pour compter comme une phrase suivie.`;
  const p = (word: string) => `<p>${s(word)}</p>`;
  const corps = `<p>${s('Premier paragraphe du corps')} ${s('Et sa deuxième phrase')}</p>`;
  const dedupe = (inner: string) => withoutRepeatsForTests(`<div id="readability-page-1" class="page">${inner}</div>`);

  it('RD-01 : un refrain, une anaphore ou une réplique répétée dans le corps reste deux fois', () => {
    const refrain = `<p>Et je chante encore sous la pluie de novembre, mon amour.</p>`;
    expect(occurrences(textOf(dedupe(`${corps}${refrain}${refrain}${p('Fin')}`)), 'Et je chante encore')).toBe(2);
    expect(occurrences(textOf(dedupe(`${corps}${p('Jamais')}${p('Jamais')}`)), s('Jamais'))).toBe(2);
  });

  it('RD-01 : un refrain répété reste deux fois dans un vrai article', () => {
    const filler = Array.from({ length: 8 }, (_, i) => `<p>Paragraphe de corps numéro ${i}, qui raconte la soirée avec assez de détails pour que Readability retienne le texte.</p>`).join('');
    const refrain = '<p>Et je chante encore sous la pluie de novembre, mon amour,<br>Et la ville se tait quand tu passes près de moi.</p>';
    const html = `<html><head><title>Chanson</title></head><body><article><h1>Chanson</h1>${filler}${refrain}${refrain}<p>Fin de la chanson, et un dernier mot de l’auteur pour conclure.</p>${filler}</article></body></html>`;
    expect(occurrences(textOf(extractArticle('https://example.com/chanson', html)!.content), 'Et je chante encore')).toBe(2);
  });

  it('RD-01 : deux répliques qui ne diffèrent que par la ponctuation ou la casse restent deux, même en tête', () => {
    const out = dedupe('<p>— Tu viens avec nous au concert de ce soir ?</p><p>— Tu viens avec nous au concert de ce soir !</p>' + corps);
    expect(occurrences(textOf(out), 'au concert de ce soir')).toBe(2);
    const casse = dedupe(`<p>${s('Chapeau')}</p><p>${s('Chapeau').toUpperCase()}</p>${corps}`);
    expect(textOf(casse)).toContain(s('Chapeau').toUpperCase());
  });

  it('RD-01 : le chapeau doublé en tête, avant le premier paragraphe du corps, n’apparaît qu’une fois', () => {
    const out = dedupe(`<div>${p('Chapeau')}</div><div>${p('Chapeau')}<p>Par Camille</p></div>${corps}${p('Chapeau')}`);
    // En tête : une fois ; repris plus loin dans le corps : il reste.
    expect(occurrences(textOf(out), s('Chapeau'))).toBe(2);
    expect(textOf(out).indexOf(s('Chapeau'))).toBeLessThan(textOf(out).indexOf('Par Camille'));
  });

  it('RD-04 : un bloc qui enveloppe un tableau, une liste ou du code n’est jamais retiré', () => {
    const line = 'CERTFR-2026-AVI-0001 bulletin de sécurité Exemple du mois';
    const wrapped = dedupe(`<div class="w"><table><tr><td>${line}</td></tr></table></div><div class="w"><ul><li>${line}</li></ul></div>`);
    expect(occurrences(textOf(wrapped), line)).toBe(2);
    const code = 'pip install requests beautifulsoup4 lxml --upgrade';
    const tabs = dedupe(`<div class="highlight"><pre><code>${code}</code></pre></div><div class="highlight"><pre><code>${code}</code></pre></div>`);
    expect(occurrences(textOf(tabs), code)).toBe(2);
  });

  it('RD-05 : trois exemplaires en tête, chacun dans sa mise en page, n’en font qu’un', () => {
    const out = dedupe(`<div class="a">${p('Chapeau')}</div><div class="b">${p('Chapeau')}</div><div class="c">${p('Chapeau')}</div>${corps}`);
    expect(occurrences(textOf(out), s('Chapeau'))).toBe(1);
  });

  it('RD-01 : deux paragraphes frères identiques, même en tête, restent deux (répétition écrite)', () => {
    const out = dedupe(`${p('Encore')}${p('Encore')}${corps}`);
    expect(occurrences(textOf(out), s('Encore'))).toBe(2);
  });

  it('RD-05 : l’exemplaire qui porte un lien reste', () => {
    const out = dedupe(`${p('Chapeau')}<p><a href="https://example.com/rapport">${s('Chapeau')}</a></p>${corps}`);
    expect(occurrences(textOf(out), s('Chapeau'))).toBe(1);
    expect(out).toContain('https://example.com/rapport');
  });

  it('RD-05 : un intertitre n’est jamais retiré', () => {
    const titre = '<h2>Mise à jour du 5 novembre à 14 heures, ce qui change</h2>';
    expect(occurrences(textOf(dedupe(`${titre}${titre}${corps}`)), 'Mise à jour du 5 novembre')).toBe(2);
  });

  it('RD-05 : une légende placée avant l’image reste, la copie de la visionneuse sort', () => {
    const out = dedupe(`<figure><figcaption>${s('Légende')}</figcaption><div class="cap">${s('Légende')}</div><img src="https://example.com/a.jpg"></figure>${corps}`);
    expect(occurrences(textOf(out), s('Légende'))).toBe(1);
    expect(out).toContain('<figcaption>');
  });

  it('RD-05 : une légende et le paragraphe du corps qui la reprend, hors de la figure, restent', () => {
    const out = dedupe(`${corps}<figure><img src="https://example.com/a.jpg"><figcaption>${s('Le pont au coucher du soleil')}</figcaption></figure>${p('Le pont au coucher du soleil')}`);
    expect(occurrences(textOf(out), s('Le pont au coucher du soleil'))).toBe(2);
  });

  it('RD-02 : deux images d’une même adresse qui ne diffèrent que par un paramètre d’identité restent deux', () => {
    const out = dedupe(`<figure><img src="https://example.com/step.png?step=1" alt=""></figure><figure><img src="https://example.com/step.png?step=2" alt=""></figure>`);
    expect(out.match(/<img/g)).toHaveLength(2);
  });

  it('RD-02 : une image sans texte de remplacement n’est pas retirée face à une image qui en a un', () => {
    expect(dedupe(`<img src="https://example.com/x.jpg" alt=""><img src="https://example.com/x.jpg" alt="Vue de près">`).match(/<img/g)).toHaveLength(2);
    expect(dedupe(`<img src="https://example.com/x.jpg"><img src="https://example.com/x.jpg" alt="Vue de près">`).match(/<img/g)).toHaveLength(2);
  });

  it('RD-03 : deux images au même repli mais aux `srcset` différents restent deux', () => {
    const out = dedupe(`<img src="https://example.com/fallback.jpg" srcset="https://example.com/a.jpg 800w"><img src="https://example.com/fallback.jpg" srcset="https://example.com/b.jpg 800w">`);
    expect(out.match(/<img/g)).toHaveLength(2);
    const lazy = dedupe(`<img src="https://example.com/fallback.jpg" data-lazy-src="https://example.com/a.jpg"><img src="https://example.com/fallback.jpg" data-lazy-src="https://example.com/b.jpg">`);
    expect(lazy.match(/<img/g)).toHaveLength(2);
  });

  it('RD-05 : une suite de N copies de la même photo n’en laisse qu’une', () => {
    const imgs = Array.from({ length: 5 }, () => '<div><img src="https://example.com/a.jpg?w=800" alt="A"></div>').join('');
    expect(dedupe(`${imgs}${corps}`).match(/<img/g)).toHaveLength(1);
  });

  // RD-07 : chaque retrait relisait tous les enfants du parent — 20 000
  // images d'un même bloc coûtaient 4,5 s. Le travail se compte : il doit
  // croître comme la page, pas comme son carré.
  it('RD-07 : le travail croît comme le nombre d’images, pas comme son carré', () => {
    const work = (n: number) => {
      const stats = { visits: 0 };
      withoutRepeatsForTests(`<div><p>${s('Introduction')}</p>${'<img src="https://example.com/a.jpg">'.repeat(n)}</div>`, undefined, stats);
      return stats.visits;
    };
    const small = work(1000);
    const big = work(4000);
    expect(small).toBeGreaterThan(0);
    expect(big).toBeLessThan(small * 4 * 1.5);
  });
});

describe('repli local — garde de non-perte : rien d’invisible, rien de déjà là (REG-225)', () => {
  const s = (word: string) => `${word} : une phrase inventée assez longue pour être suivie par la garde de non-perte.`;
  const page = (inner: string) => `<!doctype html><html><head><title>T</title></head><body><main><article>${inner}</article></main></body></html>`;
  const result = (inner: string) => `<div id="readability-page-1" class="page">${inner}</div>`;
  const p = (word: string) => `<p>${s(word)}</p>`;
  const body = ['un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept'].map((n) => p(`Corps ${n}`)).join('');
  const restored = (header: string) => textOf(guardForTests({
    page: page(`<header>${header}</header><div>${body}</div>`),
    result: result(body),
    witness: result(`${p('Chapeau')}${body}`),
  }).content).includes(s('Chapeau'));

  it('un chapeau masqué sur la page n’est jamais remis : en ligne, par attribut, par un ancêtre, par une classe de masquage', () => {
    expect(restored(`<p style="display:none">${s('Chapeau')}</p>`)).toBe(false);
    expect(restored(`<p style="visibility: hidden">${s('Chapeau')}</p>`)).toBe(false);
    expect(restored(`<p hidden>${s('Chapeau')}</p>`)).toBe(false);
    expect(restored(`<div aria-hidden="true"><p>${s('Chapeau')}</p></div>`)).toBe(false);
    expect(restored(`<div class="mobile hidden"><p>${s('Chapeau')}</p></div>`)).toBe(false);
    expect(restored(`<div class="d-none"><p>${s('Chapeau')}</p></div>`)).toBe(false);
  });

  // Une page qui masque le chapeau en mobile et le montre en bureau : il se
  // lit sur la page, la garde le remet.
  it('un chapeau masqué seulement à certaines tailles d’écran est remis', () => {
    expect(restored(`<div class="hidden md:block"><p>${s('Chapeau')}</p></div>`)).toBe(true);
    expect(restored(`<div class="d-none d-lg-block"><p>${s('Chapeau')}</p></div>`)).toBe(true);
    expect(restored(`<p class="hidden-title">${s('Chapeau')}</p>`)).toBe(true);
    expect(restored(p('Chapeau'))).toBe(true);
  });

  it('une image d’en-tête que le résultat montre à une autre taille n’est pas remise', () => {
    const out = guardForTests({
      page: page(`<header><img src="/une.jpg?w=2400&amp;quality=90" width="1200"></header><div><figure><img src="/une-1200x675.jpg" width="1200"></figure>${body}</div>`),
      result: result(`<figure><img src="https://example.com/une-1200x675.jpg" width="1200"></figure>${body}`),
      witness: result(`<figure><img src="https://example.com/une.jpg?w=2400&amp;quality=90" width="1200"></figure><figure><img src="https://example.com/une-1200x675.jpg" width="1200"></figure>${body}`),
    });
    expect(out.content.match(/une[-.]/g)).toHaveLength(1);
  });

  it('une image d’en-tête qui est une autre photo que celles du résultat est remise', () => {
    const out = guardForTests({
      page: page(`<header><img src="/une.jpg" width="1200"></header><div><figure><img src="/corps.jpg" width="1200"></figure>${body}</div>`),
      result: result(`<figure><img src="https://example.com/corps.jpg" width="1200"></figure>${body}`),
      witness: result(`<figure><img src="https://example.com/une.jpg" width="1200"></figure><figure><img src="https://example.com/corps.jpg" width="1200"></figure>${body}`),
    });
    expect(out.content).toContain('https://example.com/une.jpg');
  });
});
