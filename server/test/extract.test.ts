import { describe, it, expect } from 'vitest';
import { parseHTML } from 'linkedom';
import {
  extractArticle, EXTRACT_MAX_PENDING, ExtractorBusyError, extractPending, joinSplitBody, resolveLazyImages, stripBoilerplate, withExtractSlot,
} from '../extract.js';
import { advisoryPageHtml, ADVISORY_BODY_MARKER } from '../../src/test/advisoryPageFixture.js';
import { INLINE_IMAGE, LAZY_IMAGES, lazyImagePageHtml } from '../../src/test/lazyImagePageFixture.js';
import { blogPageHtml, BLOG_BODY_MARKER, newsPageHtml, pressPageHtml, shortPostPageHtml } from '../../src/test/boilerplatePageFixtures.js';
import { splitBodyAcrossImagesPageHtml, splitBodyPageHtml, splitBodyWithBioPageHtml } from '../../src/test/splitBodyPageFixtures.js';

const page = `<!doctype html><html><head><title>Titre de la page</title></head>
<body><article><h1>Un vrai titre</h1>
<p>Un premier paragraphe suffisamment long pour que Readability le retienne comme corps de l'article, avec assez de mots pour dépasser son seuil.</p>
<p>Un second paragraphe, lui aussi assez fourni pour peser dans la balance du score de lisibilité calculé par Readability.</p>
</article></body></html>`;

describe('extractArticle', () => {
  it('rend le corps de l’article', () => {
    const out = extractArticle('https://example.com/a', page);
    expect(out).not.toBeNull();
    expect(out!.content).toContain('premier paragraphe');
    // Readability garde le <title> de la page quand le <h1> ne partage aucun
    // mot avec lui — c'est son comportement, pas un défaut. On l'assert tel
    // quel plutôt qu'approximativement : un changement de règle en amont doit
    // se voir.
    expect(out!.title).toBe('Titre de la page');
  });

  it('N’assainit PAS — c’est le client qui le fait', () => {
    // Décision du 2026-09-04. `createDOMPurify` sur la fenêtre de `linkedom`
    // ne filtre rien (il manque `NodeFilter`, DOMPurify passe en mode
    // « environnement non supporté » et rend l'entrée telle quelle, sans
    // erreur). Assainir ici aurait donné un filet auquel on croit et qui ne
    // retient rien. Le client applique `sanitizeExtracted()` à la réception,
    // comme il le fait déjà pour sa propre extraction.
    //
    // La sonde doit être un attribut que DOMPurify RETIRE : une version
    // antérieure cherchait un `<p>zzz</p>`, qui survit aussi bien à un
    // assainissement — le test passait donc au vert contre une implémentation
    // assainissante, et ne gardait rien. `onclick`/`onerror` ne survivent que
    // sur le chemin non assaini.
    const evil = page
      .replace('<p>Un premier', '<p onclick="alert(1)">Un premier')
      .replace('</article>', '<img src="/img/a.jpg" onerror="alert(2)"></article>');
    const out = extractArticle('https://example.com/a', evil);
    expect(out!.content).toContain('onclick="alert(1)"');
    expect(out!.content).toContain('onerror="alert(2)"');
  });

  it('résout les URL relatives contre l’URL de l’article', () => {
    // Sans <base>, une image en chemin relatif serait irrécupérable pour le
    // navigateur, qui reçoit le HTML sans savoir d'où il vient.
    const withImg = page.replace('</article>', '<img src="/img/a.jpg"></article>');
    const out = extractArticle('https://example.com/dir/a', withImg);
    expect(out!.content).toContain('https://example.com/img/a.jpg');
  });

  // L-04 (CERT-FR, nouvelle mise en page) : le corps vit dans un bloc que la
  // première passe de Readability écarte (« candidat improbable »), et il ne
  // reste qu'une courte section. Au seuil de 50 caractères, ce reste suffisait
  // et l'« article complet » se réduisait à « Solutions » (135 caractères au
  // lieu de 2 800). Au seuil par défaut (500), Readability refait une passe
  // sans écarter, et garde la plus longue.
  it('ne se contente pas d’une courte section quand le corps est ailleurs', () => {
    const body = Array.from({ length: 12 }, (_, i) => `<p>Paragraphe ${i} du bulletin, qui décrit la vulnérabilité, les systèmes affectés et le risque encouru, longuement.</p>`).join('');
    const html = `<!doctype html><html><head><title>Avis</title></head><body>
      <div class="sidebar-layout">${body}</div>
      <section><h2>Solutions</h2><p>Se référer au bulletin de sécurité de l’éditeur pour l’obtention des correctifs.</p></section>
    </body></html>`;
    const out = extractArticle('https://example.com/avis', html);
    expect(out!.content).toContain('Paragraphe 11 du bulletin');
  });

  // A-1 (campagne 1.9.0) : même mise en page CERT-FR, autre échec. Readability
  // retient la première `<section>` de l'`<article>` (le tableau de
  // métadonnées) et écarte la deuxième, qui porte le corps, à cause de sa
  // longue liste de références en liens. Le fragment dépasse 500 caractères :
  // le seuil (L-04) ne le rattrape pas. Structure reproduite, texte inventé.
  it('ne garde pas un fragment quand le conteneur principal de la page est bien plus long', () => {
    const out = extractArticle('https://example.com/avis', advisoryPageHtml());
    expect(out!.content).toContain(ADVISORY_BODY_MARKER);
    expect(out!.content).toContain('Gestion du document');
    expect(out!.content).toContain('EX-2026-1008');
    // Le conteneur, pas la page : ni la navigation ni le pied.
    expect(out!.content).not.toContain('mentions légales');
    expect(out!.content).not.toContain('Accueil');
    // Les métadonnées de la passe normale sont gardées.
    expect(out!.title).toBe('Avis d’exemple');
  });

  // N-1 (vérification 1.9.0) : sur Numerama, l'`<article>` porte bien plus
  // que le corps (en-tête, résumé, barre latérale, pied, scripts) : la
  // première passe a déjà tout l'article mais n'en garde que 37 %, la seconde
  // se déclenche et sa tolérance de liens réadmet un encart produit et une
  // ligne promotionnelle. Elle rendait 4 % de texte en plus — que cela.
  it('n’adopte pas une seconde passe qui ne rend guère plus de texte (structure Numerama)', () => {
    const html = pressPageHtml();
    const { document } = parseHTML(html);
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const promo = norm((document.querySelector('.promotional-quote-separator + [data-nosnippet] p') as Element).textContent);
    const product = norm((document.querySelector('.product-block') as Element).textContent);
    const paragraphs = Array.from(document.querySelectorAll('.article-content > p'), (p) => norm((p as Element).textContent));

    const out = extractArticle('https://example.com/presse', html);
    const text = norm(parseHTML(`<html><body>${out!.content}</body></html>`).document.body.textContent);

    expect(text).toContain(paragraphs[0]);
    expect(text).toContain(paragraphs[paragraphs.length - 1]);
    expect(text).not.toContain(promo);
    expect(text).not.toContain(product.slice(0, 40));
  });

  it('laisse intact un article que Readability a déjà bien extrait', () => {
    // Le conteneur unique contient le corps ; rien à reprendre.
    const out = extractArticle('https://example.com/a', page);
    expect(out!.content).toContain('second paragraphe');
  });

  it('rend null quand la page n’a pas d’article lisible', () => {
    const out = extractArticle('https://example.com/a', '<html><body></body></html>');
    expect(out).toBeNull();
  });

  // C-03 (quatrième round) : linkedom ne construit pas `<html>`, `<head>` et
  // `<body>` comme un navigateur. Une page sans élément levait une TypeError
  // dès l'insertion du `<base>` ; une page dont le contenu n'est pas sous un
  // `<body>`, une TypeError dans Readability, qui remonte jusqu'à lui. Le
  // client recevait un 502 « Upstream request failed » et se repliait.
  const story = `<p>${'Une phrase d’article assez longue pour peser dans le score de Readability. '.repeat(12)}</p>`;

  it('rend null, sans lever, quand la page n’a aucun élément (vide, texte seul, commentaire)', () => {
    for (const html of ['', 'hello', '   \n', '<!-- rien -->', '<!doctype html>']) {
      expect(extractArticle('https://example.com/a', html), JSON.stringify(html)).toBeNull();
    }
  });

  it('lit une page dont le contenu n’est pas sous `<body>` comme un navigateur (SVG seul, fragment, contenu après `</html>`)', () => {
    const pages = {
      svg: `<svg><foreignObject>${story}</foreignObject></svg>`,
      fragment: `<div><div><div>${story}</div></div></div>`,
      table: `<table><tr><td>${story}</td></tr></table>`,
      afterHtml: `<html><head><title>T</title></head><body><p>court</p></body></html><div><section>${story}</section></div>`,
      noBodyTag: `<!doctype html><html><head><title>T</title></head><div><section>${story}</section></div></html>`,
    };
    for (const [name, html] of Object.entries(pages)) {
      let out: ReturnType<typeof extractArticle> = null;
      expect(() => { out = extractArticle('https://example.com/a', html); }, name).not.toThrow();
      expect(out!.content, name).toContain('Une phrase d’article');
    }
  });

  it('garde le titre d’une page aux balises facultatives omises (`<html>`, `<head>`, `<body>`)', () => {
    const out = extractArticle('https://example.com/a', `<!doctype html><title>Titre omis</title><meta charset="utf-8"><div><section>${story}</section></div>`);
    expect(out!.content).toContain('Une phrase d’article');
    expect(out!.title).toBe('Titre omis');
  });
});

