/**
 * Les médias de l'article complet (REG-239 à REG-243), écrits une fois pour la
 * route serveur (`server/extract.ts`) et le repli du navigateur
 * (`src/utils/extractContent.ts`), qui en porte une copie. Pages écrites à la
 * main d'après les structures relevées par la mesure des médias
 * (`scripts/corpus/media.ts`) sur Clubic, Numerama et le blog de Google ; les
 * formes « qui pourraient casser » sont celles que la consigne de chaque
 * correctif a nommées avant qu'il soit écrit (`docs/TESTING.md`).
 */
import { describe, it, expect } from 'vitest';

interface Extracted { title: string; content: string }
export interface MediaApi {
  /** Préfixe des titres (« repli local — » pour le navigateur). */
  prefix: string;
  extractArticle: (url: string, html: string) => Extracted | null;
  guardForTests: (input: { page: string; result: string; title?: string; base?: string }) => { content: string };
  resolveLazyImages: (root: Element) => void;
  /** Un document lu par l'analyseur de ce côté (linkedom, DOMParser). */
  parse: (html: string) => Document;
}

const URL_ = 'https://example.com/page';
const sentence = (n: number, topic: string) =>
  `${topic} ${n} : une phrase inventée assez longue pour que l’extraction la suive et la compte comme du texte d’article.`;
const paragraph = (n: number, topic = 'Paragraphe') => `<p>${sentence(n, topic)} ${sentence(n + 100, topic)}</p>`;
const paragraphs = (from: number, count: number, topic?: string) => Array.from({ length: count }, (_, i) => paragraph(from + i, topic)).join('');
const doc = (main: string, head = '<title>Le titre de l’article</title>') =>
  `<!doctype html><html><head>${head}</head><body><header><nav><a href="/">Accueil</a></nav></header><main>${main}</main><footer><p>Pied</p></footer></body></html>`;

