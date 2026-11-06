// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractFullContent,
  retryAfterMs,
  RateLimitedError,
  NotExtractableError,
  PageTooComplexError,
  ExtractTimeoutError,
  ExtractorBusyError,
  ExtractorCrashedError,
  UpstreamRefusedError,
  forgetExtractFailures,
  FALLBACK_EXTRACT_TIMEOUT_MS,
  FALLBACK_MAX_HTML_BYTES,
  RATE_LIMIT_MAX_WAIT_MS,
  SERVER_EXTRACT_TIMEOUT_MS,
} from './extractContent';
import { advisoryPageHtml, ADVISORY_BODY_MARKER } from '../test/advisoryPageFixture';
import { blogPageHtml, BLOG_BODY_MARKER, newsPageHtml, pressPageHtml, shortPostPageHtml } from '../test/boilerplatePageFixtures';
import { INLINE_IMAGE, LAZY_IMAGES, lazyImagePageHtml } from '../test/lazyImagePageFixture';
import { splitBodyAcrossImagesPageHtml, splitBodyPageHtml, splitBodyWithBioPageHtml } from '../test/splitBodyPageFixtures';

const serverAnswer = {
  title: 'Titre serveur', content: '<p>corps serveur</p>',
  excerpt: '', byline: '', siteName: '', length: 12,
};

const pageHtml = `<!doctype html><html><body><article>
<p>Un paragraphe assez long pour que Readability retienne ce corps comme article, avec suffisamment de mots.</p>
<p>Un second paragraphe, lui aussi fourni, pour dépasser le seuil de lisibilité.</p>
</article></body></html>`;

/** Ce que le proxy relaie d'une vraie page : son type d'origine compris. */
const htmlPage = (body: string) => new Response(body, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

// La mémoire des échecs (L-03) vit le temps de la session : chaque test part
// d'une session neuve, sinon un échec d'un test priverait le suivant de réseau.
beforeEach(() => { vi.restoreAllMocks(); forgetExtractFailures(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('extractFullContent', () => {
  it('utilise la réponse du serveur quand elle arrive', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      if (String(input).startsWith('/api/extract')) {
        return new Response(JSON.stringify(serverAnswer), { status: 200 });
      }
      throw new Error('le client ne doit pas aller chercher la page lui-même');
    }));
    const out = await extractFullContent('https://example.com/a');
    expect(out.content).toContain('corps serveur');
  });

  // La route rend du HTML BRUT, délibérément : `createDOMPurify` sur `linkedom`
  // ne filtre rien côté serveur. Sans cet assainissement à la réception, un
  // gestionnaire d'événement porté par la page d'origine partirait tel quel
  // dans IndexedDB (`putExtract`) — une XSS stockée, atteignable depuis
  // n'importe quel flux.
  it('assainit le HTML rendu par le serveur avant de le retourner', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      if (String(input).startsWith('/api/extract')) {
        return new Response(JSON.stringify({
          ...serverAnswer,
          content: '<p>corps serveur</p><img src="x" onerror="alert(2)"><a href="#" onclick="alert(1)">lien</a>',
        }), { status: 200 });
      }
      throw new Error('le client ne doit pas aller chercher la page lui-même');
    }));
    const out = await extractFullContent('https://example.com/a');
    expect(out.content).toContain('corps serveur');
    expect(out.content).not.toMatch(/onerror/i);
    expect(out.content).not.toMatch(/onclick/i);
  });

  // La route ne rend que ce que le serveur a réellement extrait — les champs
  // absents ne doivent pas partir tels quels dans IndexedDB (`putExtract`), et
  // une clé que la route ajouterait ne doit pas s'y inviter. Le chemin local
  // normalise déjà ; celui-ci doit le faire de la même façon.
  it('normalise les champs du serveur et n’en garde aucun autre', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      if (String(input).startsWith('/api/extract')) {
        return new Response(JSON.stringify({
          content: '<p>corps serveur</p>', imprevu: 'clé que le client ne connaît pas',
        }), { status: 200 });
      }
      throw new Error('le client ne doit pas aller chercher la page lui-même');
    }));
    const out = await extractFullContent('https://example.com/a');
    expect(out).toEqual({
      title: '', content: '<p>corps serveur</p>',
      excerpt: '', byline: '', siteName: '', length: 0,
    });
    expect(Object.keys(out).sort()).toEqual(
      ['byline', 'content', 'excerpt', 'length', 'siteName', 'title'],
    );
  });

  // Une route qui accepte la connexion et ne répond jamais tenait l'extraction
  // indéfiniment. Les deux appelants étant séquentiels, un article suffisait à
  // bloquer toute la file — et « Article complet » restait sur « Extraction… ».
  it('abandonne une route muette au bout du délai et se replie', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', vi.fn((input: RequestInfo, init?: RequestInit) => {
        if (String(input).startsWith('/api/extract')) {
          // Ne se règle QUE sur l'abandon : sans minuteur côté client, la
          // promesse ci-dessous n'aboutit jamais et ce test expire.
          return new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          });
        }
        return Promise.resolve(htmlPage(pageHtml));
      }));
      const pending = extractFullContent('https://example.com/a');
      await vi.advanceTimersByTimeAsync(SERVER_EXTRACT_TIMEOUT_MS);
      const out = await pending;
      expect(out.content).toContain('paragraphe');
    } finally {
      vi.useRealTimers();
    }
  });

  for (const [label, reply] of [
    ['404 (serveur plus ancien, route absente)', () => new Response('', { status: 404 })],
    ['500', () => new Response('', { status: 500 })],
    ['corps illisible', () => new Response('pas du json', { status: 200 })],
    // Le 200 à `content` vide est la raison d'être du 422 côté serveur : sans
    // cette garde, le volet afficherait un article vide au lieu d'extraire.
    ['200 au content vide', () => new Response(JSON.stringify({ ...serverAnswer, content: '' }), { status: 200 })],
    ['200 sans champ content', () => new Response(JSON.stringify({ title: 'Titre seul' }), { status: 200 })],
    ['erreur réseau', (): Response => { throw new TypeError('Failed to fetch'); }],
  ] as const) {
    it(`se replie sur l’extraction locale — ${label}`, async () => {
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
        if (String(input).startsWith('/api/extract')) return reply();
        return htmlPage(pageHtml);
      }));
      const out = await extractFullContent('https://example.com/a');
      expect(out.content).toContain('paragraphe');
      expect(out.content).not.toContain('corps serveur');
    });
  }
});