// ── A1 (campagne 1.9.0, troisième round) : images paresseuses ────────
// Numerama : l'`<img>` porte un cadre blanc (`data:image/svg+xml` non base64)
// et sa vraie adresse dans `data-src` / `data-srcset`, dans une `<picture>` —
// Readability ne la résout pas, et le client retire ensuite les attributs
// `data-*`. Zoomit : chaque image vit dans un `<button>` d'agrandissement, que
// Readability retire avec elle.
describe('extractArticle — images paresseuses (A1)', () => {
  const imgs = (html: string) => Array.from(parseHTML(`<html><body>${html}</body></html>`).document.querySelectorAll('img'), (img) => (img as Element).getAttribute('src') || '');

  it('rend l’adresse réelle d’une image paresseuse, pas son cadre blanc', () => {
    const out = extractArticle('https://example.com/usine', lazyImagePageHtml());
    const sources = imgs(out!.content);
    expect(sources).toContain(LAZY_IMAGES.picture);
    expect(sources.filter((src) => src.startsWith('data:image/svg'))).toEqual([]);
    expect(out!.content).toContain(LAZY_IMAGES.pictureSet);
    expect(out!.content).toContain(LAZY_IMAGES.webpSet);
  });

  it('garde l’image que seul son `noscript` porte', () => {
    expect(imgs(extractArticle('https://example.com/usine', lazyImagePageHtml())!.content)).toContain(LAZY_IMAGES.noscriptOnly);
  });

  it('garde une image enveloppée dans un bouton d’agrandissement', () => {
    const out = extractArticle('https://example.com/usine', lazyImagePageHtml());
    expect(imgs(out!.content)).toContain(LAZY_IMAGES.zoomed);
    expect(out!.content).not.toContain('<button');
  });

  it('ne touche pas une vraie image en ligne', () => {
    expect(imgs(extractArticle('https://example.com/usine', lazyImagePageHtml())!.content)).toContain(INLINE_IMAGE);
  });
});