export function defineMediaCases(api: MediaApi): void {
  const { prefix, extractArticle, guardForTests, resolveLazyImages, parse } = api;
  const norm = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();
  const textOf = (html: string) => norm(parse(`<!doctype html><html><body>${html}</body></html>`).body.textContent);
  const all = (html: string, selector: string) => Array.from(parse(`<!doctype html><html><body>${html}</body></html>`).querySelectorAll(selector)) as Element[];
  const occurrences = (text: string, needle: string) => text.split(needle).length - 1;
  const resolved = (html: string) => {
    const d = parse(`<!doctype html><html><body>${html}</body></html>`);
    resolveLazyImages(d.documentElement as unknown as Element);
    return d.body;
  };

  describe(`${prefix}médias de l’article — pages réelles (REG-239 à REG-243)`, () => {
    // Clubic : le corps en `div.slate-content` cousins, puis une FAQ dont chaque
    // question est un `<h3>` dans le `<summary>` d'un `<details>` ouvert, et la
    // réponse dans un `div.slate-content`. Readability ne prend pas la FAQ ; la
    // garde remettait les réponses (même gabarit que le corps) sans les questions.
    const faqPage = () => {
      const row = (inner: string) => `<div class="grid-default"><div class="row-wrapper row">${inner}</div></div>`;
      const slate = (inner: string) => row(`<div class="slate-content col-slate-12">${inner}</div>`);
      const faq = [1, 2, 3].map((n) => row(`<details open="" class="pcndig-0 hwZhOy"><summary class="pcndig-1 eISuem"><div class="collapse"><svg width="26" height="26"><path d="M0 0"></path></svg></div><h3 class="pcndig-2">Question numéro ${n} de la foire aux questions ?</h3></summary><div class="pcndig-3"><div class="row-wrapper row"><div class="slate-content col-slate-12"><p class="sc-9e">${sentence(n, 'Réponse')}</p></div></div></div></details>`)).join('');
      return doc(`<article><h1>Le titre de l’article</h1>${slate(paragraphs(1, 3))}${slate(paragraphs(4, 3))}${slate('<h2>Vos questions</h2>')}${faq}</article>`);
    };

    it('les questions d’une FAQ en `<details>` reviennent avec leurs réponses, chacune avant la sienne (Clubic, REG-239)', () => {
      const html = faqPage();
      const out = textOf(guardForTests({ page: html, result: `<div class="page">${paragraphs(1, 6)}</div>`, title: 'Le titre de l’article' }).content);
      for (const n of [1, 2, 3]) {
        const question = `Question numéro ${n} de la foire aux questions ?`;
        const answer = sentence(n, 'Réponse');
        expect(out, question).toContain(question);
        expect(occurrences(out, question)).toBe(1);
        expect(out.indexOf(question)).toBeLessThan(out.indexOf(answer));
      }
      const full = textOf(extractArticle(URL_, html)!.content);
      for (const n of [1, 2, 3]) expect(full).toContain(`Question numéro ${n} de la foire aux questions ?`);
    });

    it('une `<picture>` paresseuse sans `<img>` prend l’image de son `<noscript>` (dossier de Clubic, REG-240)', () => {
      const figure = (n: number) => `<div class="image-content"><span role="presentation"><div style="display:contents"><picture class="article img-wrapper lazy" data-lazy="{&quot;imageId&quot;:${n}}"><div class="image-loading"><svg width="50" height="50"><circle r="4"></circle></svg></div><noscript><img src="//pic.example.com/abc${n}/2500x1390/smart/photo-${n}.jpg" alt="©Crédit ${n}" width="2500" height="1390"></noscript></picture></div></span><figcaption>©Crédit ${n}</figcaption></div>`;
      const html = doc(`<article><h1>Le titre de l’article</h1>${paragraphs(1, 3)}${figure(1)}${paragraphs(4, 3)}${figure(2)}${paragraphs(7, 3)}</article>`);
      const out = extractArticle(URL_, html)!.content;
      for (const n of [1, 2]) expect(all(out, 'img').map((img) => img.getAttribute('src')), `photo ${n}`).toContain(`https://pic.example.com/abc${n}/2500x1390/smart/photo-${n}.jpg`);
      const body = resolved('<picture data-lazy="{}"><div></div><noscript><img src="https://pic.example.com/p.jpg" alt="a"></noscript></picture>');
      expect(body.querySelector('picture > img')?.getAttribute('src')).toBe('https://pic.example.com/p.jpg');
      expect(body.querySelector('noscript')).toBeNull();
    });

    it('une vidéo YouTube derrière un voile de consentement prend l’adresse de son `data-src` (Numerama, REG-241)', () => {
      const html = doc(`<article><h1>Le titre de l’article</h1>${paragraphs(1, 3)}<figure class="wp-block-embed is-provider-youtube"><div class="embed-container embed-container--with-overlay"><div class="embed-container-content"><iframe loading="lazy" title="Bande-annonce" width="500" height="281" data-src="https://www.youtube.com/embed/qb8jZ5zNMrs?feature=oembed" allowfullscreen></iframe></div></div></figure>${paragraphs(4, 3)}</article>`);
      const out = extractArticle(URL_, html)!.content;
      expect(all(out, 'iframe').map((f) => f.getAttribute('src'))).toContain('https://www.youtube.com/embed/qb8jZ5zNMrs?feature=oembed');
    });

    it('une vidéo YouTube chargée au clic (WP Rocket) prend l’iframe de son `<noscript>` (Journal du Geek, REG-241)', () => {
      const player = '<div class="not-prose video-container"><div class="rll-youtube-player" data-src="https://www.youtube-nocookie.com/embed/0CqlEgWYWUY" data-id="0CqlEgWYWUY"></div><noscript><iframe title="Bande-annonce" width="500" height="281" src="https://www.youtube-nocookie.com/embed/0CqlEgWYWUY?feature=oembed" allowfullscreen></iframe></noscript></div>';
      const html = doc(`<article><h1>Le titre de l’article</h1>${paragraphs(1, 3)}${player}${paragraphs(4, 3)}</article>`);
      const frames = all(extractArticle(URL_, html)!.content, 'iframe').map((f) => f.getAttribute('src'));
      expect(frames).toEqual(['https://www.youtube-nocookie.com/embed/0CqlEgWYWUY?feature=oembed']);
      const ad = resolved('<div><div class="slot"></div><noscript><iframe src="https://ads.example.net/banner"></iframe></noscript></div>');
      expect(ad.querySelector('iframe:not(noscript iframe)')).toBeNull();
    });

    it('les vidéos et les citations que des éléments personnalisés portent dans leurs attributs sont montrées (blog de Google, REG-242)', () => {
      const video = (n: number) => `<section class="uni-inline-image-section"><uni-inline-image alt-text="Démonstration ${n}" or-mp4-video-url="https://storage.example.com/videos/Demo_${n}.mp4" poster-image-url="https://storage.example.com/images/poster_${n}.width-1200.format-webp.webp"><div slot="caption-slot"><div class="rich-text"><p>${sentence(n, 'Légende de la démonstration')}</p></div></div></uni-inline-image></section>`;
      const quote = (n: number) => `<uni-media-carousel-slide data-index="${n}"><div slot="content"><script type="application/json">{"by":"By"}</script><uni-quote-media-carousel quote="Citation de client numéro ${n} : nous avons réalisé en un jour ce qui prenait une semaine." author-name="Personne ${n}" author-title="Directrice, Société ${n}"></uni-quote-media-carousel></div></uni-media-carousel-slide>`;
      const html = doc(`<article><h1>Le titre de l’article</h1>${paragraphs(1, 3)}${video(1)}${paragraphs(4, 2)}${video(2)}${paragraphs(6, 2)}<section><uni-media-carousel>${quote(1)}${quote(2)}</uni-media-carousel></section>${paragraphs(8, 2)}</article>`);
      const out = extractArticle(URL_, html)!.content;
      const videos = all(out, 'video').map((v) => v.getAttribute('src'));
      for (const n of [1, 2]) expect(videos, `vidéo ${n}`).toContain(`https://storage.example.com/videos/Demo_${n}.mp4`);
      const quotes = all(out, 'blockquote').map((q) => norm(q.textContent));
      for (const n of [1, 2]) {
        expect(quotes.some((q) => q.includes(`Citation de client numéro ${n}`) && q.includes(`Personne ${n}, Directrice, Société ${n}`)), `citation ${n}`).toBe(true);
      }
      const text = textOf(out);
      expect(occurrences(text, 'Citation de client numéro 1')).toBe(1);
    });

    it('l’image d’en-tête dans un lien d’agrandissement revient, sans le lien (Ars Technica, Numerama, REG-244)', () => {
      const hero = '<div class="ars-lightbox"><div class="ars-lightbox-item"><a class="cursor-zoom-in" data-pswp-width="2121" href="https://cdn.example.com/up/2026/11/hero.jpg" target="_blank"><img class="hidden" src="https://cdn.example.com/up/2026/11/hero-640x427.jpg" alt="Une colline"><img class="intro-image" width="1152" height="648" src="https://cdn.example.com/up/2026/11/hero-1152x648.jpg" alt="Une colline"></a></div></div>';
      const html = doc(`<article><header><h1>Le titre de l’article</h1><p class="dek">Le chapeau de l’article, assez long pour être suivi par la garde.</p>${hero}</header>${paragraphs(1, 6)}</article>`);
      const out = guardForTests({ page: html, result: `<div class="page">${paragraphs(1, 6)}</div>`, title: 'Le titre de l’article' }).content;
      const srcs = all(out, 'img').map((img) => img.getAttribute('src'));
      expect(srcs).toContain('https://cdn.example.com/up/2026/11/hero-1152x648.jpg');
      expect(srcs).not.toContain('https://cdn.example.com/up/2026/11/hero-640x427.jpg');
      expect(all(out, 'a').map((a) => a.getAttribute('href'))).not.toContain('https://cdn.example.com/up/2026/11/hero.jpg');
      // Bout à bout, Readability garde l'une des deux tailles de la photo : elle est là, une fois.
      const full = all(extractArticle(URL_, html)!.content, 'img').map((img) => img.getAttribute('src') || '');
      expect(full.filter((src) => src.includes('/up/2026/11/hero-'))).toHaveLength(1);
    });

    it('un aperçu flou prend la plus grande variante de son `data-srcset`, jusqu’à 1600 (en-tête du blog de Google, REG-243)', () => {
      const body = resolved(`<img alt="En-tête" class="uni-progressive-image--blur" src="https://storage.example.com/images/hero.width-200.format-webp.webp" data-sizes="100vw" data-srcset="https://storage.example.com/images/hero.width-450.format-webp.webp 450w, https://storage.example.com/images/hero.width-1600.format-webp.webp 1600w, https://storage.example.com/images/hero.width-2200.format-webp.webp 2200w">`);
      const img = body.querySelector('img')!;
      expect(img.getAttribute('src')).toBe('https://storage.example.com/images/hero.width-1600.format-webp.webp');
      expect(img.getAttribute('srcset')).toContain('hero.width-2200');
      expect(img.getAttribute('sizes')).toBe('100vw');
    });
  });

  describe(`${prefix}médias de l’article — formes qui pourraient casser (REG-239 à REG-243)`, () => {
    it('un `<details>` de navigation (menu de liens) ne revient pas, ni sa question', () => {
      const menu = '<details class="menu"><summary>Toutes les rubriques du site</summary><ul><li><a href="/a">Rubrique A du site</a></li><li><a href="/b">Rubrique B du site</a></li></ul></details>';
      const html = doc(`<article><h1>Le titre de l’article</h1>${paragraphs(1, 3)}${menu}${paragraphs(4, 3)}</article>`);
      const out = textOf(guardForTests({ page: html, result: `<div class="page">${paragraphs(1, 6)}</div>`, title: 'Le titre de l’article' }).content);
      expect(out).not.toContain('Toutes les rubriques du site');
      expect(out).not.toContain('Rubrique A du site');
    });

    it('une `<picture>` à `srcset` ET `<noscript>` garde une seule image, celle qu’elle montre', () => {
      const body = resolved('<picture><source srcset="https://cdn.example.com/p-800.webp 800w" type="image/webp"><img src="https://cdn.example.com/p-800.jpg" alt="a"><noscript><img src="https://cdn.example.com/p-800.jpg" alt="a"></noscript></picture>');
      expect(body.querySelectorAll('picture > img')).toHaveLength(1);
      expect(body.querySelector('picture > img')!.getAttribute('src')).toBe('https://cdn.example.com/p-800.jpg');
      const html = doc(`<article><h1>Le titre de l’article</h1>${paragraphs(1, 3)}<figure><picture><source srcset="https://cdn.example.com/p-800.webp 800w" type="image/webp"><img src="https://cdn.example.com/p-800.jpg" alt="a"><noscript><img src="https://cdn.example.com/p-800.jpg" alt="a"></noscript></picture><figcaption>Une légende</figcaption></figure>${paragraphs(4, 3)}</article>`);
      const imgs = all(extractArticle(URL_, html)!.content, 'img').filter((img) => (img.getAttribute('src') || '').includes('p-800'));
      expect(imgs).toHaveLength(1);
    });

    it('une vidéo de fond (lecture automatique en boucle, sans contrôles) n’est pas ramenée', () => {
      const html = doc(`<article><div class="hero"><video autoplay muted loop playsinline src="https://cdn.example.com/fond.mp4"></video><video autoplay loop src="https://cdn.example.com/fond-3.mp4"></video><uni-hero-video or-mp4-video-url="https://cdn.example.com/fond-2.mp4" autoplay loop></uni-hero-video></div><h1>Le titre de l’article</h1>${paragraphs(1, 6)}</article>`);
      const out = guardForTests({ page: html, result: `<div class="page">${paragraphs(1, 6)}</div>`, title: 'Le titre de l’article' }).content;
      expect(out).not.toContain('fond.mp4');
      expect(out).not.toContain('fond-2.mp4');
      expect(out).not.toContain('fond-3.mp4');
      expect(extractArticle(URL_, html)!.content).not.toContain('fond-2.mp4');
    });

    it('une vignette liée vers une autre page (carte « à lire ») ne revient pas, même en tête', () => {
      const card = '<div class="card"><a href="https://example.com/autre-article"><img src="https://cdn.example.com/up/2026/11/carte.jpg" alt="Autre article"></a></div>';
      const html = doc(`<article><header><h1>Le titre de l’article</h1>${card}</header>${paragraphs(1, 6)}</article>`);
      const out = guardForTests({ page: html, result: `<div class="page">${paragraphs(1, 6)}</div>`, title: 'Le titre de l’article' }).content;
      expect(out).not.toContain('carte.jpg');
    });

    it('un cadre publicitaire à `data-src` reste sans adresse ; un cadre qui a déjà la sienne la garde', () => {
      const body = resolved('<iframe data-src="https://ads.example.net/banner?slot=1"></iframe><iframe src="https://www.youtube.com/embed/aaaaaaaaaaa" data-src="https://www.youtube.com/embed/bbbbbbbbbbb"></iframe>');
      const [ad, video] = Array.from(body.querySelectorAll('iframe'));
      expect(ad.getAttribute('src')).toBeNull();
      expect(video.getAttribute('src')).toBe('https://www.youtube.com/embed/aaaaaaaaaaa');
    });

    it('un attribut `quote` court, ou une vidéo dans un élément ordinaire, ne fabrique rien', () => {
      const body = resolved('<x-card quote="Trop court."></x-card><div data-video="https://cdn.example.com/v.mp4"></div><x-player src="https://cdn.example.com/w.mp4"><video src="https://cdn.example.com/w.mp4"></video></x-player>');
      expect(body.querySelectorAll('blockquote')).toHaveLength(0);
      expect(body.querySelectorAll('video')).toHaveLength(1);
    });

    it('une citation d’attribut est du texte, jamais du balisage', () => {
      const body = resolved('<x-quote quote="&lt;img src=x onerror=alert(1)&gt; une citation assez longue pour compter" author-name="&lt;b&gt;Nom&lt;/b&gt;"></x-quote>');
      expect(body.querySelector('blockquote img, blockquote b')).toBeNull();
      expect(norm(body.querySelector('blockquote')!.textContent)).toContain('<img src=x onerror=alert(1)>');
    });

    it('RM-02 : mille `<noscript>` vidéo sous un même parent ne relisent pas mille fois ce parent', () => {
      const d = parse(`<!doctype html><html><body><div id="box">${'<noscript><iframe src="https://www.youtube.com/embed/abcdefghijk"></iframe></noscript>'.repeat(1000)}</div></body></html>`);
      const box = d.getElementById('box') as unknown as Element & { querySelectorAll: (s: string) => unknown };
      let reads = 0;
      const original = box.querySelectorAll.bind(box);
      box.querySelectorAll = (selector: string) => { reads++; return original(selector); };
      resolveLazyImages(d.documentElement as unknown as Element);
      expect(reads).toBeLessThanOrEqual(2);
      // Le premier lecteur est sorti de son `<noscript>`, les suivants y restent (rien à côté n'en montrait).
      expect(Array.from(d.querySelectorAll('#box > iframe'))).toHaveLength(1);
    });

    it('RM-04 : une citation que l’élément montre déjà, ou que son parent porte aussi, n’est pas doublée ; une vidéo non plus', () => {
      const Q = 'Cette citation de client est assez longue pour être une vraie citation.';
      const shown = resolved(`<x-testimonial quote="${Q}" author-name="Jeanne"><figure><p class="said">${Q}</p><figcaption>Jeanne</figcaption></figure></x-testimonial>`);
      expect(shown.querySelectorAll('blockquote')).toHaveLength(0);
      const nested = resolved(`<x-quote-card quote="${Q}"><x-quote quote="${Q}"></x-quote></x-quote-card><x-video-card or-mp4-video-url="https://cdn.example.com/demo.mp4"><x-video-player or-mp4-video-url="https://cdn.example.com/demo.mp4"></x-video-player></x-video-card>`);
      expect(nested.querySelectorAll('blockquote')).toHaveLength(1);
      expect(nested.querySelectorAll('video')).toHaveLength(1);
      const html = doc(`<article><h1>Le titre de l’article</h1>${paragraphs(1, 4)}<x-testimonial quote="${Q}" author-name="Jeanne"><figure><p class="said">${Q}</p><figcaption>Jeanne</figcaption></figure></x-testimonial>${paragraphs(10, 3)}</article>`);
      expect(occurrences(textOf(extractArticle(URL_, html)!.content), Q)).toBe(1);
    });

    it('RM-05 : l’image du `<noscript>` d’une `<picture>` vide ne double pas une image voisine de la même photo', () => {
      const body = resolved('<figure><picture data-lazy><noscript><img src="https://cdn.example.com/b.jpg" alt="B"></noscript></picture><img class="lazyload" data-src="https://cdn.example.com/b.jpg?w=800" alt="B"><figcaption>Légende B</figcaption></figure>');
      expect(body.querySelectorAll('img:not(noscript img)')).toHaveLength(1);
    });

    it('un aperçu dont le `data-srcset` n’a pas de largeurs garde son `src` et prend le `srcset`', () => {
      const body = resolved('<img src="https://cdn.example.com/p-small.jpg" data-srcset="https://cdn.example.com/p.jpg 1x, https://cdn.example.com/p@2x.jpg 2x">');
      const img = body.querySelector('img')!;
      expect(img.getAttribute('src')).toBe('https://cdn.example.com/p-small.jpg');
      expect(img.getAttribute('srcset')).toContain('p@2x.jpg');
    });
  });

  // REG-246 : un dossier de Clubic dont Readability ne garde que le début.
  // La garde remet la SUITE du corps (les `div.slate-content` qui ont le
  // gabarit des derniers blocs lus) ; les photos rangées entre deux blocs de
  // cette suite (`div.image-content` > `<picture>` + `<figcaption>`, sans ce
  // gabarit) restaient dehors : 5 photos sur 7, 4 légendes sur 8.
  const row = (inner: string) => `<div class="grid-default"><div class="row-wrapper row">${inner}</div></div>`;
  const slate = (inner: string) => row(`<div class="slate-content col-slate-12">${inner}</div>`);
  const clubicFigure = (n: number, caption = `Légende de la photo ${n} ©Crédit`) => `<div><div class="row-wrapper row"><div><div class="image-content"><span role="presentation"><div style="display:contents"><picture class="article img-wrapper lazy" data-lazy="{&quot;imageId&quot;:${n}}"><div class="image-loading"><svg width="50" height="50"><circle r="4"></circle></svg></div><noscript><img src="//pic.example.com/ab${n}24716${n}/858x636/smart/ia-drive.jpg" alt="${caption}" width="858" height="636"></noscript></picture></div></span><figcaption class="pvih72-0">${caption}</figcaption></div></div></div></div>`;
  const photo = (n: number) => `https://pic.example.com/ab${n}24716${n}/858x636/smart/ia-drive.jpg`;
  const suitePage = (between: (n: number) => string, after = '') => doc(`<article><h1>Le titre de l’article</h1>${slate(paragraphs(1, 3))}${clubicFigure(1)}${slate(paragraphs(4, 3))}${between(2)}${slate(paragraphs(7, 3))}${between(3)}${slate(paragraphs(10, 3))}${after}</article>`);
  const guarded = (page: string) => guardForTests({ page, result: `<div class="page">${paragraphs(1, 6)}</div>`, title: 'Le titre de l’article' }).content;

  describe(`${prefix}médias de la suite du corps (REG-246)`, () => {
    it('les photos et leurs légendes rangées entre deux blocs de la suite reviennent, chacune à sa place (dossier de Clubic)', () => {
      const out = guarded(suitePage((n) => clubicFigure(n)));
      const text = textOf(out);
      const srcs = all(out, 'img').map((img) => img.getAttribute('src'));
      for (const n of [1, 2, 3]) {
        expect(srcs.filter((src) => src === photo(n)), `photo ${n}`).toHaveLength(1);
        expect(occurrences(text, `Légende de la photo ${n} ©Crédit`), `légende ${n}`).toBe(1);
      }
      // L'ordre de la page : paragraphe 6, photo 2 et sa légende, paragraphe 7 ; paragraphe 9, photo 3, paragraphe 10.
      expect(text.indexOf(sentence(6, 'Paragraphe'))).toBeLessThan(text.indexOf('Légende de la photo 2'));
      expect(text.indexOf('Légende de la photo 2')).toBeLessThan(text.indexOf(sentence(7, 'Paragraphe')));
      expect(text.indexOf(sentence(9, 'Paragraphe'))).toBeLessThan(text.indexOf('Légende de la photo 3'));
      expect(text.indexOf('Légende de la photo 3')).toBeLessThan(text.indexOf(sentence(10, 'Paragraphe')));
      expect(out.indexOf(photo(2))).toBeLessThan(out.indexOf('Légende de la photo 2'));
    });

    it('un crédit court répété sous chaque photo revient sous chacune, dans le corps comme dans la suite (« ©Carrefour »)', () => {
      const page = doc(`<article><h1>Le titre de l’article</h1>${slate(paragraphs(1, 3))}${clubicFigure(1, '©Carrefour')}${slate(paragraphs(4, 3))}${clubicFigure(2, '©Carrefour')}${slate(paragraphs(7, 3))}${clubicFigure(3, '©Carrefour')}${slate(paragraphs(10, 3))}</article>`);
      const out = guarded(page);
      for (const n of [1, 2, 3]) expect(all(out, 'img').filter((img) => img.getAttribute('src') === photo(n)), `photo ${n}`).toHaveLength(1);
      expect(all(out, 'figcaption').map((caption) => norm(caption.textContent))).toEqual(['©Carrefour', '©Carrefour', '©Carrefour']);
      // Chacun sous sa photo.
      for (const n of [1, 2, 3]) expect(out.indexOf('©Carrefour', out.indexOf(photo(n)))).toBeLessThan(n < 3 ? out.indexOf(photo(n + 1)) : Infinity);
    });

    it('une vidéo intégrée entre deux blocs de la suite revient aussi', () => {
      const out = guarded(suitePage((n) => `<div><div class="row-wrapper row"><div class="embed"><iframe src="https://www.youtube.com/embed/abcdefghij${n}" width="560" height="315"></iframe></div></div></div>`));
      for (const n of [2, 3]) expect(out, `vidéo ${n}`).toContain(`youtube.com/embed/abcdefghij${n}`);
    });
  });

  describe(`${prefix}médias de la suite du corps — formes qui pourraient casser (REG-246)`, () => {
    it('une bannière liée vers un partenaire, et sa mention « Publicité », ne reviennent pas', () => {
      const ad = (n: number) => `<div><div class="row-wrapper row"><figure class="wp-block-image"><a href="https://partner.example/offre-${n}?utm_source=site"><img src="https://ads.example.net/banniere-${n}.jpg" width="728" height="300" alt=""></a><figcaption>Publicité</figcaption></figure></div></div>`;
      const out = guarded(suitePage(ad));
      expect(out).not.toContain('banniere-2.jpg');
      expect(out).not.toContain('banniere-3.jpg');
      expect(textOf(out)).not.toContain('Publicité');
      // La suite elle-même revient.
      expect(textOf(out)).toContain(sentence(12, 'Paragraphe'));
    });

    it('une carte « à lire aussi » (vignette et titre lié) entre deux blocs de la suite ne revient pas', () => {
      const card = (n: number) => `<div><div class="row-wrapper row"><div class="related-card"><picture><img src="https://pic.example.com/carte-${n}/400x225/smart/autre.jpg" width="400" height="225" alt=""></picture><h3><a href="https://example.com/autre-article-${n}">Un autre article à lire sur le site ${n}</a></h3></div></div></div>`;
      const out = guarded(suitePage(card));
      expect(out).not.toContain('carte-2/');
      expect(out).not.toContain('carte-3/');
      expect(textOf(out)).not.toContain('Un autre article à lire');
    });

    it('une photo APRÈS la fin du corps (logos de partenaires, puis un encart d’un autre gabarit) ne revient pas', () => {
      const after = `${row('<div class="partners"><picture><img src="https://pic.example.com/partenaire/600x300/smart/logo-partenaire.png" width="600" height="300" alt=""></picture></div>')}${row('<div class="newsletter-box"><p>Recevez chaque matin nos meilleurs articles directement dans votre boîte mail.</p></div>')}<div><picture><img src="https://pic.example.com/fin/900x500/smart/derniere.jpg" width="900" height="500" alt=""></picture></div>`;
      const out = guarded(suitePage((n) => clubicFigure(n), after));
      expect(out).toContain(photo(3));
      expect(out).not.toContain('logo-partenaire.png');
      expect(out).not.toContain('derniere.jpg');
    });

    it('un résultat qui lit déjà la photo de la suite ne la reçoit pas deux fois', () => {
      const page = suitePage((n) => clubicFigure(n));
      const out = guardForTests({ page, result: `<div class="page">${paragraphs(1, 6)}<img src="${photo(2)}"></div>`, title: 'Le titre de l’article' }).content;
      expect(all(out, 'img').filter((img) => img.getAttribute('src') === photo(2))).toHaveLength(1);
      // Une photo et sa légende que le résultat porte déjà à leur place : ni l'une ni l'autre deux fois.
      const placed = guardForTests({ page, result: `<div class="page">${paragraphs(1, 3)}<img src="${photo(1)}"><figcaption>Légende de la photo 1 ©Crédit</figcaption>${paragraphs(4, 3)}</div>`, title: 'Le titre de l’article' }).content;
      expect(all(placed, 'img').filter((img) => img.getAttribute('src') === photo(1))).toHaveLength(1);
      expect(occurrences(textOf(placed), 'Légende de la photo 1 ©Crédit')).toBe(1);
    });

    it('un crédit qui n’est pas la légende d’une photo remise suit la règle de toujours : lu ailleurs, il ne revient pas', () => {
      // « Photo : AFP » seul dans la suite, sans image à côté, déjà lu dans le résultat.
      const page = doc(`<article><h1>Le titre de l’article</h1>${slate(`${paragraphs(1, 3)}<p>Photo : AFP / Jean Dupont, reportage</p>`)}${slate(paragraphs(4, 3))}<div><figcaption>Photo : AFP / Jean Dupont, reportage</figcaption></div>${slate(paragraphs(7, 3))}</article>`);
      const out = guardForTests({ page, result: `<div class="page">${paragraphs(1, 3)}<p>Photo : AFP / Jean Dupont, reportage</p>${paragraphs(4, 3)}</div>`, title: 'Le titre de l’article' }).content;
      expect(occurrences(textOf(out), 'Photo : AFP / Jean Dupont, reportage')).toBe(1);
      expect(textOf(out)).toContain(sentence(9, 'Paragraphe'));
    });
  });

  // REG-247 : Les Numériques place dans l'en-tête de l'article le bouton
  // « Ajoutez-nous à vos favoris Google » (lien vers
  // `google.com/preferences/source`, écrit en `<span data-a-link>`), dont le
  // logo est un `.svg` sans taille : le volet l'affichait sur toute sa largeur.
  const lnHeader = (button: string) => doc(`<article><section><h1>Le titre de l’article</h1><div><p><time datetime="2026-11-07">Publié le 07/11/26 à 14h14</time></p></div><div><p><span>Nos réseaux :</span></p><p>${button}</p></div><header><p>${sentence(0, 'Chapeau')}</p></header></section><div class="content">${paragraphs(1, 6)}</div></article>`);
  const prefButton = (attr: string) => `<span ${attr}="https://www.google.com/preferences/source?q=example.com&amp;hl=fr_FR" data-target="_blank"><img src="https://cdn.example.com/assets/build/img/svg/logo-google.svg"><span>Ajoutez nous à vos favoris Google</span></span>`;

  describe(`${prefix}logo du bouton « source préférée » de Google (REG-247)`, () => {
    it('le logo du bouton ne passe pas dans l’article, quelle que soit la forme du lien (Les Numériques)', () => {
      for (const button of [prefButton('data-a-link'), `<a href="https://www.google.com/preferences/source?q=example.com"><img src="https://cdn.example.com/g.svg" alt="Google"> Ajoutez-nous sur Google</a>`]) {
        const out = extractArticle(URL_, lnHeader(button))!.content;
        expect(out, button).not.toMatch(/logo-google\.svg|\/g\.svg/);
        expect(textOf(out)).toContain(sentence(1, 'Paragraphe'));
      }
    });
  });

  describe(`${prefix}logo du bouton « source préférée » de Google — formes qui pourraient casser (REG-247)`, () => {
    it('le logo d’une marque dont parle l’article, en `.svg` sans taille, reste', () => {
      const html = doc(`<article><h1>Le titre de l’article</h1>${paragraphs(1, 3)}<figure><img src="https://cdn.example.com/2026/11/nouveau-logo-google.svg" alt="Le nouveau logo de Google"><figcaption>Le nouveau logo de Google, dévoilé ce matin.</figcaption></figure>${paragraphs(4, 3)}</article>`);
      expect(extractArticle(URL_, html)!.content).toContain('nouveau-logo-google.svg');
    });

    it('une image liée à une autre page de Google (recherche, Actualités) n’est pas touchée', () => {
      const body = parse(`<!doctype html><html><body><article><h1>Le titre de l’article</h1>${paragraphs(1, 3)}<figure><a href="https://news.google.com/publications/abc"><img src="https://cdn.example.com/capture-google-actualites.png" width="1200" height="800" alt="Google Actualités"></a><figcaption>La page de Google Actualités.</figcaption></figure>${paragraphs(4, 3)}</article></body></html>`);
      const before = body.querySelectorAll('img').length;
      const out = extractArticle(URL_, body.documentElement.outerHTML)!.content;
      expect(before).toBe(1);
      expect(out).toContain('capture-google-actualites.png');
    });
  });
}
