// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildArticleBody, displayedHtml, opensOnImage, readingMinutes } from './articleBody';
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

  // REG-227 : Frandroid donne au flux `…-1200x800.jpg?resize=1200,675&key=…`
  // et à la page `….jpg?resize=1200&amp;key=…` — la même photo, à la taille
  // près. Comparées telles quelles, elle s'affichait deux fois.
  it('ne la réinjecte pas si l’extraction contient la même image à une autre taille (REG-227)', () => {
    const out = displayedHtml(
      '<img src="https://img.example.com/images.example.com/up/velo-1200x800.jpg?resize=1200,675&amp;key=9c833cf8"><p>flux</p>',
      '<figure><img src="https://img.example.com/images.example.com/up/velo.jpg?resize=1200&amp;key=513fa488"></figure><p>complet</p>',
    );
    expect(out.match(/velo/g)).toHaveLength(1);
  });

  it('reconnaît l’image de tête dans le srcset de l’extrait, sur un autre hôte (REG-227)', () => {
    const out = displayedHtml(
      '<img src="https://images.example.com/up/velo-300x200.jpg">',
      '<img src="https://img.example.com/proxy/velo.jpg?resize=1200" srcset="https://images.example.com/up/velo-1200x800.jpg 1200w, https://images.example.com/up/velo-768x512.jpg 768w"><p>complet</p>',
    );
    expect(out.startsWith('<img src="https://images.example.com/up/velo-300x200.jpg"')).toBe(false);
  });

  // Depuis REG-245, une image dans les premiers blocs de l'extrait est SON
  // image d'en-tête : l'autre photo du corps est ici placée plus loin.
  it('réinjecte toujours une image de tête qui est une autre photo que celles de l’extrait (REG-227)', () => {
    const rest = '<p>Le premier paragraphe du corps.</p><p>Le deuxième paragraphe du corps.</p><p>Le troisième paragraphe du corps.</p><figure><img src="https://example.com/up/corps-1200x675.jpg"></figure><p>complet</p>';
    const out = displayedHtml('<img src="https://example.com/up/une-1200x675.jpg"><p>flux</p>', rest);
    expect(out).toBe(`<img src="https://example.com/up/une-1200x675.jpg" alt="" />${rest}`);
  });

  // REG-245 : The Verge donne au flux la photo d'en-tête dans un autre
  // recadrage (`crop=`) que la page, Clubic sous une autre adresse
  // (`/v1/images/2471365/raw` contre `/b7c53e582471365/1600x900/smart/…`) :
  // le volet la remettait au-dessus de celle de l'extrait, deux fois la photo.
  it('ne la réinjecte pas quand l’extrait ouvre sur sa propre image d’en-tête, même une autre photo (REG-245)', () => {
    const verge = displayedHtml(
      '<img src="https://platform.example.com/wp-content/uploads/sites/2/2026/11/muse.png?quality=90&amp;strip=all&amp;crop=0,0,100,100"><p>flux</p>',
      '<div><p><a href="/auteur"><img alt="Emma" width="36" height="36" src="https://platform.example.com/author/emma.jpg?w=96"></a></p><p>Le chapeau.</p><p>Par Emma</p><img alt="muse" srcset="https://platform.example.com/wp-content/uploads/sites/2/2026/11/muse.png?quality=90&amp;strip=all&amp;crop=9.1,0,89.7,74.4&amp;w=376 376w"><p>Le corps.</p></div>',
    );
    expect(verge.match(/muse\.png/g)).toHaveLength(1);
    const other = displayedHtml(
      '<img src="https://example.com/up/une.jpg"><p>flux</p>',
      `<p>${'Un long chapeau. '.repeat(20)}</p><picture><img src="https://example.com/up/en-tete.jpg" width="1200" height="675"></picture><p>corps</p>`,
    );
    expect(other).not.toContain('une.jpg');
  });

  it('ne la réinjecte pas quand l’extrait porte la même photo sous une autre adresse du même hôte (Clubic, REG-245)', () => {
    const rest = '<p>Le premier paragraphe du corps.</p><p>Le deuxième paragraphe du corps.</p><p>Le troisième paragraphe du corps.</p><p>Le quatrième paragraphe du corps.</p><img src="https://pic.example.com/b7c53e582471365/1600x900/smart/blackfriday.png"><p>fin</p>';
    expect(displayedHtml('<img src="https://pic.example.com/v1/images/2471365/raw"><p>flux</p>', rest)).toBe(rest);
    const cropped = '<p>Le premier paragraphe du corps.</p><p>Le deuxième paragraphe du corps.</p><p>Le troisième paragraphe du corps.</p><p>Le quatrième paragraphe du corps.</p><img src="https://cdn.example.com/2026/11/muse.png?crop=1,2,3,4&amp;w=376"><p>fin</p>';
    expect(displayedHtml('<img src="https://cdn.example.com/2026/11/muse.png?crop=0,0,100,100"><p>flux</p>', cropped)).toBe(cropped);
  });

  it('réinjecte une autre photo : même hôte et même dossier de date, autre hôte et même numéro, icône en tête (REG-245)', () => {
    const late = (img: string) => `<p>Le premier paragraphe du corps.</p><p>Le deuxième paragraphe du corps.</p><p>Le troisième paragraphe du corps.</p>${img}<p>fin</p>`;
    const sameFolder = late('<img src="https://cdn.example.com/images/20261107/b.jpg">');
    expect(displayedHtml('<img src="https://cdn.example.com/images/20261107/a.jpg">', sameFolder)).toContain('20261107/a.jpg');
    const otherHost = late('<img src="https://cdn.other.example/b7c53e582471365/photo.png">');
    expect(displayedHtml('<img src="https://pic.example.com/v1/images/2471365/raw">', otherHost)).toContain('2471365/raw');
    const icon = '<p><img src="https://cdn.example.com/avatar.jpg" width="36" height="36"></p><p>Le premier paragraphe du corps.</p><p>Le deuxième paragraphe du corps.</p><p>Le troisième paragraphe du corps.</p>';
    expect(displayedHtml('<img src="https://cdn.example.com/une.jpg">', icon)).toContain('une.jpg');
  });

  // RM-01 : un numéro de DOSSIER (l'article, le site, un horodatage) est
  // commun à toutes les photos de l'article : il ne désigne pas la photo du
  // flux. Les Numériques perdait ainsi la photo du flux que l'extrait n'avait pas.
  it('réinjecte la photo du flux quand le numéro commun est celui du dossier, du site ou d’une heure (RM-01)', () => {
    const late = (img: string) => `<p>Le premier paragraphe du corps.</p><p>Le deuxième paragraphe du corps.</p><p>Le troisième paragraphe du corps.</p><p>Le quatrième paragraphe du corps.</p>${img}<p>fin</p>`;
    const cases: Array<[string, string]> = [
      ['https://cdn.example.com/optim/test/26/266748/01bbd4d7-humidificateur__400_400.jpg', 'https://cdn.example.com/optim/test/26/266748/9e96ef1c-vue-de-dos__1200_675.jpg'],
      ['https://images.example.com/content/v1/5c2e9f8a1234567b8c9d0e1f/1730987654321-ABCDEF/hero.jpg', 'https://images.example.com/content/v1/5c2e9f8a1234567b8c9d0e1f/1730987600000-XYZ/inline-chart.jpg'],
      ['https://cdn.example.com/articles/2471365/hero.jpg', 'https://cdn.example.com/articles/2471365/photo-2.jpg'],
      ['https://site.example/wp-content/uploads/2026/11/IMG_20261105_143012.jpg', 'https://site.example/wp-content/uploads/2026/11/PXL_20261104_143012.jpg'],
      ['https://res.example.com/demo/image/upload/v1730987654/news/hero.jpg', 'https://res.example.com/demo/image/upload/v1730987654/news/other.jpg'],
    ];
    for (const [feed, inside] of cases) {
      expect(displayedHtml(`<img src="${feed}"><p>flux</p>`, late(`<img src="${inside}">`)), feed).toContain(feed);
    }
  });

  it('un numéro d’image que deux images de l’extrait partagent ne prouve rien : la photo du flux revient (RM-01)', () => {
    const two = '<p>Le premier paragraphe du corps.</p><p>Le deuxième paragraphe du corps.</p><p>Le troisième paragraphe du corps.</p><img src="https://pic.example.com/aa12471365/800x450/smart/a.png"><p>x</p><img src="https://pic.example.com/bb92471365/800x450/smart/b.png"><p>fin</p>';
    expect(displayedHtml('<img src="https://pic.example.com/v1/images/2471365/raw">', two)).toContain('/v1/images/2471365/raw');
  });

  // RM-03 : un bloc compte pour son texte visible, quelle que soit sa première balise ;
  // une image sans taille connue, un logo `.svg`, un pixel de suivi ne sont pas une photo d'en-tête.
  it('n’est pas « ouvert sur une image » quand les paragraphes s’ouvrent sur une balise, ni par un pixel ou un logo (RM-03)', () => {
    const s = (n: number) => `Phrase ${n} : un texte de paragraphe assez long pour compter.`;
    const strong = `<div>${[1, 2, 3, 4, 5, 6].map((n) => `<p><strong>Point ${n}.</strong> ${s(n)}</p>`).join('')}<figure><img src="https://cdn.example.com/chart.png" width="800" height="400"></figure></div>`;
    expect(opensOnImage(strong)).toBe(false);
    const span = `<div>${[1, 2, 3, 4].map((n) => `<p><span>${s(n)}</span></p>`).join('')}<p><img src="https://cdn.example.com/inline.png" width="800" height="400"></p></div>`;
    expect(opensOnImage(span)).toBe(false);
    const divs = `${[1, 2, 3].map((n) => `<div>${s(n)}</div>`).join('')}<img src="https://cdn.example.com/late.png" width="800" height="400">`;
    expect(opensOnImage(divs)).toBe(false);
    expect(opensOnImage(`<div><img src="https://feeds.example.com/~r/site/~4/abcdef"><p>${s(1)}</p></div>`)).toBe(false);
    expect(opensOnImage(`<p>${s(1)}</p><img src="https://cdn.example.com/build/img/svg/logo-google.svg"><p>${s(2)}</p>`)).toBe(false);
    expect(opensOnImage(`<p>${s(1)}</p><img src="https://cdn.example.com/p.gif" width="1" height="1"><p>${s(2)}</p>`)).toBe(false);
    expect(displayedHtml('<img src="https://cdn.example.com/hero-photo.jpg"><p>flux</p>', strong)).toContain('hero-photo');
    // Une photo de taille connue (attributs, `srcset` à largeurs, taille dans l'adresse) en tête l'est toujours.
    expect(opensOnImage('<p><strong>Chapeau</strong> du billet.</p><img src="https://cdn.example.com/x/1600x900/smart/h.png">')).toBe(true);
    expect(opensOnImage('<p>Chapeau.</p><img srcset="https://cdn.example.com/h.png?w=376 376w">')).toBe(true);
    // Une date, un séparateur, une signature ne sont pas des blocs de texte : l'en-tête du blog de Google.
    expect(opensOnImage('<div><p>Nov 05, 2026</p><span>|</span><p>Le chapeau du billet, une phrase entière qui le résume.</p><img src="https://cdn.example.com/hero.width-1600.format-webp.webp"></div>')).toBe(true);
  });

  // REG-247 : Les Numériques donne au flux la photo d'origine (`…serveurs.jpg`)
  // et à la page ses tailles recadrées (`…serveurs__1200_678__8-48-2066-1208.jpg`,
  // `__908_512__…`, la vignette carrée `__800_800__611-0-1878-1267`) ; trois
  // blocs de texte (publicité, date, « favoris Google ») précèdent la photo de
  // l'extrait : le volet la remettait au-dessus, deux fois la photo.
  it('ne la réinjecte pas quand l’extrait porte la même photo à un suffixe de taille et de recadrage près (Les Numériques, REG-247)', () => {
    const dir = 'https://cdn.example.com/optim/news/26/263992';
    const late = (img: string) => `<p>Publicité, votre contenu continue ci-dessous</p><p>Publié le 07/11/26 à 14h14</p><p>Ajoutez nous à vos favoris Google</p><p>Le chapeau de l’article, assez long pour compter.</p>${img}<p>fin</p>`;
    const page = late(`<img src="${dir}/db06c9ca-aspirateur-robot-romo-p2__1200_678__8-48-2066-1208.jpg" width="908" height="512">`);
    expect(displayedHtml(`<img src="${dir}/db06c9ca-aspirateur-robot-romo-p2.jpg"><p>flux</p>`, page)).toBe(page);
    expect(displayedHtml(`<img src="${dir}/db06c9ca-aspirateur-robot-romo-p2__800_800__611-0-1878-1267.jpg"><p>flux</p>`, page)).toBe(page);
    expect(displayedHtml(`<img src="${dir}/db06c9ca-aspirateur-robot-romo-p2__800_800__overflow.jpg"><p>flux</p>`, page)).toBe(page);
  });

  it('réinjecte une autre photo au même suffixe de taille, ou sous un double soulignement qui n’est pas une taille (REG-247)', () => {
    const dir = 'https://cdn.example.com/optim/news/26/263992';
    const late = (img: string) => `<p>Le premier paragraphe du corps.</p><p>Le deuxième paragraphe du corps.</p><p>Le troisième paragraphe du corps.</p>${img}<p>fin</p>`;
    // Deux vraies photos, même article, même taille, même recadrage : deux noms.
    const other = late(`<img src="${dir}/55f071c1-le-robot-lave-le-sol__1200_678__8-48-2066-1208.jpg">`);
    expect(displayedHtml(`<img src="${dir}/db06c9ca-aspirateur-robot-romo-p2__1200_678__8-48-2066-1208.jpg">`, other)).toContain('db06c9ca-');
    // Un double soulignement qui n'est pas une taille : `photo__v2`, `rapport__2026_q3`.
    expect(displayedHtml('<img src="https://cdn.example.com/a/photo__v2.jpg">', late('<img src="https://cdn.example.com/a/photo.jpg">'))).toContain('photo__v2.jpg');
    expect(displayedHtml('<img src="https://cdn.example.com/a/rapport__2026_q3.jpg">', late('<img src="https://cdn.example.com/a/rapport__2026_q2.jpg">'))).toContain('rapport__2026_q3.jpg');
  });

  it('ne la réinjecte pas quand le flux donne la même photo plus grande que l’extrait (REG-245)', () => {
    const rest = '<p>Le premier paragraphe du corps.</p><p>Le deuxième paragraphe du corps.</p><p>Le troisième paragraphe du corps.</p><img src="https://example.com/up/photo-640x360.jpg"><p>fin</p>';
    expect(displayedHtml('<img src="https://example.com/up/photo-1600x900.jpg">', rest)).toBe(rest);
  });

  it('réinjecte une image servie par un script dont la requête est l’identité (REG-227)', () => {
    // L'autre photo est placée après les premiers blocs : en tête, elle serait
    // l'image d'en-tête de l'extrait (REG-245).
    const out = displayedHtml(
      '<img src="https://example.com/image.php?id=1&amp;w=1200">',
      '<p>Le premier paragraphe du corps.</p><p>Le deuxième paragraphe du corps.</p><p>Le troisième paragraphe du corps.</p><img src="https://example.com/image.php?id=2&amp;w=1200&amp;crop=1"><p>complet</p>',
    );
    expect(out.match(/image\.php/g)).toHaveLength(2);
  });

  // L'URL réinjectée est recopiée dans un attribut : elle ne doit jamais
  // pouvoir en sortir. La capture s'arrête déjà au premier guillemet, et
  // l'échappement qui suit ferme le cas restant.
  it('ne laisse pas une URL s’échapper de l’attribut src', () => {
    const out = displayedHtml('<img src=\'https://example.com/a"b.jpg\'>', '<p>x</p>');
    expect(out).toBe('<img src="https://example.com/a" alt="" /><p>x</p>');
  });

  // L-04 : même règle que `readingBodyKind` — un extrait qui n'a même pas la
  // moitié du texte du flux n'est pas l'article complet.
  it('garde le flux quand l’extrait a moins de la moitié de son texte', () => {
    const longRss = `<p>${'Le flux livre ici tout le texte de l’avis. '.repeat(20)}</p>`;
    expect(displayedHtml(longRss, '<h2>Solutions</h2><p>Voir l’éditeur.</p>')).toBe(longRss);
  });

  it('montre l’extrait court quand le lecteur l’a demandé (forced)', () => {
    const longRss = `<p>${'Le flux livre ici tout le texte de l’avis. '.repeat(20)}</p>`;
    expect(displayedHtml(longRss, '<h2>Solutions</h2><p>Voir l’éditeur.</p>', { forced: true })).toBe('<h2>Solutions</h2><p>Voir l’éditeur.</p>');
    expect(buildArticleBody({ rssHtml: longRss, extractedHtml: '<p>Voir l’éditeur.</p>', extractForced: true, inlineVideos: false, videoLabels: labels }).html).toContain('Voir l’éditeur.');
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
      // `rel` et `target` sont posés exprès par le corps (nouvel onglet, issue #24) : seul le `title` doit rester intact.
      expect([...a.attributes].map((x) => x.name).sort()).toEqual(['href', 'rel', 'target', 'title']);
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
    expect(attrsOf(dirTrap, 'a')).toEqual(['href', 'rel', 'target', 'title']);
    expect(new DOMParser().parseFromString(dirTrap, 'text/html').querySelector('a')!.title).toBe('<p onmouseover=alert(1) x');
    const imgTrap = build('<img src="1.jpg"><img src="2.jpg"><img src="3.jpg"><a title="<img onmouseover=alert(1) x" href="https://example.com/">t</a>').html;
    expect(attrsOf(imgTrap, 'a')).toEqual(['href', 'rel', 'target', 'title']);
    expect(new DOMParser().parseFromString(imgTrap, 'text/html').querySelector('a')!.title).toBe('<img onmouseover=alert(1) x');
  });

  // La réservation de format et le ménage des paragraphes vides étaient eux
  // aussi des motifs sur le HTML sérialisé, APRÈS DOMPurify : `<img` dans un
  // `title` recevait un `style="…"` dont le guillemet refermait la valeur, et
  // le paragraphe « vide » se refermait sur le `<p` d'un `alt`.
  it('réserve le format sans toucher l’intérieur d’une valeur d’attribut', () => {
    const html = build('<p><a title="<img width=1 height=1 onmouseover=alert(1) x" href="https://example.com/">t</a></p>').html;
    const a = new DOMParser().parseFromString(html, 'text/html').querySelector('a')!;
    expect([...a.attributes].map((x) => x.name).sort()).toEqual(['href', 'rel', 'target', 'title']);
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
    const out = build(`<p>avant</p><iframe src="https://www.youtube.com/embed/${ID}"></iframe>`, null, true);
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

// L-08 : un article de flux YouTube porte, dans son contenu FreshRSS, la
// vignette de la vidéo (`img.enclosure-thumbnail`) ; le volet pose en tête la
// façade de la même vidéo, qui a sa propre vignette. L'image s'affichait deux
// fois, l'une sous l'autre.
describe('article de flux YouTube : vignette du flux', () => {
  const ID = 'dQw4w9WgXcQ';
  const rss = `<div class="enclosure"><p class="enclosure-content"><img class="enclosure-thumbnail" src="https://i3.ytimg.com/vi/${ID}/hqdefault.jpg" alt=""></p></div><p>description</p>`;
  const videoUrl = `https://www.youtube.com/watch?v=${ID}`;

  it('retire la vignette de la vidéo que la façade d’en-tête montre déjà', () => {
    const out = buildArticleBody({ rssHtml: rss, extractedHtml: null, inlineVideos: true, videoLabels: labels, videoUrl });
    expect(out.html).not.toContain('ytimg.com');
    expect(out.html).toContain('description');
  });

  it('la garde quand les façades sont éteintes : rien d’autre ne montre la vidéo', () => {
    const out = buildArticleBody({ rssHtml: rss, extractedHtml: null, inlineVideos: false, videoLabels: labels, videoUrl });
    expect(out.html).toContain(`ytimg.com/vi/${ID}/`);
  });

  it('garde la vignette quand l’adresse de l’article ne fait que porter celle de la vidéo (RO-01)', () => {
    for (const url of [`https://example.com/redirect?to=${videoUrl}`, `https://blog.example.com/why-youtu.be/${ID}-links`]) {
      const out = buildArticleBody({ rssHtml: rss, extractedHtml: null, inlineVideos: true, videoLabels: labels, videoUrl: url });
      expect(out.html, url).toContain(`ytimg.com/vi/${ID}/`);
    }
  });

  it('garde la vignette d’une AUTRE vidéo', () => {
    const other = rss.replace(`/vi/${ID}/`, '/vi/abcdefghijk/');
    const out = buildArticleBody({ rssHtml: other, extractedHtml: null, inlineVideos: true, videoLabels: labels, videoUrl });
    expect(out.html).toContain('ytimg.com/vi/abcdefghijk/');
  });
});