describe('resolveLazyImages', () => {
  const resolve = (body: string) => {
    const { document } = parseHTML(`<html><body>${body}</body></html>`);
    resolveLazyImages(document.documentElement as unknown as Element);
    return document.body.innerHTML;
  };

  it('ne remplace pas une adresse réelle par celle de data-src', () => {
    expect(resolve('<img src="https://example.com/a.jpg" data-src="https://example.com/b.jpg">')).toContain('src="https://example.com/a.jpg"');
  });

  it('n’adopte pas une adresse data-src qui n’est pas web', () => {
    expect(resolve('<img src="data:image/svg+xml;utf8,x" data-src="javascript:alert(1)">')).toContain('src="data:image/svg+xml;utf8,x"');
  });

  it('laisse un bouton qui porte du texte', () => {
    expect(resolve('<button><img src="https://example.com/a.jpg"> Agrandir</button>')).toContain('<button');
  });

  // Relecture du troisième round : tout bouton à image unique était déballé,
  // et les icônes (copier, flèches de carrousel) entraient dans l'article.
  it('laisse les boutons d’icône : copier, flèches de carrousel, image déclarée petite', () => {
    const html = resolve(`<button class="copy-button" aria-label="Copier"><img src="/static/icons/copy.svg" alt=""></button>
      <button class="prev"><img src="/static/icons/arrow-left.svg"></button>
      <button aria-label="Agrandir l’image"><img src="/static/icons/zoom.png" width="24" height="24"></button>
      <button class="next"><img src="/static/icons/arrow-right.png"></button>`);
    expect(html.match(/<button/g)).toHaveLength(4);
  });

  it('déballe un bouton d’agrandissement, quelle que soit la langue de son libellé', () => {
    const html = resolve(`<button aria-label="بزرگ‌نمایی تصویر: خودرو سفید" class="cursor-pointer"><img alt="خودرو سفید" width="1300" height="832" src="https://example.com/car.jpg"></button>
      <button class="lightbox-trigger"><img src="https://example.com/b.jpg"></button>`);
    expect(html).not.toContain('<button');
  });
});

// ── M-04 (campagne 1.9.0, second round) : blocs étrangers ────────────
// La seconde passe (A-1) ramassait dans le conteneur principal de The Verge
// les mentions légales du formulaire de lettre d'information ; sur un billet
// court de Schneier, la première passe (seuil 500, L-04) ramassait fil
// d'Ariane, « Comments » et « Powered by WordPress ». Ces blocs sont retirés
// du document avant toute passe (`stripBoilerplate`).
describe('extractArticle — blocs étrangers (M-04)', () => {
  const textOf = (html: string) => (parseHTML(`<html><body>${html}</body></html>`).document.body.textContent || '').replace(/\s+/g, ' ').trim();

  it('ne ramasse pas les mentions légales de la lettre d’information du rail (structure The Verge)', () => {
    const html = newsPageHtml();
    const { document } = parseHTML(html);
    const legal = textOf((document.querySelector('.duet--layout--rail form') as Element).innerHTML);
    const firstParagraph = textOf((document.querySelector('.duet--article--article-body-component p') as Element).innerHTML);

    const out = extractArticle('https://example.com/news', html);

    expect(textOf(out!.content)).toContain(firstParagraph);
    expect(textOf(out!.content)).not.toContain(legal.slice(-80));
    // Le chapeau garde son image : retirer les fenêtres « Suivre » (des
    // `<aside>` DANS l'article) faisait perdre l'image d'en-tête.
    expect(out!.content.match(/<img/g)?.length).toBe(3);
  });

  it('ne ramasse ni fil d’Ariane, ni commentaires, ni crédits d’un billet court (structure Schneier)', () => {
    const out = extractArticle('https://example.com/blog', blogPageHtml());
    const text = textOf(out!.content);
    expect(text).toContain(BLOG_BODY_MARKER);
    expect(text).toContain('monde nouveau');
    for (const junk of ['Accueil', 'Commentaires', 'Powered by', 'S’abonner aux commentaires', 'Laisser un commentaire', 'Billet précédent']) {
      expect(text).not.toContain(junk);
    }
  });

  // A2 (campagne 1.9.0, troisième round) : sous le seuil de 500, Readability
  // rendait la passe la plus longue — la colonne voisine du billet.
  it('rend le texte d’un billet très court, pas la colonne voisine (structure Simon Willison)', () => {
    const html = shortPostPageHtml();
    const { document } = parseHTML(html);
    const post = textOf((document.querySelector('.beat-note p') as Element).innerHTML);
    const column = textOf((document.querySelector('#secondary .this-is') as Element).innerHTML);
    const text = textOf(extractArticle('https://example.com/billet', html)!.content);
    expect(text).toContain(post);
    expect(text).not.toContain(column);
  });

  // Readability lit l'auteur dans le document AVANT d'écarter lui-même
  // `footer` et `aside` du corps : retirer ce bloc plus tôt effaçait l'auteur.
  it('garde l’auteur rangé dans le pied de l’article', () => {
    const html = page.replace('</article>',
      '<footer class="entry-meta"><span class="byline">par <a rel="author" href="/auteur/je">Jeanne Exemple</a></span></footer></article>');
    expect(extractArticle('https://example.com/a', html)!.byline).toContain('Jeanne Exemple');
  });
});

