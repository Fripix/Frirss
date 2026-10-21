// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildArticleBody, displayedHtml, readingMinutes } from './articleBody';
import { rememberImageSize, forgetMeasuredSizes } from './imageAspect';

const labels = { play: 'Lire', open: 'Ouvrir' };
const build = (rssHtml: string | null, extractedHtml: string | null = null, inlineVideos = false) =>
  buildArticleBody({ rssHtml, extractedHtml, inlineVideos, videoLabels: labels });

describe('displayedHtml', () => {
  it('garde le flux tant qu’il n’y a pas d’extraction', () => {
    expect(displayedHtml('<p>flux</p>', null)).toBe('<p>flux</p>');
  });

  it('préfère l’extraction quand elle existe', () => {
    expect(displayedHtml('<p>flux</p>', '<p>complet</p>')).toBe('<p>complet</p>');
  });

  it('réinjecte l’image d’en-tête que l’extraction a perdue', () => {
    const out = displayedHtml('<img src="https://example.com/hero.jpg"><p>flux</p>', '<p>complet</p>');
    expect(out).toBe('<img src="https://example.com/hero.jpg" alt="" /><p>complet</p>');
  });

  it('ne la réinjecte pas si l’extraction la contient déjà', () => {
    const out = displayedHtml(
      '<img src="https://example.com/hero.jpg">',
      '<p>a</p><img src="https://example.com/hero.jpg">',
    );
    expect(out.match(/hero\.jpg/g)).toHaveLength(1);
  });

  // L'URL réinjectée est recopiée dans un attribut : elle ne doit jamais
  // pouvoir en sortir. La capture s'arrête déjà au premier guillemet, et
  // l'échappement qui suit ferme le cas restant.
  it('ne laisse pas une URL s’échapper de l’attribut src', () => {
    const out = displayedHtml('<img src=\'https://example.com/a"b.jpg\'>', '<p>x</p>');
    expect(out).toBe('<img src="https://example.com/a" alt="" /><p>x</p>');
  });

  it('tolère un article sans contenu du tout', () => {
    expect(displayedHtml(null, null)).toBe('');
  });
});

// La réservation du format se fait sur l'arbre assaini (`reserveImgAspect`,
// `imageAspect.ts`), dans la même passe que le reste : on l'observe donc sur
// le corps construit.
describe('réservation du format des images', () => {
  const body = (html: string) => build(html).html;

  it('déclare aspect-ratio quand l’image annonce ses dimensions', () => {
    expect(body('<img src="a.jpg" width="800" height="450">'))
      .toBe('<img src="a.jpg" width="800" height="450" style="aspect-ratio:800/450">');
  });

  it('complète un style existant au lieu de l’écraser', () => {
    expect(body('<img style="border:0" src="a.jpg" width="4" height="3">'))
      .toBe('<img style="border:0;aspect-ratio:4/3" src="a.jpg" width="4" height="3">');
  });

  it('laisse l’image intacte sans dimensions utilisables', () => {
    expect(body('<img src="a.jpg" width="0" height="10">'))
      .toBe('<img src="a.jpg" width="0" height="10">');
  });

  it('retire les paragraphes vides autour de l’image d’en-tête', () => {
    expect(body('<p> </p><p>texte</p>')).toBe('<p dir="auto">texte</p>');
    expect(body('<p>&nbsp;<br></p><img src="a.jpg"><p><br/></p><p>texte</p>'))
      .toBe('<img src="a.jpg"><p dir="auto">texte</p>');
  });

  it('retire les <br> et blancs de tête', () => {
    expect(body('<br>&nbsp; <br/>  début <p>texte</p>')).toBe('début <p dir="auto">texte</p>');
  });

  it('garde un paragraphe qui porte autre chose que des blancs', () => {
    expect(body('<p><img src="a.jpg"></p>')).toBe('<p dir="auto"><img src="a.jpg"></p>');
  });

  // Beaucoup de flux n'annoncent pas les dimensions. Le réchauffage en avant
  // les MESURE au chargement : la place est alors réservée sans rien deviner.
  describe('avec une mesure du réchauffage', () => {
    beforeEach(() => forgetMeasuredSizes());
    afterEach(() => forgetMeasuredSizes());

    it('réserve la place d’une image sans attributs, une fois mesurée', () => {
      rememberImageSize('https://ex.com/hero.jpg', 1200, 800);
      expect(body('<img src="https://ex.com/hero.jpg">'))
        .toBe('<img src="https://ex.com/hero.jpg" style="aspect-ratio:1200/800">');
    });

    it('retrouve la mesure malgré l’échappement du flux', () => {
      rememberImageSize('https://ex.com/h.jpg?w=1&h=2', 800, 600);
      expect(body('<img src="https://ex.com/h.jpg?w=1&amp;h=2">'))
        .toContain('aspect-ratio:800/600');
    });

    it('laisse les attributs de la balise l’emporter', () => {
      rememberImageSize('https://ex.com/hero.jpg', 1200, 800);
      expect(body('<img src="https://ex.com/hero.jpg" width="4" height="3">'))
        .toContain('aspect-ratio:4/3');
    });

    it('ne touche à rien tant que l’image n’a pas été mesurée', () => {
      expect(body('<img src="https://ex.com/jamais-vue.jpg">'))
        .toBe('<img src="https://ex.com/jamais-vue.jpg">');
    });

    // Le motif d'avant posait `style="…"` sur un `<img` écrit DANS une valeur
    // d'attribut : le guillemet refermait la valeur, après DOMPurify.
    it('ne réserve rien pour un <img> écrit dans une valeur d’attribut', () => {
      rememberImageSize('https://ex.com/q.jpg', 4, 3);
      const html = body('<p><a title="<img src=\'https://ex.com/q.jpg\' onmouseover=alert(1) x" href="https://example.com/">t</a></p>');
      const a = new DOMParser().parseFromString(html, 'text/html').querySelector('a')!;
      expect([...a.attributes].map((x) => x.name).sort()).toEqual(['href', 'title']);
      expect(html).not.toContain('aspect-ratio');
    });
  });
});