// ── Le repli local et les URLs relatives ─────────────────────────────
// Le document du repli naît d'un `DOMParser` : il hérite de l'origine de
// FriRSS, et le `<base>` qu'on y injectait est refusé par la CSP
// (`base-uri 'self'`). Readability résolvait alors `/img/a.png` contre
// l'origine de l'app — image en 404, liens qui ramènent dans FriRSS.
// jsdom n'applique pas de CSP : ce test reproduit donc la situation de
// production en posant explicitement la base du document ailleurs.
describe('extractFullContent — repli local et URLs relatives', () => {
  const pageRelative = `<!doctype html><html><body><article>
<p>Un paragraphe assez long pour que Readability retienne ce corps comme article, avec suffisamment de mots.</p>
<p>Un second paragraphe, lui aussi fourni, pour dépasser le seuil de lisibilité. <img src="/img/a.png"> <a href="/suite/">la suite</a></p>
</article></body></html>`;

  it('résout les URLs relatives contre l’article, pas contre l’origine de l’app', async () => {
    const parse = DOMParser.prototype.parseFromString;
    vi.spyOn(DOMParser.prototype, 'parseFromString').mockImplementation(function (this: DOMParser, ...args: Parameters<typeof parse>) {
      const doc = parse.apply(this, args);
      Object.defineProperty(doc, 'baseURI', { value: 'https://frirss.example.com/', configurable: true });
      return doc;
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      if (String(input).startsWith('/api/extract')) return new Response('', { status: 502 });
      return htmlPage(pageRelative);
    }));

    const out = await extractFullContent('https://presse.example.fr/2026/avis/');

    expect(out.content).toContain('https://presse.example.fr/img/a.png');
    expect(out.content).toContain('https://presse.example.fr/suite/');
    expect(out.content).not.toContain('frirss.example.com');
  });
});

// L-04 : même seuil que la route serveur. À 50 caractères, une courte section
// restée après la première passe de Readability (la « Solutions » d'un avis du
// CERT-FR) passait pour l'article entier.
describe('extractFullContent — repli local : seuil de Readability', () => {
  it('ne se contente pas d’une courte section quand le corps est ailleurs', async () => {
    const body = Array.from({ length: 12 }, (_, i) => `<p>Paragraphe ${i} du bulletin, qui décrit la vulnérabilité, les systèmes affectés et le risque encouru, longuement.</p>`).join('');
    const html = `<!doctype html><html><head><title>Avis</title></head><body>
      <div class="sidebar-layout">${body}</div>
      <section><h2>Solutions</h2><p>Se référer au bulletin de sécurité de l’éditeur pour l’obtention des correctifs.</p></section>
    </body></html>`;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      if (String(input).startsWith('/api/extract')) return new Response('', { status: 404 });
      return htmlPage(html);
    }));
    const out = await extractFullContent('https://example.com/avis-seuil');
    expect(out.content).toContain('Paragraphe 11 du bulletin');
  });
});

// A-1 : la même règle que la route serveur (`server/extract.ts`). Readability
// gardait la première section d'un `<article>` unique et écartait le corps.
describe('extractFullContent — repli local : conteneur principal', () => {
  it('ne garde pas un fragment quand le conteneur principal de la page est bien plus long', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      if (String(input).startsWith('/api/extract')) return new Response('', { status: 404 });
      return htmlPage(advisoryPageHtml());
    }));
    const out = await extractFullContent('https://example.com/avis-conteneur');
    expect(out.content).toContain(ADVISORY_BODY_MARKER);
    expect(out.content).toContain('EX-2026-1008');
    expect(out.content).not.toContain('mentions légales');
    expect(out.title).toBe('Avis d’exemple');
  });

  // N-1 (vérification 1.9.0) : même règle que le serveur — la seconde passe
  // n'est adoptée que si elle rend nettement plus de texte.
  it('n’adopte pas une seconde passe qui ne rend guère plus de texte (structure Numerama)', async () => {
    const html = pressPageHtml();
    const page = new DOMParser().parseFromString(html, 'text/html');
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const promo = norm(page.querySelector('.promotional-quote-separator + [data-nosnippet] p')!.textContent);
    const product = norm(page.querySelector('.product-block')!.textContent);
    const paragraphs = Array.from(page.querySelectorAll('.article-content > p'), (p) => norm(p.textContent));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      if (String(input).startsWith('/api/extract')) return new Response('', { status: 404 });
      return htmlPage(html);
    }));

    const out = await extractFullContent('https://example.com/presse');
    const text = norm(new DOMParser().parseFromString(out.content, 'text/html').body.textContent);

    expect(text).toContain(paragraphs[0]);
    expect(text).toContain(paragraphs[paragraphs.length - 1]);
    expect(text).not.toContain(promo);
    expect(text).not.toContain(product.slice(0, 40));
  });
});

// A1 (campagne 1.9.0, troisième round) : même résolution des images
// paresseuses que la route serveur (`server/extract.ts`, `resolveLazyImages`).
// Ici, elle compte double : `sanitizeExtracted` retire tous les `data-*`.
describe('extractFullContent — repli local : images paresseuses (A1)', () => {
  const imgs = (html: string) => Array.from(new DOMParser().parseFromString(html, 'text/html').querySelectorAll('img'), (img) => img.getAttribute('src') || '');
  const extractLazyPage = async (url: string) => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      if (String(input).startsWith('/api/extract')) return new Response('', { status: 404 });
      return htmlPage(lazyImagePageHtml());
    }));
    return extractFullContent(url);
  };

  it('rend l’adresse réelle d’une image paresseuse, pas son cadre blanc', async () => {
    const out = await extractLazyPage('https://example.com/usine-a');
    const sources = imgs(out.content);
    expect(sources).toContain(LAZY_IMAGES.picture);
    expect(sources.filter((src) => src.startsWith('data:image/svg'))).toEqual([]);
    expect(out.content).toContain(LAZY_IMAGES.pictureSet);
  });

  it('garde l’image que seul son `noscript` porte, et celle d’un bouton d’agrandissement', async () => {
    const sources = imgs((await extractLazyPage('https://example.com/usine-b')).content);
    expect(sources).toContain(LAZY_IMAGES.noscriptOnly);
    expect(sources).toContain(LAZY_IMAGES.zoomed);
  });

  it('ne touche pas une vraie image en ligne', async () => {
    expect(imgs((await extractLazyPage('https://example.com/usine-c')).content)).toContain(INLINE_IMAGE);
  });

  it('résout une adresse data-src relative contre l’article', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      if (String(input).startsWith('/api/extract')) return new Response('', { status: 404 });
      return htmlPage(lazyImagePageHtml().replace(`data-src="${LAZY_IMAGES.picture}"`, 'data-src="/media/usine-relative.jpg"'));
    }));
    const out = await extractFullContent('https://presse.example.fr/2026/usine/');
    expect(imgs(out.content)).toContain('https://presse.example.fr/media/usine-relative.jpg');
  });
});