describe('stripBoilerplate', () => {
  const strip = (body: string) => {
    const { document } = parseHTML(`<html><body>${body}</body></html>`);
    stripBoilerplate(document.documentElement as unknown as Element);
    return (document.body.textContent || '').replace(/\s+/g, ' ').trim();
  };
  const long = 'Un paragraphe d’article assez long pour peser bien plus que tout le reste de la page réunie, et même davantage encore.';

  it('retire un bloc « Related » glissé au milieu du texte', () => {
    expect(strip(`<article><p>${long}</p><div class="duet--article--related"><h3>Related</h3><ul><li><a href="/x">Un autre article</a></li></ul></div><p>${long}</p></article>`))
      .not.toContain('Un autre article');
  });

  it('retire pied, navigation, formulaire, barre latérale de page et crédit « Powered by »', () => {
    const text = strip(`<nav>Menu</nav><aside>Barre latérale</aside><div role="contentinfo">Pied de rôle</div><article><p>${long}</p><p>${long}</p><footer>Pied d’article</footer><form>Lettre d’information</form></article><p>Powered by Exemple</p>`);
    for (const junk of ['Menu', 'Barre latérale', 'Pied de rôle', 'Pied d’article', 'Lettre d’information', 'Powered by']) expect(text).not.toContain(junk);
  });

  it('garde un titre dont l’id contient un mot visé, et un aside dans l’article', () => {
    const text = strip(`<article><h2 id="related-work">Travaux voisins</h2><p>${long}</p><aside>Une incise de l’article</aside><p>${long}</p></article>`);
    expect(text).toContain('Travaux voisins');
    expect(text).toContain('Une incise de l’article');
  });

  // Relecture 1.9.0 (R1-2) : `share` et `newsletter` retiraient tout bloc dont
  // la classe contenait le mot — un tableau de parts de marché, une analyse
  // de « share of voice » — que Readability gardait. Il n'écarte lui-même un
  // bloc « share » que s'il est court (moins de 500 caractères).
  it('garde un tableau de parts de marché et une analyse dont la classe contient « share » ou « newsletter »', () => {
    const rows = Array.from({ length: 15 }, (_, i) => `<tr><td>Company number ${i} shareholders</td><td>${(i * 3.1).toFixed(1)} percent of the market</td></tr>`).join('');
    const analysis = 'SHAREDIV analysis paragraph that is a genuine part of the article body. '.repeat(12);
    const issue = 'NEWSLETTERISSUE this week we look back at what happened in the market. '.repeat(10);
    const text = strip(`<article><p>${long}</p><table class="share-table">${rows}</table><div class="share-of-voice-analysis"><p>${analysis}</p></div><section class="newsletter-issue"><p>${issue}</p></section><p>${long}</p><p>${long}</p><p>${long}</p><p>${long}</p></article>`);
    expect(text).toContain('Company number 7 shareholders');
    expect(text).toContain('SHAREDIV');
    expect(text).toContain('NEWSLETTERISSUE');
  });

  it('retire toujours les boutons de partage et l’encart d’abonnement, qui sont courts', () => {
    const text = strip(`<article><p>${long}</p><div class="share-buttons"><a href="/x">Partager sur Mastodon</a><a href="/y">Copier le lien</a></div><div class="post-newsletter"><p>Inscrivez-vous à notre lettre</p></div><p>${long}</p></article>`);
    expect(text).not.toContain('Partager sur Mastodon');
    expect(text).not.toContain('Inscrivez-vous');
  });

  it('ne retire jamais un bloc qui porte la moitié du texte, quel que soit son nom', () => {
    // Une page ASP.NET enveloppe tout dans un `<form>`.
    expect(strip(`<form id="aspnetForm"><p>${long}</p><p>${long}</p></form><nav>Menu</nav>`)).toContain(long);
  });

  // A3 (campagne 1.9.0, troisième round) : familles relevées sur les pages
  // réelles, structures reproduites, textes inventés.
  const body = Array.from({ length: 10 }, () => `<p>${long}</p>`).join('');

  it('retire publicité, mention d’affiliation, avertissement et invitation à installer l’application, qui sont courts', () => {
    // The Register (`div.google-ad` > `span.ad-label`), TechCrunch
    // (`p.affiliate-disclaimer-text`), 01net (`div.comp-disclaimer`), Numerama
    // (`div.card-install-pwa`).
    const text = strip(`<article>${body}<div class="column google-ad small-12"><span class="ad-label">PUB DU SITE</span></div>${body}<p class="affiliate-disclaimer-text"><em>Un achat par nos liens peut nous rapporter une commission.</em></p><div class="not-prose comp-boxed comp-disclaimer"><h3>Ce qu’il faut savoir sur nos bons plans</h3><p>Ce contenu est proposé par notre équipe commerciale.</p></div><div id="installPwaDiv" class="card-install-pwa optid-no-ads"><p class="card-install-pwa__title">Toute l’actualité en un clin d’œil</p><p>Ajoutez le site à votre écran d’accueil.</p></div></article>`);
    for (const junk of ['PUB DU SITE', 'commission', 'Ce qu’il faut savoir', 'clin d’œil', 'écran d’accueil']) expect(text).not.toContain(junk);
    expect(text).toContain(long);
  });

  it('garde un long bloc dont la classe contient « ad » ou « disclaimer »', () => {
    const analysis = 'ADMARKET analysis paragraph about the advertising market, part of the article. '.repeat(8);
    const notice = 'NOTICEBODY the legal notice is the subject of this article and is quoted here. '.repeat(8);
    const text = strip(`<article>${body}<section class="ad-market"><p>${analysis}</p></section><div class="disclaimer-quote"><p>${notice}</p></div>${body}</article>`);
    expect(text).toContain('ADMARKET');
    expect(text).toContain('NOTICEBODY');
  });

  it('retire un formulaire de lettre d’information, même long', () => {
    // Frandroid : `div.newsletter-form` avec ses champs et une FAQ de plus de
    // 500 caractères — au-delà de la règle des blocs courts.
    const faq = 'Les données transmises par ce formulaire servent à envoyer la lettre et ne sont jamais revendues. '.repeat(6);
    const text = strip(`<article>${body}<div class="newsletter-form newsletter-form--gooddeal"><p class="newsletter-form__title">Recevez nos bons plans</p><input type="email" name="email"><button type="submit">S’inscrire</button><div class="newsletter-form__faq"><p>${faq}</p></div></div>${body}</article>`);
    expect(text).not.toContain('Recevez nos bons plans');
    expect(text).not.toContain('jamais revendues');
    expect(text).toContain(long);
  });

  // B-02 (quatrième round) : chaque bloc « newsletter » à champ de saisie
  // relisait tout le texte de son billet — 4 000 blocs au pied d'un billet de
  // 1 Mo coûtaient 11,4 s.
  it('ne relit pas tout le billet pour chaque formulaire de lettre d’information', () => {
    const { document } = parseHTML(`<html><body><article>${'<p>Lorem ipsum dolor sit amet consectetur.</p>'.repeat(15_000)}${'<div class="newsletter"><input></div>'.repeat(3000)}</article></body></html>`);
    const started = performance.now();
    stripBoilerplate(document.documentElement as unknown as Element);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(document.querySelectorAll('.newsletter')).toHaveLength(0);
  });

  it('mesure le billet tel qu’il reste après les retraits déjà faits', () => {
    // Le dernier formulaire, jugé le premier, sort ; le premier porte alors
    // plus de la moitié de ce qui reste du billet (600 sur 800) : c'est le
    // corps d'une lettre, il reste. Mesuré avant le retrait (1 450), il sortait.
    const words = (n: number, word: string) => `${word} `.repeat(n / (word.length + 1));
    const text = strip(`<article><div class="newsletter-issue"><p>${words(600, 'LETTRE')}</p><input type="email"></div><p>${words(200, 'autre')}</p><div class="newsletter-form"><p>${words(650, 'formulaire')}</p><input type="email"></div></article>`);
    expect(text).toContain('LETTRE');
    expect(text).not.toContain('formulaire');
  });

  it('un retrait dans un `noscript` ne change pas la mesure du billet, où il ne comptait pas', () => {
    // Le formulaire « LETTRE » (600) porte moins de la moitié du billet
    // (1 300) : il sort. Ôter du billet les 400 caractères du bloc retiré dans
    // le `noscript`, qui n'y étaient pas comptés, le faisait passer pour le corps.
    const words = (n: number, word: string) => `${word} `.repeat(n / (word.length + 1));
    const { document } = parseHTML(`<html><body><article><div class="newsletter-issue"><p>${words(600, 'LETTRE')}</p><input type="email"></div><p>${words(700, 'texte')}</p><noscript><div class="share-box"><p>${words(400, 'partage')}</p></div></noscript><div class="newsletter-form"><p>${words(100, 'abonnement')}</p><input type="email"></div></article></body></html>`);
    stripBoilerplate(document.documentElement as unknown as Element);
    const text = document.body.textContent || '';
    expect(text).toContain('texte');
    expect(text).not.toContain('partage');
    expect(text).not.toContain('LETTRE');
  });

  it('retire le texte de repli d’une démo CodePen que sa légende répète', () => {
    // Smashing Magazine : le repli (« See the Pen … ») et la légende disent la
    // même chose ; le script de CodePen ne tournera jamais dans l'extrait.
    const text = strip(`<article>${body}<figure><p data-height="480" data-slug-hash="AbCdEf" data-user="exemple">DEMOREPLI See the Pen [démo] by Auteur.</p><figcaption>See the Pen <a href="/x">démo</a> by Auteur.</figcaption></figure>${body}</article>`);
    expect(text).not.toContain('DEMOREPLI');
    expect(text).toContain('See the Pen démo by Auteur.');
  });

  it('garde le repli d’une démo CodePen sans légende : c’est son seul lien', () => {
    expect(strip(`<article>${body}<p data-slug-hash="AbCdEf">DEMOSEULE See the Pen <a href="/x">démo</a>.</p>${body}</article>`)).toContain('DEMOSEULE');
  });

  it('retire la colonne `#secondary` d’un blog, hors de l’article', () => {
    // Simon Willison : la barre latérale est un `div#secondary` (convention
    // des thèmes WordPress), pas un `<aside>`.
    const text = strip(`<div id="wrapper"><div id="primary">${body}</div><div id="secondary"><div class="metabox"><p class="this-is">COLONNE billet publié le 4 novembre.</p><h3>Lettre mensuelle</h3><p>Soutenez-moi.</p></div></div></div>`);
    expect(text).not.toContain('COLONNE');
    expect(text).toContain(long);
  });
});

