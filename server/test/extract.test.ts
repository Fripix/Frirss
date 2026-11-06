import { describe, it, expect } from 'vitest';
import { parseHTML } from 'linkedom';
import {
  extractArticle, EXTRACT_MAX_PENDING, ExtractorBusyError, extractPending, stripBoilerplate, withExtractSlot,
} from '../extract.js';
import { advisoryPageHtml, ADVISORY_BODY_MARKER } from '../../src/test/advisoryPageFixture.js';
import { blogPageHtml, BLOG_BODY_MARKER, newsPageHtml } from '../../src/test/boilerplatePageFixtures.js';

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

  it('laisse intact un article que Readability a déjà bien extrait', () => {
    // Le conteneur unique contient le corps ; rien à reprendre.
    const out = extractArticle('https://example.com/a', page);
    expect(out!.content).toContain('second paragraphe');
  });

  it('rend null quand la page n’a pas d’article lisible', () => {
    const out = extractArticle('https://example.com/a', '<html><body></body></html>');
    expect(out).toBeNull();
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