// M-04 : les mêmes blocs étrangers que côté serveur (`server/extract.ts`,
// `stripBoilerplate`) sortent du document avant toute passe.
describe('extractFullContent — repli local : blocs étrangers (M-04)', () => {
  const fallbackOn = (html: string) => vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
    if (String(input).startsWith('/api/extract')) return new Response('', { status: 404 });
    return htmlPage(html);
  }));
  const textOf = (html: string) => (new DOMParser().parseFromString(html, 'text/html').body.textContent || '').replace(/\s+/g, ' ').trim();

  it('ne ramasse pas les mentions légales de la lettre d’information du rail (structure The Verge)', async () => {
    const html = newsPageHtml();
    const page = new DOMParser().parseFromString(html, 'text/html');
    const legal = (page.querySelector('.duet--layout--rail form')!.textContent || '').replace(/\s+/g, ' ').trim();
    const firstParagraph = (page.querySelector('.duet--article--article-body-component p')!.textContent || '').replace(/\s+/g, ' ').trim();
    fallbackOn(html);

    const out = await extractFullContent('https://example.com/news');

    expect(textOf(out.content)).toContain(firstParagraph);
    expect(textOf(out.content)).not.toContain(legal.slice(-80));
  });

  it('ne ramasse ni fil d’Ariane, ni commentaires, ni crédits d’un billet court (structure Schneier)', async () => {
    fallbackOn(blogPageHtml());
    const text = textOf((await extractFullContent('https://example.com/blog')).content);
    expect(text).toContain(BLOG_BODY_MARKER);
    for (const junk of ['Accueil', 'Commentaires', 'Powered by', 'S’abonner aux commentaires', 'Laisser un commentaire', 'Billet précédent']) {
      expect(text).not.toContain(junk);
    }
  });

  // Relecture 1.9.0 (R1-2) : `share` retirait tout bloc dont la classe
  // contenait le mot, même une analyse de « share of voice » que Readability
  // gardait. (Le tableau `share-table` du serveur, Readability l'écarte
  // lui-même sous jsdom : seul le nettoyage est en cause ici.)
  it('garde une longue analyse dont la classe contient « share »', async () => {
    const para = (s: string) => `<p>${`${s} `.repeat(12)}</p>`;
    fallbackOn(`<html><head><title>Market</title></head><body><article><h1>Market</h1>${
      para('The market for phones changed a lot this quarter according to analysts.')
    }<div class="share-of-voice-analysis">${
      para('SHAREDIV analysis paragraph that is a genuine part of the article body.')
    }</div>${para('Conclusion sentence closing the article with a summary of the findings.')}${
      para('Another paragraph so that the analysis weighs less than half of the page.')
    }</article></body></html>`);
    const text = textOf((await extractFullContent('https://example.com/market')).content);
    expect(text).toContain('SHAREDIV');
  });

  // Relecture 1.9.0 (R1-3) : le repli n'avait aucune borne de profondeur.
  // Readability coûte le cube de la profondeur : une page piégée que le
  // serveur n'a pas pu refuser (route absente) gelait l'onglet.
  it('refuse une page piégée sans l’analyser, et la retient pour la session', async () => {
    const proxyCalls = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      if (String(input).startsWith('/api/extract')) return new Response('', { status: 404 });
      proxyCalls();
      return htmlPage(`<html><body>${'<div>'.repeat(2000)}<p>court</p>${'</div>'.repeat(2000)}</body></html>`);
    }));
    const started = performance.now();
    await expect(extractFullContent('https://example.com/piege-repli')).rejects.toBeInstanceOf(PageTooComplexError);
    expect(performance.now() - started).toBeLessThan(1000);
    await expect(extractFullContent('https://example.com/piege-repli')).rejects.toBeInstanceOf(NotExtractableError);
    expect(proxyCalls).toHaveBeenCalledTimes(1);
  });

  it('garde le conteneur principal complet du CERT-FR', async () => {
    fallbackOn(advisoryPageHtml());
    const out = await extractFullContent('https://example.com/avis-m04');
    expect(out.content).toContain(ADVISORY_BODY_MARKER);
    expect(out.content).toContain('Gestion du document');
  });

  // A2 (campagne 1.9.0, troisième round) : même billet que le serveur.
  it('rend le texte d’un billet très court, pas la colonne voisine (structure Simon Willison)', async () => {
    const html = shortPostPageHtml();
    const page = new DOMParser().parseFromString(html, 'text/html');
    const post = (page.querySelector('.beat-note p')!.textContent || '').replace(/\s+/g, ' ').trim();
    const column = (page.querySelector('#secondary .this-is')!.textContent || '').replace(/\s+/g, ' ').trim();
    fallbackOn(html);
    const text = textOf((await extractFullContent('https://example.com/billet')).content);
    expect(text).toContain(post);
    expect(text).not.toContain(column);
  });

  // A3 (campagne 1.9.0, troisième round) : mêmes familles que le serveur.
  it('retire publicité, affiliation, formulaire de lettre d’information, repli CodePen et colonne `#secondary`', async () => {
    const para = (i: number) => `<p>Paragraphe ${i} de l’article, qui raconte longuement ce qui s’est passé, avec des détails et des chiffres pour peser.</p>`;
    const body = (from: number) => Array.from({ length: 5 }, (_, i) => para(from + i)).join('');
    const faq = 'Les données transmises par ce formulaire servent à envoyer la lettre et ne sont jamais revendues. '.repeat(6);
    fallbackOn(`<html><head><title>Article</title></head><body><div id="wrapper"><div id="primary"><article><h1>Article</h1>${body(1)}
      <div class="column google-ad"><span class="ad-label">PUB DU SITE</span></div>${body(6)}
      <figure><p data-slug-hash="AbCdEf">DEMOREPLI See the Pen démo by Auteur.</p><figcaption>See the Pen <a href="/x">démo</a> by Auteur.</figcaption></figure>${body(11)}
      <div class="newsletter-form"><p>Recevez nos bons plans</p><input type="email"><div class="newsletter-form__faq"><p>${faq}</p></div></div>
      <p class="affiliate-disclaimer-text">Un achat par nos liens peut nous rapporter une commission.</p>${body(16)}
    </article></div><div id="secondary"><p>COLONNE billet publié le 4 novembre.</p><p>Soutenez-moi chaque mois.</p></div></div></body></html>`);
    const text = textOf((await extractFullContent('https://example.com/a3')).content);
    expect(text).toContain('Paragraphe 20');
    for (const junk of ['PUB DU SITE', 'DEMOREPLI', 'jamais revendues', 'commission', 'COLONNE']) expect(text).not.toContain(junk);
  });

  // B-02 (quatrième round) : chaque formulaire de lettre d'information
  // relisait tout le texte de son billet (voir le serveur) : 3,4 s ici dans
  // jsdom, 0,23 s depuis — Readability compris.
  it('ne relit pas tout le billet pour chaque formulaire de lettre d’information', async () => {
    const paragraph = `<p>${'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(40)}</p>`;
    fallbackOn(`<html><head><title>Article</title></head><body><article><h1>Article</h1>${paragraph.repeat(200)}${'<div class="newsletter"><input></div>'.repeat(2000)}</article></body></html>`);
    const started = performance.now();
    const { content } = await extractFullContent('https://example.com/formulaires');
    expect(performance.now() - started).toBeLessThan(1500);
    expect(content).toContain('Lorem ipsum');
    expect(content).not.toContain('<input');
  });
});