// ── Relecture du troisième round : billets WordPress courts ─────────
// `post_class()` met les termes du billet sur son `<article>` :
// `tag-pwa`, `category-ads`, `tag-sponsored`, `tag-newsletter`. Les règles par
// nom (A3) lisaient ces termes comme des blocs étrangers, et un billet court —
// moins de la moitié du texte de la page, menu et archives compris — sortait
// entier : Readability rendait la colonne d'archives.
describe('extractArticle — billets WordPress courts étiquetés', () => {
  const nav = `<nav><ul>${Array.from({ length: 12 }, (_, i) => `<li><a href="/c${i}">Catégorie numéro ${i}</a></li>`).join('')}</ul></nav>`;
  const archives = `<div class="widget-area"><section class="widget"><h2>Archives</h2><ul>${
    Array.from({ length: 30 }, (_, i) => `<li><a href="/2025/${i}">Billet ancien numéro ${i} sur un autre sujet sans rapport</a></li>`).join('')
  }</ul></section></div>`;
  const post = (terms: string) => `<article class="post-42 post type-post status-publish format-standard hentry ${terms}"><header class="entry-header"><h1 class="entry-title">Les PWA sur iOS 26</h1></header><div class="entry-content"><p>BILLET Apple ouvre enfin les notifications aux applications web installées sur l’écran d’accueil : un détail qui change la donne pour les petits éditeurs. Voir <a href="https://example.com/notes">les notes de version</a> pour le détail de ce qui est pris en charge.</p></div></article>`;
  const page = (terms: string) => `<!doctype html><html><head><title>t</title></head><body>${nav}<div id="page"><main id="main">${post(terms)}</main>${archives}</div></body></html>`;

  for (const terms of ['category-web tag-pwa', 'category-ads tag-ios', 'category-web tag-sponsored', 'category-news tag-ad', 'category-web tag-related']) {
    it(`garde le billet dont les termes sont « ${terms} »`, () => {
      const out = extractArticle('https://example.com/pwa', page(terms));
      expect(out?.content).toContain('BILLET');
    });
  }

  it('garde une lettre étiquetée « newsletter » qui intègre son formulaire, sans le formulaire', () => {
    const body = Array.from({ length: 6 }, (_, i) => `<p>Paragraphe ${i} de la lettre de novembre : trois liens commentés sur la sobriété numérique, un outil libre pour mesurer le poids des pages, et une lecture longue.</p>`).join('');
    const form = '<div class="mc4wp-form newsletter-signup"><p>FORMULAIRE Recevoir la lettre :</p><input type="email" name="EMAIL"><button>OK</button></div>';
    const archivesLong = `<div class="widget-area"><ul>${Array.from({ length: 60 }, (_, i) => `<li><a href="/2025/${i}">Billet ancien numéro ${i} sur un autre sujet sans rapport</a></li>`).join('')}</ul></div>`;
    const html = `<!doctype html><html><body><main><article class="post-7 post type-post hentry category-lettre tag-newsletter"><h1>Lettre n° 12</h1><div class="entry-content newsletter-issue">${body}${form}</div></article></main>${archivesLong}</body></html>`;
    const text = (extractArticle('https://example.com/lettre-12', html)?.content || '').replace(/<[^>]+>/g, ' ');
    expect(text).toContain('Paragraphe 5');
    expect(text).not.toContain('FORMULAIRE');
  });
});

