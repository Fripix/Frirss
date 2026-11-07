import { describe, expect, it } from 'vitest';
import { embedId, extractMedia, judgeMedia, mediaContainer, pageMedia, shows } from './media.ts';
import { parseHTML } from 'linkedom';
import { compileAccepted } from './lib.ts';

const URL_ = 'https://example.com/a';
const P = '<p>Un paragraphe d’article assez long pour que le conteneur porte bien le texte de la page entière.</p>';
const page = (body: string, head = '<title>Titre</title>') => `<html><head>${head}</head><body><header><img src="/logo.png" width="300"><nav><a href="/">Accueil</a></nav></header>${body}<footer><img src="https://example.com/pied.jpg"></footer></body></html>`;
const article = (inner: string) => page(`<main><article>${P}${inner}${P}</article></main>`);
const kinds = (html: string) => pageMedia(html, URL_)!.map((m) => `${m.kind}:${m.ids[0]}`);

describe('pageMedia : ce que l’article montre', () => {
  it('ne compte que le conteneur de l’article, sans le pied ni l’en-tête du site', () => {
    expect(kinds(article('<img src="https://cdn.example.com/photo.jpg">'))).toEqual(['image:cdn.example.com/photo.jpg']);
  });

  it('écarte les icônes, logos, avatars, `data:` et ce que la page masque', () => {
    const html = article(`
      <img src="https://cdn.example.com/a.svg"><img src="https://cdn.example.com/b.jpg" width="40" height="40">
      <img class="author-avatar" src="https://cdn.example.com/c.jpg"><img src="data:image/gif;base64,R0lGOD">
      <div hidden><img src="https://cdn.example.com/d.jpg"></div><img src="https://cdn.example.com/vraie.jpg">`);
    expect(kinds(html)).toEqual(['image:cdn.example.com/vraie.jpg']);
  });

  it('une image paresseuse compte par ses adresses de réserve ; deux tailles d’une même photo en font une', () => {
    const html = article(`<img src="data:image/svg+xml,%3Csvg%3E" data-src="https://cdn.example.com/p.jpg?w=400">
      <img src="https://cdn.example.com/p.jpg?w=1200">`);
    const items = pageMedia(html, URL_)!;
    expect(items).toHaveLength(1);
    expect(items[0].ids).toContain('cdn.example.com/p.jpg');
  });

  it('une `<picture>` sans `<img>` compte par l’image de son `<noscript>` (Clubic) ; une image déjà montrée, non', () => {
    const lazy = article('<picture data-lazy="{}"><div class="loading"></div><noscript><img src="//pic.example.com/1/2500x1390/photo.jpg"></noscript></picture>');
    expect(kinds(lazy)).toEqual(['image:pic.example.com/1/2500x1390/photo.jpg']);
    const shown = article('<img src="https://cdn.example.com/x.jpg"><noscript><img src="https://cdn.example.com/x-autre.jpg"></noscript>');
    expect(kinds(shown)).toEqual(['image:cdn.example.com/x.jpg']);
  });

  it('vidéos, sons, vidéos intégrées (src ou data-src), tweets, citations, questions, tableaux', () => {
    const html = article(`
      <video controls src="https://cdn.example.com/demo.mp4"></video>
      <video autoplay muted loop playsinline src="https://cdn.example.com/fond.mp4"></video>
      <audio controls><source src="https://cdn.example.com/son.mp3"></audio>
      <iframe data-src="https://www.youtube.com/embed/qb8jZ5zNMrs?feature=oembed"></iframe>
      <iframe src="https://ads.example.net/banner"></iframe>
      <blockquote class="twitter-tweet"><p>Un tweet</p><a href="https://twitter.com/x/status/123456">date</a></blockquote>
      <blockquote><p>Une citation de client assez longue pour compter.</p></blockquote>
      <details><summary>Que vaut le prix conseillé ?</summary><p>Réponse.</p></details>
      <table><tr><td>Modèle de l’appareil</td><td>Prix</td></tr><tr><td>A</td><td>1 €</td></tr></table>`);
    expect(pageMedia(html, URL_)!.map((m) => m.kind)).toEqual(['video', 'audio', 'embed', 'tweet', 'quote', 'details', 'table']);
  });

  it('le texte d’une question ne lit pas la feuille de style posée dans son `<summary>` (Clubic)', () => {
    const html = article('<details><summary><style>.fJ{font-size:1px}</style><h3>Faut-il acheter maintenant ?</h3></summary><p>Réponse.</p></details>');
    expect(kinds(html)).toEqual(['details:faut il acheter maintenant']);
  });

  it('un élément personnalisé porte une vidéo ou une citation dans ses attributs (blog de Google)', () => {
    const html = article(`<uni-inline-image or-mp4-video-url="https://storage.example.com/v/Demo.mp4" poster-image-url="https://storage.example.com/p.webp"></uni-inline-image>
      <uni-quote-media-carousel quote="Creators have already been bringing their ideas to life." author-name="M. C."></uni-quote-media-carousel>`);
    expect(kinds(html)).toEqual(['video:storage.example.com/v/Demo.mp4', 'quote:creators have already been bringing their ideas to life']);
  });

  it('remonte jusqu’au titre pour l’image d’en-tête, sans ce qui suit le conteneur', () => {
    const html = page(`<div class="wrap"><h1>Titre</h1><img src="https://cdn.example.com/hero.jpg"><article>${P}${P}${P}</article><img src="https://cdn.example.com/apres.jpg"></div>`);
    expect(kinds(html)).toEqual(['image:cdn.example.com/hero.jpg']);
  });

  it('pas de conteneur (page de liste) : pas de mesure', () => {
    const html = page(`<div><article>${P}</article><article>${P}</article><article>${P}</article></div>`);
    expect(pageMedia(html, URL_)).toBeNull();
    expect(mediaContainer(parseHTML(page(`<main>${P}</main>`)).document as never)?.tagName.toLowerCase()).toBe('main');
  });
});