// ── Corps réparti en plusieurs blocs (campagne 1.9.0, troisième round) ──
// Mêmes pages que la route serveur (`server/test/extract.test.ts`, qui dit
// pourquoi) : chaque bloc du corps d'Ars Technica, pas la notice de l'auteur.
describe('extractFullContent — repli local : corps réparti en plusieurs blocs', () => {
  const fallbackOn = (html: string) => vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
    if (String(input).startsWith('/api/extract')) return new Response('', { status: 404 });
    return htmlPage(html);
  }));
  const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
  const textOf = (html: string) => norm(new DOMParser().parseFromString(html, 'text/html').body.textContent);
  const blocksOf = (html: string) => Array.from(new DOMParser().parseFromString(html, 'text/html').querySelectorAll('div.post-content'), (b) => norm(b.textContent));

  it('garde chaque bloc d’un corps réparti, chapeau compris (structure Ars Technica)', async () => {
    const html = splitBodyPageHtml();
    const blocks = blocksOf(html);
    fallbackOn(html);
    const text = textOf((await extractFullContent('https://example.com/ars-repli')).content);
    for (const block of blocks) expect(text).toContain(block);
    expect(text.indexOf(blocks[0])).toBeLessThan(text.indexOf(blocks[2]));
  });

  it('garde tout le corps réparti sans la notice de l’auteur qui le suit (structure Ars Technica)', async () => {
    const html = splitBodyWithBioPageHtml();
    const blocks = blocksOf(html);
    const bio = norm(new DOMParser().parseFromString(html, 'text/html').querySelector('.author-mini-bio')!.textContent);
    fallbackOn(html);
    const text = textOf((await extractFullContent('https://example.com/ars-bio-repli')).content);
    for (const block of blocks) expect(text).toContain(block);
    expect(text).not.toContain(bio.slice(-80));
  });

  it('garde tout un corps que des images coupent, chapeau et images compris (structure Clubic)', async () => {
    const html = splitBodyAcrossImagesPageHtml();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const blocks = Array.from(doc.querySelectorAll('div.slate-content p'), (b) => norm(b.textContent)).filter(Boolean);
    expect(blocks.length).toBeGreaterThan(5);
    const bodyImages = Array.from(doc.querySelectorAll('article img'), (img) => img.getAttribute('src')!);
    expect(bodyImages).toHaveLength(2);
    fallbackOn(html);
    const { content } = await extractFullContent('https://example.com/clubic-repli');
    const text = textOf(content);
    for (const block of blocks) expect(text).toContain(block);
    for (const src of bodyImages) expect(content).toContain(`https://example.com${src}`);
  });

  it('ne vide pas les cellules d’un tableau dans la première', async () => {
    const para = (s: string) => `<p>${s} — une phrase d’article assez longue pour peser dans le score de Readability, avec des virgules, des mots et encore des mots.</p>`;
    const cell = (s: string) => `<td><div class="rich-text-content">${para(s)}</div></td>`;
    fallbackOn(`<!doctype html><html><body><article><h1>Titre</h1>${para('INTRO')}${para('SUITE')}
      <table><tr>${cell('UN')}${cell('DEUX')}</tr><tr>${cell('TROIS')}${cell('QUATRE')}</tr></table>${para('FIN')}</article></body></html>`);
    const { content } = await extractFullContent('https://example.com/tableau-repli');
    const cells = new DOMParser().parseFromString(content, 'text/html').querySelectorAll('td');
    expect(Array.from(cells, (td) => td.querySelectorAll('p').length)).toEqual([1, 1, 1, 1]);
  });

  // B-01 (quatrième round) : un bloc invisible pour Readability n'est pas un corps.
  const story = Array.from({ length: 12 }, (_, i) => `<p>Paragraph ${i} of the real story, with enough words to look like genuine body text that Readability scores well and keeps.</p>`).join('');
  const paragraphs = (html: string) => (html.match(/Paragraph \d+/g) || []).length;

  it('garde le corps entier quand un bloc caché de même classe le précède', async () => {
    for (const [i, hide] of ['hidden', 'style="display:none"', 'style="visibility: hidden"', 'aria-hidden="true"'].entries()) {
      fallbackOn(`<!doctype html><html><head><title>T</title></head><body><article><h1>Title</h1>
        <div class="teaser" ${hide}><div class="article-body"><p>Short teaser shown in the app only.</p></div></div>
        <div class="full"><div class="article-body">${story}</div></div></article></body></html>`);
      expect(paragraphs((await extractFullContent(`https://example.com/cache-${i}`)).content), hide).toBe(12);
    }
  });

  it('ne double pas l’article quand un doublon caché du corps le suit', async () => {
    for (const [i, duplicate] of [`<noscript><div class="article-body">${story}</div></noscript>`, `<div class="dup" hidden><div class="article-body">${story}</div></div>`].entries()) {
      fallbackOn(`<!doctype html><html><head><title>T</title></head><body><article><h1>Title</h1>
        <div class="full"><div class="article-body">${story}</div></div>${duplicate}</article></body></html>`);
      expect(paragraphs((await extractFullContent(`https://example.com/doublon-${i}`)).content), duplicate.slice(0, 20)).toBe(12);
    }
  });
});