// ── Corps réparti en plusieurs blocs (campagne 1.9.0, troisième round) ──
// Ars Technica coupe son corps en plusieurs `div.post-content`, chacun dans sa
// propre grille : des cousins, pas des frères. Readability n'en gardait qu'un —
// le chapeau disparaissait sur quatre pages sur cinq — ou, quand la seconde
// passe (A-1) rattrapait le corps, ramassait avec lui la notice de l'auteur et
// le compteur de commentaires.
describe('extractArticle — corps réparti en plusieurs blocs', () => {
  const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
  const textOf = (html: string) => norm(parseHTML(`<html><body>${html}</body></html>`).document.body.textContent);
  const blocksOf = (html: string) => Array.from(parseHTML(html).document.querySelectorAll('div.post-content'), (b) => norm((b as Element).textContent));

  it('garde chaque bloc d’un corps réparti, chapeau compris (structure Ars Technica)', () => {
    const html = splitBodyPageHtml();
    const blocks = blocksOf(html);
    expect(blocks).toHaveLength(3);
    const text = textOf(extractArticle('https://example.com/ars', html)!.content);
    for (const block of blocks) expect(text).toContain(block);
    // Dans l'ordre de la page.
    expect(text.indexOf(blocks[0])).toBeLessThan(text.indexOf(blocks[1]));
    expect(text.indexOf(blocks[1])).toBeLessThan(text.indexOf(blocks[2]));
  });

  it('garde tout le corps réparti sans la notice de l’auteur qui le suit (structure Ars Technica)', () => {
    const html = splitBodyWithBioPageHtml();
    const blocks = blocksOf(html);
    const { document } = parseHTML(html);
    const bio = document.querySelector('.author-mini-bio') as Element;
    const srcs = (selector: string) => Array.from(document.querySelectorAll(selector), (img) => (img as Element).getAttribute('src')!);
    const out = extractArticle('https://example.com/ars', html)!;
    const text = textOf(out.content);
    for (const block of blocks) expect(text).toContain(block);
    expect(text).not.toContain(norm(bio.textContent).slice(-80));
    // Les images du corps restent ; le portrait de la notice s'en va avec elle.
    const bodyImages = srcs('.post-content img');
    expect(bodyImages.length).toBeGreaterThan(0);
    for (const src of bodyImages) expect(out.content).toContain(`https://example.com${src}`);
    for (const src of srcs('.author-mini-bio img')) expect(out.content).not.toContain(src);
  });

  // Vérification du troisième round (R3V-01) : la réunion ne prenait que les
  // blocs que rien ne séparait ; le morceau du milieu, ainsi grossi, devenait
  // le seul corps — chapeau, moitié du texte et images perdus.
  it('garde tout un corps que des images coupent, chapeau et images compris (structure Clubic)', () => {
    const html = splitBodyAcrossImagesPageHtml();
    const { document } = parseHTML(html);
    const blocks = Array.from(document.querySelectorAll('div.slate-content p'), (b) => norm((b as Element).textContent)).filter(Boolean);
    expect(blocks.length).toBeGreaterThan(5);
    const out = extractArticle('https://example.com/clubic', html)!;
    const text = textOf(out.content);
    for (const block of blocks) expect(text).toContain(block);
    expect(text.indexOf(blocks[0])).toBeLessThan(text.indexOf(blocks[blocks.length - 1]));
    const bodyImages = Array.from(document.querySelectorAll('article img'), (img) => (img as Element).getAttribute('src')!);
    expect(bodyImages).toHaveLength(2);
    for (const src of bodyImages) expect(out.content).toContain(`https://example.com${src}`);
  });

  // B-01 (quatrième round) : la réunion ne regardait pas si un bloc était
  // invisible pour Readability, qui écarte `noscript`, `[hidden]`,
  // `aria-hidden="true"` et les styles `display:none` / `visibility:hidden`.
  const story = Array.from({ length: 12 }, (_, i) => `<p>Paragraph ${i} of the real story, with enough words to look like genuine body text that Readability scores well and keeps.</p>`).join('');
  const paragraphs = (html: string) => (html.match(/Paragraph \d+/g) || []).length;

  it('garde le corps entier quand un bloc caché de même classe le précède', () => {
    for (const hide of ['hidden', 'style="display:none"', 'style="visibility: hidden"', 'aria-hidden="true"']) {
      const html = `<html><head><title>T</title></head><body><article><h1>Title</h1>
        <div class="teaser" ${hide}><div class="article-body"><p>Short teaser shown in the app only.</p></div></div>
        <div class="full"><div class="article-body">${story}</div></div></article></body></html>`;
      expect(paragraphs(extractArticle('https://example.com/a', html)?.content || ''), hide).toBe(12);
    }
  });

  it('ne double pas l’article quand un doublon caché du corps le suit', () => {
    for (const duplicate of [`<noscript><div class="article-body">${story}</div></noscript>`, `<div class="dup" hidden><div class="article-body">${story}</div></div>`]) {
      const html = `<html><head><title>T</title></head><body><article><h1>Title</h1>
        <div class="full"><div class="article-body">${story}</div></div>${duplicate}</article></body></html>`;
      expect(paragraphs(extractArticle('https://example.com/a', html)!.content), duplicate.slice(0, 20)).toBe(12);
    }
  });
});