describe('readingMinutes', () => {
  it('ne descend jamais sous une minute', () => {
    expect(readingMinutes(0)).toBe(1);
    expect(readingMinutes(12)).toBe(1);
  });

  it('compte 200 mots par minute', () => {
    expect(readingMinutes(600)).toBe(3);
  });
});

describe('buildArticleBody', () => {
  it('assainit le HTML du flux', () => {
    expect(build('<p>ok</p><script>alert(1)</script>').html).not.toContain('script');
  });

  it('laisse les deux premières images se charger, diffère les suivantes', () => {
    const html = build('<img src="1.jpg"><img src="2.jpg"><img src="3.jpg">').html;
    expect(html.match(/loading="lazy"/g)).toHaveLength(1);
    expect(html).toContain('<img src="3.jpg" loading="lazy">');
  });

  it('donne sa direction à chaque bloc', () => {
    expect(build('<p>a</p><h2>b</h2><li>c</li>').html)
      .toBe('<p dir="auto">a</p><h2 dir="auto">b</h2><li dir="auto">c</li>');
  });

  it('ne double pas un dir déjà présent', () => {
    expect(build('<p dir="rtl">a</p>').html).toBe('<p dir="rtl">a</p>');
  });

  it('donne sa direction aux citations et légendes, et à tous les titres', () => {
    expect(build('<blockquote>a</blockquote><figure><figcaption>b</figcaption></figure><h1>c</h1><h6>d</h6>').html)
      .toBe('<blockquote dir="auto">a</blockquote><figure><figcaption dir="auto">b</figcaption></figure><h1 dir="auto">c</h1><h6 dir="auto">d</h6>');
  });

  // Le motif d'avant n'avait pas de borne après le nom : `<pre>` devenait
  // `<p dir="auto"re>` et `<picture>` `<p dir="auto"icture>`.
  it('laisse intacts <pre> et <picture>', () => {
    const html = build('<pre>x  y</pre><picture><source srcset="https://example.com/a.webp"><img src="https://example.com/a.jpg"></picture>').html;
    expect(html).toContain('<pre>x  y</pre>');
    expect(html).toContain('<picture><source srcset="https://example.com/a.webp"><img src="https://example.com/a.jpg"></picture>');
    expect(html).not.toContain('dir="auto"re');
    expect(html).not.toContain('dir="auto"icture');
  });

  // Un motif sur le HTML sérialisé trouve aussi `<p` ou `<img` DANS la valeur
  // d'un attribut, là où le sérialiseur n'échappe pas `<` (jsdom, navigateurs
  // d'avant 2025) : les guillemets ajoutés refermaient la valeur, et le reste
  // devenait des attributs — un gestionnaire d'événement après DOMPurify.
  it('ne touche jamais l’intérieur d’une valeur d’attribut', () => {
    const attrsOf = (html: string, sel: string) => {
      const el = new DOMParser().parseFromString(html, 'text/html').querySelector(sel)!;
      return [...el.attributes].map((a) => a.name).sort();
    };
    const dirTrap = build('<p><a title="<p onmouseover=alert(1) x" href="https://example.com/">t</a></p>').html;
    expect(attrsOf(dirTrap, 'a')).toEqual(['href', 'title']);
    expect(new DOMParser().parseFromString(dirTrap, 'text/html').querySelector('a')!.title).toBe('<p onmouseover=alert(1) x');
    const imgTrap = build('<img src="1.jpg"><img src="2.jpg"><img src="3.jpg"><a title="<img onmouseover=alert(1) x" href="https://example.com/">t</a>').html;
    expect(attrsOf(imgTrap, 'a')).toEqual(['href', 'title']);
    expect(new DOMParser().parseFromString(imgTrap, 'text/html').querySelector('a')!.title).toBe('<img onmouseover=alert(1) x');
  });

  // La réservation de format et le ménage des paragraphes vides étaient eux
  // aussi des motifs sur le HTML sérialisé, APRÈS DOMPurify : `<img` dans un
  // `title` recevait un `style="…"` dont le guillemet refermait la valeur, et
  // le paragraphe « vide » se refermait sur le `<p` d'un `alt`.
  it('réserve le format sans toucher l’intérieur d’une valeur d’attribut', () => {
    const html = build('<p><a title="<img width=1 height=1 onmouseover=alert(1) x" href="https://example.com/">t</a></p>').html;
    const a = new DOMParser().parseFromString(html, 'text/html').querySelector('a')!;
    expect([...a.attributes].map((x) => x.name).sort()).toEqual(['href', 'title']);
    expect(a.title).toBe('<img width=1 height=1 onmouseover=alert(1) x');
  });

  it('retire les paragraphes vides sans avaler le balisage qui suit', () => {
    const html = build('<p><img alt="<p" src="https://example.com/a.jpg">  </p><p>keep me</p>').html;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelector('img')!.getAttribute('src')).toBe('https://example.com/a.jpg');
    expect(doc.querySelector('img')!.getAttribute('alt')).toBe('<p');
    expect([...doc.querySelectorAll('p')].map((p) => p.textContent)).toContain('keep me');
  });

  it('compte les mots du contenu affiché, pas du balisage', () => {
    expect(build('<p>un deux trois</p>', '<p>un deux trois quatre</p>').words).toBe(4);
  });

  it('signale les vidéos du corps quand les façades sont actives', () => {
    const out = build('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>', null, true);
    expect(out.videoIds).toEqual(['dQw4w9WgXcQ']);
    expect(out.html).toContain('yt-facade');
  });

  it('n’injecte aucune façade quand le réglage est éteint', () => {
    const out = build('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>', null, false);
    expect(out.videoIds).toEqual([]);
    expect(out.html).not.toContain('yt-facade');
  });

  // Le cœur du correctif : le volet mémoïse sur ce résultat, donc deux appels
  // identiques doivent produire la MÊME chaîne, au caractère près. Un
  // compteur d'images qui survivrait d'un appel à l'autre suffirait à la
  // faire dériver — et à faire réécrire tout le corps à chaque rendu.
  it('est déterministe : deux appels identiques rendent la même chaîne', () => {
    const input = '<img src="1.jpg"><img src="2.jpg"><img src="3.jpg"><p>texte</p>';
    expect(build(input).html).toBe(build(input).html);
    expect(build(input).html).toBe(build(input).html);
  });
});