// ── Relecture du troisième round : mêmes cas que la route serveur ────
describe('extractFullContent — repli local : termes de billet et boutons d’icône', () => {
  const fallbackOn = (html: string) => vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
    if (String(input).startsWith('/api/extract')) return new Response('', { status: 404 });
    return htmlPage(html);
  }));
  const archives = (n: number) => `<div class="widget-area"><ul>${Array.from({ length: n }, (_, i) => `<li><a href="/2025/${i}">Billet ancien numéro ${i} sur un autre sujet sans rapport</a></li>`).join('')}</ul></div>`;

  it('garde un billet WordPress court étiqueté « pwa », « ads » ou « sponsored »', async () => {
    const nav = `<nav><ul>${Array.from({ length: 12 }, (_, i) => `<li><a href="/c${i}">Catégorie numéro ${i}</a></li>`).join('')}</ul></nav>`;
    for (const [i, terms] of ['category-web tag-pwa', 'category-ads tag-ios', 'category-web tag-sponsored'].entries()) {
      fallbackOn(`<!doctype html><html><head><title>t</title></head><body>${nav}<div id="page"><main id="main"><article class="post-42 post type-post hentry ${terms}"><h1>Les PWA</h1><div class="entry-content"><p>BILLET Apple ouvre enfin les notifications aux applications web installées sur l’écran d’accueil : un détail qui change la donne pour les petits éditeurs. Voir <a href="https://example.com/notes">les notes</a>.</p></div></article></main>${archives(30)}</div></body></html>`);
      expect((await extractFullContent(`https://example.com/pwa-${i}`)).content).toContain('BILLET');
    }
  });

  it('garde une lettre étiquetée « newsletter » qui intègre son formulaire, sans le formulaire', async () => {
    const body = Array.from({ length: 6 }, (_, i) => `<p>Paragraphe ${i} de la lettre de novembre : trois liens commentés sur la sobriété numérique, un outil libre pour mesurer le poids des pages, et une lecture longue.</p>`).join('');
    fallbackOn(`<!doctype html><html><body><main><article class="post-7 post hentry tag-newsletter"><h1>Lettre n° 12</h1><div class="entry-content newsletter-issue">${body}<div class="mc4wp-form newsletter-signup"><p>FORMULAIRE Recevoir la lettre :</p><input type="email"><button>OK</button></div></div></article></main>${archives(60)}</body></html>`);
    const content = (await extractFullContent('https://example.com/lettre-12')).content;
    expect(content).toContain('Paragraphe 5');
    expect(content).not.toContain('FORMULAIRE');
  });

  it('ne fait pas entrer les icônes des boutons (copier, carrousel) dans l’article', async () => {
    const p = Array.from({ length: 5 }, (_, i) => `<p>Paragraphe ${i} : explication détaillée du fonctionnement de la commande, avec ses options et un exemple complet à recopier.</p>`).join('');
    fallbackOn(`<!doctype html><html><body><article><h1>Titre</h1>${p}<div class="code-block"><button class="copy-button" aria-label="Copier"><img src="/static/icons/copy.svg" alt=""></button><pre><code>npm run build</code></pre></div><div class="gallery"><button class="prev"><img src="/static/icons/arrow-left.png"></button><img src="/img/photo1.jpg" alt="Photo"><button class="next"><img src="/static/icons/arrow-right.svg"></button></div>${p}</article></body></html>`);
    const content = (await extractFullContent('https://example.com/icones')).content;
    expect(content).toContain('photo1.jpg');
    for (const icon of ['copy.svg', 'arrow-left.png', 'arrow-right.svg']) expect(content).not.toContain(icon);
  });
});