describe('joinSplitBody', () => {
  const para = (s: string) => `<p>${s} — un paragraphe d’article assez long pour compter comme du texte.</p>`;
  const run = (body: string) => {
    const { document } = parseHTML(`<html><body>${body}</body></html>`);
    const before = (document.body.textContent || '').replace(/\s+/g, ''); // l'ordre des mots, pas les blancs entre blocs
    joinSplitBody(document.documentElement as unknown as Element);
    const after = (document.body.textContent || '').replace(/\s+/g, '');
    return { document, before, after };
  };
  const parentsOf = (document: { querySelectorAll: (s: string) => ArrayLike<unknown> }, selector: string) =>
    Array.from(document.querySelectorAll(selector) as ArrayLike<Element>, (el) => el.parentElement);

  it('réunit les blocs du corps répartis dans des gabarits parallèles, sans changer l’ordre du texte', () => {
    const { document, before, after } = run(`<article><header><h1>Titre</h1></header>
      <div class="grid"><div class="col"><div class="post-content">${para('UN')}</div></div><div class="rail"></div></div>
      <div class="ad-slot"><div class="ad"></div></div>
      <div class="grid"><div class="col"><div class="post-content">${para('DEUX')}</div><div class="author-bio"><p>Notice</p></div></div></div>
    </article>`);
    const blocks = document.querySelectorAll('.post-content');
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as Element).textContent).toMatch(/UN[\s\S]*DEUX/);
    expect((blocks[0] as Element).textContent).not.toContain('Notice');
    expect(after).toBe(before);
  });

  // Relecture du correctif : des blocs vides de même classe encadrant un long
  // vide faisaient parcourir ce vide une fois par groupe (54 s pour 1 000
  // groupes et 50 000 `<div>`).
  it('ne parcourt pas le même vide une fois par groupe (blocs sans texte)', () => {
    const pair = (i: number) => `<div class="w"><div class="post-content k${i}"><p></p></div></div>`;
    const ends = Array.from({ length: 1000 }, (_, i) => pair(i)).join('');
    const { document } = parseHTML(`<html><body><article>${ends}${'<div></div>'.repeat(50_000)}${ends}</article></body></html>`);
    const started = performance.now();
    joinSplitBody(document.documentElement as unknown as Element);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('ne réunit pas deux blocs qu’une image sépare', () => {
    const { document } = run(`<article>
      <div class="w"><div class="post-content">${para('UN')}</div></div>
      <figure><img src="/a.jpg"></figure>
      <div class="w"><div class="post-content">${para('DEUX')}</div></div></article>`);
    expect(document.querySelectorAll('.post-content')).toHaveLength(2);
  });

  // R3V-01 : réunir les seuls blocs contigus d'un corps coupé faisait d'un
  // morceau le seul candidat de Readability. C'est tout le groupe ou rien.
  it('ne réunit aucun bloc d’un corps qu’une image coupe ailleurs : tout ou rien', () => {
    const { document, before, after } = run(`<article>
      <div class="w"><div class="post-content">${para('UN')}</div></div>
      <div class="ad-slot"></div>
      <div class="w"><div class="post-content">${para('DEUX')}</div></div>
      <figure><img src="/a.jpg"></figure>
      <div class="w"><div class="post-content">${para('TROIS')}</div></div></article>`);
    expect(parentsOf(document, '.post-content').map((p) => p?.className)).toEqual(['w', 'w', 'w']);
    expect(after).toBe(before);
  });

  // Mesure de R3V-01 (Docker) : les cellules d'un tableau, chacune avec son
  // bloc de même classe, étaient toutes versées dans la première.
  it('ne vide pas les cellules d’un tableau dans la première', () => {
    const cell = (s: string) => `<td><div class="rich-text-content">${para(s)}</div></td>`;
    const { document, after, before } = run(`<article><table>
      <tr>${cell('UN')}${cell('DEUX')}</tr><tr>${cell('TROIS')}${cell('QUATRE')}</tr></table></article>`);
    expect(Array.from(document.querySelectorAll('td'), (td) => (td as Element).querySelectorAll('p').length)).toEqual([1, 1, 1, 1]);
    expect(after).toBe(before);
  });

  it('réunit le corps d’un article même quand un autre article de la page est coupé', () => {
    const { document } = run(`<article>
      <div class="w"><div class="post-content">${para('UN')}</div></div>
      <div class="w"><div class="post-content">${para('DEUX')}</div></div></article>
      <article><div class="w"><div class="post-content">${para('TROIS')}</div></div>
      <figure><img src="/a.jpg"></figure>
      <div class="w"><div class="post-content">${para('QUATRE')}</div></div></article>`);
    expect(parentsOf(document, '.post-content').map((p) => p?.className)).toEqual(['w', 'w', 'w']);
  });

  it('laisse les blocs que sépare un texte à eux (heure et titre des entrées d’un direct)', () => {
    const { document } = run(`<article>
      <div class="update"><h3>10 h 02</h3><div class="update-content">${para('UN')}</div></div>
      <div class="update"><h3>10 h 15</h3><div class="update-content">${para('DEUX')}</div></div>
    </article>`);
    expect(parentsOf(document, '.update-content').map((p) => p?.className)).toEqual(['update', 'update']);
  });

  it('laisse des blocs de deux articles différents', () => {
    const { document } = run(`<article><div class="w"><div class="entry-content">${para('UN')}</div></div></article>
      <article><div class="w"><div class="entry-content">${para('DEUX')}</div></div></article>`);
    expect(parentsOf(document, '.entry-content').map((p) => p?.className)).toEqual(['w', 'w']);
  });

  // B-01 (quatrième round) : invisible pour Readability, le bloc lui-même ou
  // un ancêtre. Versé dedans, le corps disparaissait ; versé dans le corps, un
  // doublon caché doublait l'article.
  const hiders: Array<[string, (inner: string) => string]> = [
    ['noscript', (inner) => `<noscript>${inner}</noscript>`],
    // Le contenu d'un `template` n'est déjà pas parcouru (linkedom le range
    // dans `content`, comme le navigateur) : le cas reste pour le garantir.
    ['template', (inner) => `<template>${inner}</template>`],
    ['hidden', (inner) => `<div hidden>${inner}</div>`],
    ['aria-hidden', (inner) => `<div aria-hidden="true">${inner}</div>`],
    ['display:none', (inner) => `<div style="color: red; display: none">${inner}</div>`],
    ['visibility:hidden', (inner) => `<div style="visibility:hidden">${inner}</div>`],
    ['dialogue modal', (inner) => `<div role="dialog" aria-modal="true">${inner}</div>`],
    ['bloc lui-même caché', (inner) => inner.replace('class="post-content"', 'class="post-content" hidden')],
    ['ancêtre lointain caché', (inner) => `<section hidden><div><div>${inner}</div></div></section>`],
  ];

  it('ne verse pas le corps dans un bloc invisible pour Readability', () => {
    for (const [name, hide] of hiders) {
      const { document } = run(`<article>
        <div class="w">${hide(`<div class="post-content">${para('CACHÉ')}</div>`)}</div>
        <div class="w"><div class="post-content">${para('UN')}${para('DEUX')}</div></div></article>`);
      const visible = Array.from(document.querySelectorAll('.post-content') as ArrayLike<Element>).find((b) => b.textContent!.includes('UN'));
      expect(visible?.textContent, name).toContain('DEUX');
      expect(visible?.textContent, name).not.toContain('CACHÉ');
    }
  });

  it('ne verse pas un doublon invisible dans le corps', () => {
    for (const [name, hide] of hiders) {
      const { document } = run(`<article>
        <div class="w"><div class="post-content">${para('UN')}</div></div>
        <div class="w">${hide(`<div class="post-content">${para('DOUBLON')}</div>`)}</div></article>`);
      const visible = Array.from(document.querySelectorAll('.post-content') as ArrayLike<Element>).find((b) => b.textContent!.includes('UN'));
      expect(visible?.textContent, name).not.toContain('DOUBLON');
    }
  });

  it('garde l’exception de Readability : `aria-hidden` sur un `fallback-image` reste visible', () => {
    const { document } = run(`<article>
      <div class="w"><div class="post-content">${para('UN')}</div></div>
      <div class="ad-slot"></div>
      <div class="w fallback-image" aria-hidden="true"><div class="post-content">${para('DEUX')}</div></div></article>`);
    expect(document.querySelectorAll('.post-content')).toHaveLength(1);
  });

  it('laisse des blocs dont le nom dit qu’ils ne sont pas le corps (commentaires)', () => {
    const { document } = run(`<article><div class="w"><div class="comment-body">${para('UN')}</div></div>
      <div class="w"><div class="comment-body">${para('DEUX')}</div></div></article>`);
    expect(parentsOf(document, '.comment-body').map((p) => p?.className)).toEqual(['w', 'w']);
  });
});