describe('extractMedia / shows : ce que l’extrait montre', () => {
  const items = pageMedia(article(`<img src="https://cdn.example.com/p.jpg?w=400"><iframe data-src="https://www.youtube.com/embed/qb8jZ5zNMrs"></iframe>
    <details><summary>Que vaut le prix conseillé ?</summary><p>Réponse.</p></details>`), URL_)!;
  const [img, embed, details] = items;

  it('une image se reconnaît à la taille près, mais pas par une adresse `data-*` (le volet les retire)', () => {
    expect(shows(extractMedia('<img src="https://cdn.example.com/p.jpg?w=1600">'), img)).toBe(true);
    expect(shows(extractMedia('<img data-src="https://cdn.example.com/p.jpg">'), img)).toBe(false);
  });

  it('une vidéo intégrée ne compte que par son `src`', () => {
    expect(shows(extractMedia('<iframe src="https://www.youtube-nocookie.com/embed/qb8jZ5zNMrs"></iframe>'), embed)).toBe(true);
    expect(shows(extractMedia('<iframe data-src="https://www.youtube.com/embed/qb8jZ5zNMrs"></iframe>'), embed)).toBe(false);
  });

  it('une question est montrée si son texte l’est, en `<summary>` ou en intertitre', () => {
    expect(shows(extractMedia('<h3>Que vaut le prix conseillé ?</h3><p>Réponse.</p>'), details)).toBe(true);
    expect(shows(extractMedia('<p>Réponse.</p>'), details)).toBe(false);
    // Collée au bloc précédent dans le balisage, elle reste un texte à part.
    expect(shows(extractMedia('<h2>FAQ</h2><details open><summary><h3>Que vaut le prix conseillé ?</h3></summary><p>Réponse.</p></details>'), details)).toBe(true);
  });

  it('un tweet se reconnaît dans l’extrait à son lien, sans la classe que Readability retire', () => {
    const [tweet] = pageMedia(article('<blockquote class="twitter-tweet"><p>Un tweet</p><a href="https://twitter.com/x/status/123456">date</a></blockquote>'), URL_)!;
    expect(shows(extractMedia('<blockquote><p>Un tweet</p><a href="https://twitter.com/x/status/123456">date</a></blockquote>'), tweet)).toBe(true);
    expect(shows(extractMedia('<p>Un tweet</p>'), tweet)).toBe(false);
  });

  it('le lecteur de synthèse vocale du site (`tts`) n’est pas un média de l’article', () => {
    const html = article('<div class="audio-player-tts"><audio controls src="https://cdn.example.com/tts_audio_1.mp3"></audio></div><audio controls src="https://cdn.example.com/podcast.mp3"></audio>');
    expect(kinds(html)).toEqual(['audio:cdn.example.com/podcast.mp3']);
  });

  it('une citation doit rester une citation', () => {
    const [quote] = pageMedia(article('<blockquote><p>Une citation de client assez longue pour compter.</p></blockquote>'), URL_)!;
    expect(shows(extractMedia('<blockquote><p>Une citation de client assez longue pour compter.</p><footer>— A</footer></blockquote>'), quote)).toBe(true);
    expect(shows(extractMedia('<p>Une citation de client assez longue pour compter.</p>'), quote)).toBe(false);
  });

  it('embedId lit YouTube, Vimeo et Dailymotion', () => {
    expect(embedId('https://www.youtube.com/watch?v=qb8jZ5zNMrs')).toBe('youtube:qb8jZ5zNMrs');
    expect(embedId('https://player.vimeo.com/video/76979871')).toBe('vimeo:76979871');
    expect(embedId('https://www.dailymotion.com/embed/video/x8abc')).toBe('dailymotion:x8abc');
    expect(embedId('https://ads.example.net/x')).toBeNull();
  });
});