// Le volet montre désormais le contenu du flux pendant que l'extraction se
// prépare, puis bascule (voir `src/lib/readingBody.ts`). Cette bascule réécrit
// le corps une fois : si l'URL de l'image d'en-tête changeait au passage, le
// navigateur repartirait chercher une image, et le lecteur verrait un trou
// blanc là où il avait déjà l'illustration. Elle doit rester identique.
describe('bascule flux → extraction', () => {
  const heroSrc = (html: string) => html.match(/<img[^>]+src="([^"]+)"/i)?.[1];
  const rss = '<p>flux</p><img src="https://example.com/hero.jpg" width="800" height="450">';

  it('garde la même URL d’image d’en-tête avant et après la bascule', () => {
    const before = heroSrc(build(rss).html);
    expect(before).toBe('https://example.com/hero.jpg');
    // Extraction qui a perdu l'image : `displayedHtml` la réinjecte.
    expect(heroSrc(build(rss, '<p>complet</p>').html)).toBe(before);
    // Extraction qui la porte déjà : même URL, pas de doublon.
    const kept = build(rss, '<p>complet</p><img src="https://example.com/hero.jpg">').html;
    expect(heroSrc(kept)).toBe(before);
    expect(kept.match(/hero\.jpg/g)).toHaveLength(1);
  });
});

describe('vignette de façade vidéo', () => {
  const ID = 'dQw4w9WgXcQ';
  const THUMB = `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`;
  const thumbTag = (html: string) =>
    html.match(/<img\b[^>]*yt-facade__thumb[^>]*>/i)?.[0] ?? '';

  afterEach(() => forgetMeasuredSizes());

  it("ne réserve pas de format sur la vignette, même une fois mesurée", () => {
    // Le réchauffage mesure l'image d'en-tête d'un article de flux YouTube :
    // c'est EXACTEMENT l'URL que la façade réutilise (`youtubeThumbnail`).
    rememberImageSize(THUMB, 480, 360);
    const out = build(`<p><a href="https://www.youtube.com/watch?v=${ID}">v</a></p>`, null, true);
    expect(out.html).toContain('yt-facade__thumb');
    // 480×360 est du 4:3, la boîte de la façade est en 16:9 : la déclaration
    // ne décrirait rien de vrai. Elle n'a pas d'effet visible — la CSS fixe
    // les deux dimensions — mais un mécanisme prévu pour les images d'un flux
    // n'a rien à faire sur du balisage que nous produisons nous-mêmes.
    expect(thumbTag(out.html)).not.toContain('aspect-ratio');
  });

  it("laisse les images de l'article, elles", () => {
    rememberImageSize('https://example.com/hero.jpg', 1200, 800);
    const out = build('<p><img src="https://example.com/hero.jpg"></p>', null, true);
    expect(out.html).toContain('aspect-ratio:1200/800');
  });
});