// ── La file d'analyse ────────────────────────────────────────────────
// `parseHTML` + `Readability` bloquent l'unique boucle d'événements qui sert
// toute l'instance (des dizaines de ms à ~1 s au plafond de 2 Mo), et cette
// charge est NEUVE : elle vivait sur chaque téléphone avant la 1.4.10. Le seul
// frein était le seau de cadence (600/min par compte), qui permet un ordre de
// grandeur de plus que ce que la boucle absorbe.
describe('withExtractSlot', () => {
  it('rend le résultat de l’analyse et libère la place', async () => {
    await expect(withExtractSlot(() => 'extrait')).resolves.toBe('extrait');
    expect(extractPending()).toBe(0);
  });

  // Le point de la file : un tour de boucle COMPLET entre deux analyses. Une
  // promesse déjà réglée ne rendrait la main qu'aux micro-tâches, et la boucle
  // enchaînerait N immobilisations sans traiter une seule entrée-sortie.
  it('rend la main à la boucle entre deux analyses', async () => {
    const order: string[] = [];
    const first = withExtractSlot(() => {
      order.push('analyse 1');
      setImmediate(() => order.push('boucle'));
    });
    const second = withExtractSlot(() => { order.push('analyse 2'); });

    await Promise.all([first, second]);

    expect(order).toEqual(['analyse 1', 'boucle', 'analyse 2']);
  });

  // Saturation : on refuse plutôt que d'accepter une file sans fond. Le client
  // se replie sur son propre extracteur — ce qu'il faisait avant la 1.4.10 —,
  // ce qui coûte une extraction locale et jamais la mémoire du serveur.
  it('refuse au-delà du plafond, sans casser la file', async () => {
    const started: number[] = [];
    const accepted: Promise<void>[] = [];
    for (let i = 0; i < EXTRACT_MAX_PENDING; i++) {
      accepted.push(withExtractSlot(() => { started.push(i); }));
    }
    expect(extractPending()).toBe(EXTRACT_MAX_PENDING);

    await expect(withExtractSlot(() => 'de trop')).rejects.toBeInstanceOf(ExtractorBusyError);

    await Promise.all(accepted);
    expect(started).toEqual([...Array(EXTRACT_MAX_PENDING).keys()]);   // premier arrivé, premier servi
    expect(extractPending()).toBe(0);
    // La file redevient disponible : un refus n'est pas un verrou.
    await expect(withExtractSlot(() => 'après')).resolves.toBe('après');
  });

  // Une analyse qui lève ne doit pas laisser une promesse rejetée en fin de
  // file : toutes les suivantes attendraient pour toujours.
  it('laisse la file avancer après une analyse en erreur', async () => {
    const boom = withExtractSlot(() => { throw new Error('analyse ratée'); });
    const next = withExtractSlot(() => 'suivant');

    await expect(boom).rejects.toThrow('analyse ratée');
    await expect(next).resolves.toBe('suivant');
    expect(extractPending()).toBe(0);
  });
});