// ── La jambe de repli doit être bornée elle aussi ────────────────────
// Le minuteur de la route serveur visait un backend qui accepte la connexion
// et ne répond jamais. Or cette panne-là frappe `/api/proxy` exactement de la
// même façon : ne minuter que la première jambe déplaçait le blocage d'une
// ligne au lieu de le supprimer, et la file séquentielle restait bloquée pour
// toujours.
describe('extractFullContent — délais des deux jambes', () => {
  it('abandonne aussi un repli muet, au lieu de bloquer la file pour toujours', async () => {
    vi.useFakeTimers();
    try {
      // Les deux routes acceptent puis se taisent : elles ne se règlent QUE
      // sur l'abandon. Sans minuteur sur la seconde, ce test expire.
      vi.stubGlobal('fetch', vi.fn((_input: RequestInfo, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })));

      const pending = extractFullContent('https://example.com/a');
      const settled = vi.fn();
      void pending.then(settled, settled);

      await vi.advanceTimersByTimeAsync(SERVER_EXTRACT_TIMEOUT_MS);
      expect(settled).not.toHaveBeenCalled();          // la jambe de repli court

      await vi.advanceTimersByTimeAsync(FALLBACK_EXTRACT_TIMEOUT_MS);
      expect(settled).toHaveBeenCalledTimes(1);
      await expect(pending).rejects.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Le plafond réel, celui que la doc annonce ──────────────────────
  // 40 s (20 + 20) est le pire cas SANS 429. Le vrai pire cas y ajoute
  // l'attente honorée après un 429 : 60 s de `Retry-After` au plafond, puis
  // une seconde jambe serveur qui va au bout de son budget sans rien rendre
  // d'exploitable, puis un repli muet. La doc a annoncé 40 s pour ce cas-là ;
  // ce test fixe le chiffre à mesurer plutôt qu'à estimer.
  it('plafonne un article à ~100 s, attente de cadence comprise', async () => {
    vi.useFakeTimers();
    try {
      let asked = 0;
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        if (String(input).startsWith('/api/extract')) {
          asked++;
          if (asked === 1) return new Response('', { status: 429, headers: { 'Retry-After': '60' } });
          // Juste sous l'abandon : la jambe consomme tout son budget puis rend
          // une réponse inexploitable — donc le repli s'engage encore.
          await new Promise((r) => setTimeout(r, SERVER_EXTRACT_TIMEOUT_MS - 1));
          return new Response('{}', { status: 200 });
        }
        return await new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }));

      const pending = extractFullContent('https://example.com/a');
      const settled = vi.fn();
      void pending.then(settled, settled);

      // 60 s d'attente + 19,999 s de seconde jambe + 20 s de repli : 99,999 s,
      // soit le plafond des ~100 s annoncés (le 1 ms manquant n'est que la
      // marge qui empêche la seconde jambe de courir son abandon).
      const total = RATE_LIMIT_MAX_WAIT_MS + (SERVER_EXTRACT_TIMEOUT_MS - 1) + FALLBACK_EXTRACT_TIMEOUT_MS;
      await vi.advanceTimersByTimeAsync(total - 1);
      expect(settled).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toHaveBeenCalledTimes(1);
      await expect(pending).rejects.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── 429 : attendre, pas perdre l'article ─────────────────────────────
// Le seau de cadence est partagé par `/api/extract`, `/api/proxy` et le
// préchargement d'images. Depuis que la route serveur répond à la vitesse de
// Redis, un balayage `prepareOffline` peut l'atteindre — et l'article
// disparaissait alors du jeu hors ligne sans un mot, `feedStore` avalant
// l'échec.
describe('extractFullContent — cadence dépassée', () => {
  const tooMany = (retryAfter: string) =>
    new Response('', { status: 429, headers: { 'Retry-After': retryAfter } });

  it('honore Retry-After puis réessaie', async () => {
    vi.useFakeTimers();
    try {
      let asked = 0;
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
        if (String(input).startsWith('/api/extract')) {
          asked++;
          return asked === 1 ? tooMany('30') : new Response(JSON.stringify(serverAnswer), { status: 200 });
        }
        throw new Error('pas de repli sur /api/proxy : c’est le même seau');
      }));

      const pending = extractFullContent('https://example.com/a');
      await vi.advanceTimersByTimeAsync(30_000);
      const out = await pending;

      expect(out.content).toContain('corps serveur');
      expect(asked).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ne se replie pas sur /api/proxy quand l’attente n’a pas suffi', async () => {
    vi.useFakeTimers();
    try {
      let proxied = 0;
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
        if (String(input).startsWith('/api/extract')) return tooMany('1');
        proxied++;
        return htmlPage(pageHtml);
      }));

      const pending = extractFullContent('https://example.com/a');
      const settled = vi.fn();
      void pending.then(settled, settled);
      await vi.advanceTimersByTimeAsync(1000);

      await expect(pending).rejects.toBeInstanceOf(RateLimitedError);
      expect(proxied).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // Le trou que ce test ferme : le refus du repli ne tenait qu'au fait que la
  // seconde tentative RENVOIE le marqueur. Qu'elle LÈVE — abandon au bout de
  // 20 s, panne réseau — et le `catch` du repli avalait l'échec, puis
  // `/api/proxy` recevait la requête : le même seau, déjà vide, donc un jeton
  // gaspillé pour un échec certain.
  it('ne se replie pas non plus quand la seconde tentative échoue', async () => {
    vi.useFakeTimers();
    try {
      let asked = 0;
      let proxied = 0;
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
        if (String(input).startsWith('/api/extract')) {
          asked++;
          if (asked === 1) return tooMany('1');
          throw new TypeError('Failed to fetch');
        }
        proxied++;
        return htmlPage(pageHtml);
      }));

      const pending = extractFullContent('https://example.com/a');
      const settled = vi.fn();
      void pending.then(settled, settled);
      await vi.advanceTimersByTimeAsync(1000);

      await expect(pending).rejects.toBeInstanceOf(RateLimitedError);
      expect(asked).toBe(2);
      expect(proxied).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // La borne de l'autre côté : une fois l'attente honorée, un échec qui n'est
  // PLUS un 429 rend la main au repli. Le seau a laissé passer la requête, donc
  // le navigateur peut de nouveau tenter sa chance.
  it('rend la main au repli quand la seconde réponse n’est plus un 429', async () => {
    vi.useFakeTimers();
    try {
      let asked = 0;
      let proxied = 0;
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
        if (String(input).startsWith('/api/extract')) {
          asked++;
          return asked === 1 ? tooMany('1') : new Response('', { status: 502 });
        }
        proxied++;
        return htmlPage(pageHtml);
      }));

      const pending = extractFullContent('https://example.com/a');
      await vi.advanceTimersByTimeAsync(1000);
      const out = await pending;

      expect(out.content).toContain('paragraphe');
      expect(asked).toBe(2);
      expect(proxied).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('retryAfterMs', () => {
  const headers = (v?: string) => new Headers(v == null ? {} : { 'Retry-After': v });

  it('lit les secondes émises par express-rate-limit', () => {
    expect(retryAfterMs(headers('42'))).toBe(42_000);
  });

  it('lit aussi la forme date HTTP', () => {
    const now = Date.parse('2026-09-04T10:00:00Z');
    expect(retryAfterMs(headers('Fri, 04 Sep 2026 10:00:20 GMT'), now)).toBe(20_000);
  });

  it('rend null sans en-tête', () => {
    expect(retryAfterMs(headers())).toBeNull();
  });

  // Tronquer une attente trop longue, c'est retomber sur un 429 : mieux vaut
  // refuser l'attente que la raccourcir.
  it('refuse une attente au-delà du plafond plutôt que de la tronquer', () => {
    expect(retryAfterMs(headers(String(RATE_LIMIT_MAX_WAIT_MS / 1000 + 1)))).toBeNull();
  });

  it('ramène une date déjà passée à zéro', () => {
    const now = Date.parse('2026-09-04T10:00:00Z');
    expect(retryAfterMs(headers('Fri, 04 Sep 2026 09:59:00 GMT'), now)).toBe(0);
  });
});

// ── Le repli ne lit qu'une page, et bornée ───────────────────────────
// Un article dont l'adresse est une vidéo `.mp4` : le serveur répondait 415,
// le client se repliait et lisait la vidéo ENTIÈRE par `/api/proxy` en texte.
// Sur Android, l'onglet grossissait jusqu'à être tué, au même article à
// chaque préparation hors ligne.
describe('extractFullContent — le repli ne lit qu’une page bornée', () => {
  /** Un corps sans fin, qui compte ce qu'on lui a tiré. */
  function endless(type: string) {
    const pulled = { bytes: 0 };
    const chunk = new Uint8Array(64 * 1024).fill(0x61);
    const body = new ReadableStream<Uint8Array>({
      pull(c) { pulled.bytes += chunk.length; c.enqueue(chunk); },
    });
    return { pulled, response: new Response(body, { status: 200, headers: { 'Content-Type': type } }) };
  }

  it('ne se replie pas quand le serveur dit que ce n’est pas une page (415)', async () => {
    const proxy = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      if (String(input).startsWith('/api/extract')) return new Response('', { status: 415 });
      proxy();
      return htmlPage(pageHtml);
    }));
    await expect(extractFullContent('https://example.com/video.mp4')).rejects.toThrow();
    expect(proxy).not.toHaveBeenCalled();
  });

  it('ne se replie pas sur une page trop grosse (413) : le repli échouerait aussi', async () => {
    const proxy = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      if (String(input).startsWith('/api/extract')) return new Response('', { status: 413 });
      proxy();
      return htmlPage(pageHtml);
    }));
    await expect(extractFullContent('https://example.com/enorme')).rejects.toThrow();
    expect(proxy).not.toHaveBeenCalled();
  });

  it('refuse un repli qui n’est pas du HTML sans en lire le corps', async () => {
    const { pulled, response } = endless('video/mp4');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      if (String(input).startsWith('/api/extract')) return new Response('', { status: 404 });
      return response;
    }));
    await expect(extractFullContent('https://example.com/video.mp4')).rejects.toThrow();
    expect(pulled.bytes).toBeLessThan(FALLBACK_MAX_HTML_BYTES);
  });

  it('coupe une page sans fin au plafond', async () => {
    const { pulled, response } = endless('text/html');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      if (String(input).startsWith('/api/extract')) return new Response('', { status: 502 });
      return response;
    }));
    await expect(extractFullContent('https://example.com/flux')).rejects.toThrow();
    expect(pulled.bytes).toBeLessThanOrEqual(FALLBACK_MAX_HTML_BYTES + 3 * 64 * 1024);
  });
});