describe('judgeMedia', () => {
  const items = pageMedia(article('<img src="https://cdn.example.com/a.jpg"><img src="https://cdn.example.com/b.jpg">'), URL_)!;

  it('une régression est un média que la base montrait et que la tête ne montre plus', () => {
    const v = judgeMedia(items, '<img src="https://cdn.example.com/a.jpg"><img src="https://cdn.example.com/b.jpg">', '<img src="https://cdn.example.com/a.jpg">');
    expect(v.page.image).toBe(2);
    expect(v.regressions.map((m) => m.label)).toEqual(['https://cdn.example.com/b.jpg']);
  });

  it('un média que les deux perdent est manquant, pas régressé ; un extrait absent n’est pas mesuré', () => {
    const v = judgeMedia(items, '<img src="https://cdn.example.com/a.jpg">', '<img src="https://cdn.example.com/a.jpg">');
    expect(v.regressions).toEqual([]);
    expect(v.headMissing!.map((m) => m.label)).toEqual(['https://cdn.example.com/b.jpg']);
    expect(judgeMedia(items, null, '<p>x</p>').baseMissing).toBeNull();
  });
});

describe('judgeMedia : retraits acceptés', () => {
  it('un média dont l’adresse absolue correspond à `accepted.json` n’est ni manquant ni régressé', () => {
    const items = pageMedia(article('<img src="/pub/encart.png"><img src="https://cdn.example.com/b.jpg">'), URL_)!;
    const rules = compileAccepted([{ pattern: '/^https:\\/\\/example\\.com\\/pub\\//', reason: 'encart publicitaire' }]);
    const v = judgeMedia(items, '<img src="https://example.com/pub/encart.png"><img src="https://cdn.example.com/b.jpg">', '<img src="https://cdn.example.com/b.jpg">', URL_, rules, 'example.com');
    expect(v.regressions).toEqual([]);
    expect(v.accepted.map((m) => m.reason)).toEqual(['encart publicitaire']);
    expect(v.page.image).toBe(1);
  });
});

describe('pageMedia : vignettes', () => {
  it('une image dont toutes les adresses demandent une petite taille est une vignette (carte, avatar)', () => {
    const html = article(`<img src="https://cdn.example.com/carte-192x192.jpg"><img src="https://cdn.example.com/auteur.jpg?w=150">
      <img src="https://cdn-avatars.example.com/u/1.png"><img src="https://cdn.example.com/photo-1200x675.jpg" srcset="https://cdn.example.com/photo-150x150.jpg 150w">`);
    expect(kinds(html)).toEqual(['image:cdn.example.com/photo.jpg']);
  });

  it('la photo de l’auteur (signature) n’est pas un média de l’article', () => {
    const html = article('<div class="author-bio"><img src="https://cdn.example.com/up/2016/05/j.brodkin.jpg"></div><a rel="author" href="/a"><img src="https://cdn.example.com/b.jpg"></a><img src="https://cdn.example.com/photo.jpg">');
    expect(kinds(html)).toEqual(['image:cdn.example.com/photo.jpg']);
  });
});