// Chrome retient tout document analysé qui contient une <video> ou une
// <picture><source media> (voir `parsedDocument.ts`) : le repli vide le sien.
describe('extractFullContent — le repli vide son document', () => {
  it('vide le document de DOMParser une fois Readability passé', async () => {
    const seen: Document[] = [];
    const parse = DOMParser.prototype.parseFromString;
    vi.spyOn(DOMParser.prototype, 'parseFromString').mockImplementation(function (this: DOMParser, ...a: Parameters<typeof parse>) {
      const d = parse.apply(this, a);
      seen.push(d);
      return d;
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      if (String(input).startsWith('/api/extract')) return new Response('', { status: 404 });
      return htmlPage(pageHtml.replace('</article>', '<video src="https://example.com/v.mp4"></video></article>'));
    }));
    const out = await extractFullContent('https://example.com/a');
    expect(out.content).toContain('paragraphe');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((d) => d.documentElement === null)).toBe(true);
  });
});

// ── L-03 : une extraction impossible n'est pas redemandée sans fin ───────
// Micode (YouTube) : 27 `/api/extract` en 422 en 25 s pour 16 URL, chacun
// suivi d'un repli `/api/proxy` (~385 Ko) — 10 Mo pour une ouverture. Aucune
// mémoire des échecs, une URL YouTube envoyée à l'extraction, et un repli
// tenté même quand le site avait déjà refusé la page au serveur.
describe('extractFullContent — mémoire des échecs (L-03)', () => {
  it('n’envoie jamais une URL YouTube à l’extraction', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(extractFullContent('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).rejects.toBeInstanceOf(NotExtractableError);
    await expect(extractFullContent('https://youtu.be/dQw4w9WgXcQ', { retry: true })).rejects.toBeInstanceOf(NotExtractableError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ne redemande pas, pendant la session, une page dont l’extraction a échoué', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo) => {
      if (String(input).startsWith('/api/extract')) return new Response('', { status: 422 });
      return htmlPage('<html><body></body></html>');
    });
    vi.stubGlobal('fetch', fetchSpy);
    await expect(extractFullContent('https://example.com/vide')).rejects.toThrow();
    const calls = fetchSpy.mock.calls.length;
    await expect(extractFullContent('https://example.com/vide')).rejects.toBeInstanceOf(NotExtractableError);
    expect(fetchSpy.mock.calls.length).toBe(calls);
  });

  it('la demande du lecteur (retry) réessaie quand même, et un succès efface l’échec', async () => {
    let fail = true;
    const fetchSpy = vi.fn(async (input: RequestInfo) => {
      if (String(input).startsWith('/api/extract')) {
        return fail ? new Response('', { status: 415 }) : new Response(JSON.stringify(serverAnswer), { status: 200 });
      }
      throw new Error('pas de repli attendu');
    });
    vi.stubGlobal('fetch', fetchSpy);
    await expect(extractFullContent('https://example.com/revient')).rejects.toThrow();
    fail = false;
    const out = await extractFullContent('https://example.com/revient', { retry: true });
    expect(out.content).toContain('corps serveur');
    // Et l'automatique y a de nouveau droit.
    await expect(extractFullContent('https://example.com/revient')).resolves.toBeTruthy();
  });

  it('ne retient pas une cadence dépassée : elle n’est pas un défaut de la page', async () => {
    const fetchSpy = vi.fn(async () => new Response('', { status: 429 }));
    vi.stubGlobal('fetch', fetchSpy);
    await expect(extractFullContent('https://example.com/cadence')).rejects.toBeInstanceOf(RateLimitedError);
    const calls = fetchSpy.mock.calls.length;
    await expect(extractFullContent('https://example.com/cadence')).rejects.toBeInstanceOf(RateLimitedError);
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(calls);
  });

  it('ne retient pas un refus passager du site (503, 429, 408)', async () => {
    for (const upstreamStatus of [503, 429, 408]) {
      const url = `https://example.com/passager-${upstreamStatus}`;
      const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ error: 'Upstream request failed', upstreamStatus }), { status: 502 }));
      vi.stubGlobal('fetch', fetchSpy);
      await expect(extractFullContent(url)).rejects.toBeInstanceOf(UpstreamRefusedError);
      const calls = fetchSpy.mock.calls.length;
      await expect(extractFullContent(url)).rejects.toBeInstanceOf(UpstreamRefusedError);
      expect(fetchSpy.mock.calls.length).toBeGreaterThan(calls);
    }
  });

  it('retient un refus propre à la page (404 du site)', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ error: 'Upstream request failed', upstreamStatus: 404 }), { status: 502 }));
    vi.stubGlobal('fetch', fetchSpy);
    await expect(extractFullContent('https://example.com/disparue')).rejects.toBeInstanceOf(UpstreamRefusedError);
    await expect(extractFullContent('https://example.com/disparue')).rejects.toBeInstanceOf(NotExtractableError);
  });

  it('ne retient pas la session FriRSS expirée (401 de /api/extract puis de /api/proxy)', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ error: 'Session expired' }), { status: 401 }));
    vi.stubGlobal('fetch', fetchSpy);
    await expect(extractFullContent('https://example.com/session')).rejects.toThrow();
    const calls = fetchSpy.mock.calls.length;
    await expect(extractFullContent('https://example.com/session')).rejects.toThrow();
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(calls);
  });

  it('ne retient pas une panne réseau', async () => {
    const fetchSpy = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', fetchSpy);
    await expect(extractFullContent('https://example.com/reseau')).rejects.toThrow();
    const calls = fetchSpy.mock.calls.length;
    await expect(extractFullContent('https://example.com/reseau')).rejects.toThrow(TypeError);
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(calls);
  });

  it('deux demandes simultanées de la même page partagent une requête', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(serverAnswer), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const [a, b] = await Promise.all([
      extractFullContent('https://example.com/partage'),
      extractFullContent('https://example.com/partage'),
    ]);
    expect(a.content).toBe(b.content);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('ne se replie pas sur /api/proxy quand le site a refusé la page au serveur', async () => {
    const proxy = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      if (String(input).startsWith('/api/extract')) {
        return new Response(JSON.stringify({ error: 'Upstream request failed', upstreamStatus: 403 }), { status: 502 });
      }
      proxy();
      return htmlPage(pageHtml);
    }));
    await expect(extractFullContent('https://example.com/refus')).rejects.toBeInstanceOf(UpstreamRefusedError);
    expect(proxy).not.toHaveBeenCalled();
  });

  it('se replie toujours sur un 502 sans statut d’amont (site injoignable)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      if (String(input).startsWith('/api/extract')) return new Response(JSON.stringify({ error: 'Upstream request failed' }), { status: 502 });
      return htmlPage(pageHtml);
    }));
    const out = await extractFullContent('https://example.com/injoignable');
    expect(out.content).toContain('paragraphe');
  });

  // M-01 : le serveur a refusé la page pour sa complexité (imbrication,
  // nombre d'éléments, délai de son worker). Échec DÉFINITIF : le repli
  // relirait la même page piégée dans l'onglet, et l'extraction automatique
  // ne doit plus la redemander de la session.
  it('ne se replie pas sur une page refusée pour sa complexité, et la retient pour la session', async () => {
    const proxy = vi.fn();
    const fetchSpy = vi.fn(async (input: RequestInfo) => {
      if (String(input).startsWith('/api/extract')) {
        return new Response(JSON.stringify({ error: 'Page too complex', tooComplex: true }), { status: 422 });
      }
      proxy();
      return htmlPage(pageHtml);
    });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(extractFullContent('https://example.com/piege')).rejects.toBeInstanceOf(PageTooComplexError);
    expect(proxy).not.toHaveBeenCalled();

    // Retenue : l'automatique ne la redemande pas.
    await expect(extractFullContent('https://example.com/piege')).rejects.toBeInstanceOf(NotExtractableError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // Relecture 1.9.0 (R1-4) : le délai du worker du serveur était un
  // `tooComplex`, donc une page ordinaire analysée sur un serveur chargé
  // était perdue pour la session. Un délai est un échec ordinaire (on peut
  // réessayer), mais toujours sans repli : l'onglet paierait la même analyse.
  it('ne retient pas un délai d’analyse du serveur, et ne se replie pas pour autant', async () => {
    const proxy = vi.fn();
    const fetchSpy = vi.fn(async (input: RequestInfo) => {
      if (String(input).startsWith('/api/extract')) {
        return new Response(JSON.stringify({ error: 'Extraction timed out', timedOut: true }), { status: 504 });
      }
      proxy();
      return htmlPage(pageHtml);
    });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(extractFullContent('https://example.com/lente')).rejects.toBeInstanceOf(ExtractTimeoutError);
    expect(proxy).not.toHaveBeenCalled();

    // Pas retenue : l'automatique la redemande.
    await expect(extractFullContent('https://example.com/lente')).rejects.toBeInstanceOf(ExtractTimeoutError);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  // N-2 (vérification 1.9.0) : file d'analyse du serveur pleine. Le repli
  // refaisait dans l'onglet l'analyse que le serveur refusait, sans borne de
  // durée : 14 s de gel sur une page lente. Un échec passager — pas retenu,
  // « Réessayer » possible —, mais sans repli.
  it('ne se replie pas quand l’extracteur du serveur est occupé (503), et ne le retient pas', async () => {
    const proxy = vi.fn();
    const fetchSpy = vi.fn(async (input: RequestInfo) => {
      if (String(input).startsWith('/api/extract')) {
        return new Response(JSON.stringify({ error: 'Extractor busy', busy: true }), { status: 503 });
      }
      proxy();
      return htmlPage(pageHtml);
    });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(extractFullContent('https://example.com/occupe')).rejects.toBeInstanceOf(ExtractorBusyError);
    expect(proxy).not.toHaveBeenCalled();

    // Pas retenue : l'automatique la redemande.
    await expect(extractFullContent('https://example.com/occupe')).rejects.toBeInstanceOf(ExtractorBusyError);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  // Le worker d'analyse du serveur est mort sans répondre (« extract worker
  // exited ») : rendu en 502 nu, il renvoyait l'onglet sur son propre
  // extracteur, qui refaisait l'analyse sans borne de durée. Passager, comme
  // une file pleine : pas de repli, pas de mémoire d'échec, « Réessayer »
  // possible.
  it('ne se replie pas quand le worker du serveur a planté (502 `crashed`), et ne le retient pas', async () => {
    const proxy = vi.fn();
    const fetchSpy = vi.fn(async (input: RequestInfo) => {
      if (String(input).startsWith('/api/extract')) {
        return new Response(JSON.stringify({ error: 'Extractor crashed', crashed: true }), { status: 502 });
      }
      proxy();
      return htmlPage(pageHtml);
    });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(extractFullContent('https://example.com/plante')).rejects.toBeInstanceOf(ExtractorCrashedError);
    expect(proxy).not.toHaveBeenCalled();

    // Pas retenue : l'automatique la redemande.
    await expect(extractFullContent('https://example.com/plante')).rejects.toBeInstanceOf(ExtractorCrashedError);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  // N-2 : le serveur a eu le même HTML et n'y a rien trouvé de lisible ; le
  // repli refaisait l'analyse dans l'onglet, aussi longue fût-elle.
  it('ne se replie pas sur une page que le serveur n’a pas su lire (422), et la retient pour la session', async () => {
    const proxy = vi.fn();
    const fetchSpy = vi.fn(async (input: RequestInfo) => {
      if (String(input).startsWith('/api/extract')) {
        return new Response(JSON.stringify({ error: 'Not extractable' }), { status: 422 });
      }
      proxy();
      return htmlPage(pageHtml);
    });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(extractFullContent('https://example.com/illisible')).rejects.toThrow();
    expect(proxy).not.toHaveBeenCalled();
    await expect(extractFullContent('https://example.com/illisible')).rejects.toBeInstanceOf(NotExtractableError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // Le serveur n'a pas essayé : son résolveur n'a pas répondu (`finishError`).
  it('se replie toujours sur un 503 qui ne dit pas l’extracteur occupé', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      if (String(input).startsWith('/api/extract')) return new Response(JSON.stringify({ error: 'Target host unresolved' }), { status: 503 });
      return htmlPage(pageHtml);
    }));
    const out = await extractFullContent('https://example.com/resolveur');
    expect(out.content).toContain('paragraphe');
  });

  it('se replie toujours sur un 504 ordinaire (site trop lent pour le serveur)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      if (String(input).startsWith('/api/extract')) return new Response(JSON.stringify({ error: 'Upstream timeout' }), { status: 504 });
      return htmlPage(pageHtml);
    }));
    const out = await extractFullContent('https://example.com/site-lent');
    expect(out.content).toContain('paragraphe');
  });
});
