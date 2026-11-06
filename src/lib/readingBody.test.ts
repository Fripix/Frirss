// Ce que le volet de lecture montre à la place de l'article, et quand.
import { describe, it, expect } from 'vitest';
import { extractWorthShowing, hasRenderableContent, readingBodyKind, showsSkeleton, showsReadingTime } from './readingBody';

const RSS = '<p>Le début de l’article, tel que le flux le livre.</p>';
const FULL = '<p>Le texte complet, extrait de la page.</p>';

describe('hasRenderableContent', () => {
  it('reconnaît du texte', () => {
    expect(hasRenderableContent(RSS)).toBe(true);
  });
  it('reconnaît une image seule — un article illustré n’est pas vide', () => {
    expect(hasRenderableContent('<p><img src="https://example.com/a.jpg"></p>')).toBe(true);
  });
  it('écarte le vide, le blanc et les paragraphes creux', () => {
    expect(hasRenderableContent(null)).toBe(false);
    expect(hasRenderableContent('')).toBe(false);
    expect(hasRenderableContent('   \n ')).toBe(false);
    expect(hasRenderableContent('<p>&nbsp;</p><p><br></p>')).toBe(false);
    expect(hasRenderableContent('<div class="x"></div>')).toBe(false);
  });
});

describe('readingBodyKind', () => {
  it('montre l’extraction dès qu’elle existe', () => {
    expect(readingBodyKind({ rssHtml: RSS, extractedHtml: FULL, autoExtract: true })).toBe('extract');
  });

  it('montre le FLUX pendant que l’extraction se prépare — c’est le point', () => {
    expect(readingBodyKind({ rssHtml: RSS, extractedHtml: null, autoExtract: true })).toBe('rss');
  });

  it('ne garde le squelette que s’il n’y a vraiment rien à montrer', () => {
    expect(readingBodyKind({ rssHtml: '', extractedHtml: null, autoExtract: true })).toBe('skeleton');
    expect(readingBodyKind({ rssHtml: '<p>&nbsp;</p>', extractedHtml: null, autoExtract: true })).toBe('skeleton');
  });

  it('sans extraction automatique, un article vide reste vide — rien n’arrive', () => {
    expect(readingBodyKind({ rssHtml: '', extractedHtml: null, autoExtract: false })).toBe('rss');
  });

  it('une extraction vide ne remplace pas le flux', () => {
    expect(readingBodyKind({ rssHtml: RSS, extractedHtml: '  ', autoExtract: true })).toBe('rss');
  });

  it('une extraction vide sur un article vide laisse le squelette', () => {
    expect(readingBodyKind({ rssHtml: '', extractedHtml: '', autoExtract: true })).toBe('skeleton');
  });

  // L-04 : sur un avis du CERT-FR, l'« article complet » ne gardait que la
  // section « Solutions » quand le flux portait tout le texte — une perte
  // silencieuse. Un extrait qui n'a même pas la moitié du texte du flux n'est
  // pas l'article complet : le flux reste.
  it('garde le flux quand l’extrait a moins de la moitié de son texte', () => {
    const longRss = `<p>${'Le flux livre ici tout le texte de l’avis. '.repeat(20)}</p>`;
    expect(readingBodyKind({ rssHtml: longRss, extractedHtml: '<h2>Solutions</h2><p>Voir l’éditeur.</p>', autoExtract: true })).toBe('rss');
  });

  // Relecture 1.9.0 : la garde ne vaut que pour l'extraction automatique. Une
  // demande explicite du lecteur (« Article complet ») montre l'extrait, même
  // court : sinon rien ne changeait à l'écran et le bouton passait à « Contenu RSS ».
  it('montre l’extrait court quand le lecteur l’a demandé', () => {
    const longRss = `<p>${'Le flux livre ici tout le texte de l’avis. '.repeat(20)}</p>`;
    expect(readingBodyKind({ rssHtml: longRss, extractedHtml: '<h2>Solutions</h2><p>Voir l’éditeur.</p>', autoExtract: false, forced: true })).toBe('extract');
  });

  it('même demandé, un extrait vide ne remplace pas le flux', () => {
    expect(readingBodyKind({ rssHtml: RSS, extractedHtml: '  ', autoExtract: false, forced: true })).toBe('rss');
  });

  it('prend l’extrait dès qu’il pèse au moins la moitié du flux', () => {
    expect(readingBodyKind({ rssHtml: RSS, extractedHtml: FULL, autoExtract: true })).toBe('extract');
  });
});

describe('extractWorthShowing', () => {
  it('compte le texte, pas le balisage', () => {
    const rss = '<p>un deux trois quatre</p>';
    const heavy = `<div class="${'x'.repeat(500)}"><p>un</p></div>`;
    expect(extractWorthShowing(rss, heavy)).toBe(false);
  });

  it('un extrait sans flux à comparer est toujours bon, s’il n’est pas vide', () => {
    expect(extractWorthShowing('', FULL)).toBe(true);
    expect(extractWorthShowing(null, '<p>&nbsp;</p>')).toBe(false);
  });
});

// A2 (campagne 1.9.0, troisième round) : sur un billet très court, l'extrait
// était l'habillage du site (colonne, « Sponsor me »), plus long que le flux —
// la garde de la moitié laissait passer. Un extrait qui ne reprend presque
// rien du texte du flux n'est pas l'article : le flux reste.
describe('extractWorthShowing — l’extrait doit contenir le texte du flux (A2)', () => {
  const feed = '<p>Corrige un défaut qui touchait le site de démonstration : la liste des modèles disponibles n’était pas restreinte à ceux que la configuration autorise, et le greffon les proposait tous, même ceux qu’aucune clé ne permettait d’utiliser. <a href="https://example.com/notes">Notes de version</a></p>';
  const chrome = '<p>Ceci est une brève publiée le quatre novembre.</p><p>Lettre mensuelle</p><p>Soutenez-moi pour dix francs par mois et recevez chaque mois un résumé choisi des nouveautés les plus importantes, avec moins de courriels.</p><p>Payez-moi pour en recevoir moins !</p>';

  it('n’affiche pas automatiquement un extrait qui ne reprend presque rien du flux', () => {
    expect(extractWorthShowing(feed, chrome)).toBe(false);
    expect(readingBodyKind({ rssHtml: feed, extractedHtml: chrome, autoExtract: true })).toBe('rss');
  });

  it('le montre quand le lecteur l’a demandé', () => {
    expect(readingBodyKind({ rssHtml: feed, extractedHtml: chrome, autoExtract: false, forced: true })).toBe('extract');
  });

  it('garde un extrait qui contient le texte du flux, même entouré d’autre chose', () => {
    expect(extractWorthShowing(feed, `<h1>Version 0.1</h1>${feed}${chrome}`)).toBe(true);
  });

  it('garde un extrait qui n’a qu’une partie du texte du flux', () => {
    // Ars Technica : le chapeau du flux manque à l'extrait, qui porte la suite.
    const lead = '<p>Les élus ont demandé au patron du fabricant de puces de venir expliquer devant une commission comment ses clients du nuage accèdent à des informations sensibles. Les présidents des trois commissions ont écrit cette semaine pour fixer une audition à huis clos le dix-huit novembre.</p>';
    const rest = '<p>Les clients du nuage régional reçoivent des informations ordinaires, ont répondu les porte-parole. Les élus veulent comprendre les protocoles de sécurité du fabricant et les inspections menées sur place. La commission rappelle les soupçons de contrebande de puces qui pèsent sur un partenaire.</p>'.repeat(2);
    expect(extractWorthShowing(lead, rest)).toBe(true);
  });

  it('ne juge pas un flux trop court, ni un flux fait de liens (agrégateur)', () => {
    expect(extractWorthShowing('<p>Une brève de quelques mots.</p>', chrome)).toBe(true);
    const aggregator = '<p>Article URL: <a href="https://example.com/2026/11/une-longue-adresse-d-article-avec-beaucoup-de-mots-dedans-pour-depasser-largement-le-compte-minimal">https://example.com/2026/11/une-longue-adresse-d-article-avec-beaucoup-de-mots-dedans-pour-depasser-largement-le-compte-minimal</a></p><p>Comments URL: <a href="https://news.example.com/item?id=4242">https://news.example.com/item?id=4242</a></p><p>Points: 12</p><p># Comments: 3</p>';
    expect(extractWorthShowing(aggregator, chrome)).toBe(true);
  });

  it('lit les entités du flux comme les lettres de l’extrait', () => {
    const accented = 'évènement désespéré réécrire éléphant téléphone écrémé bébé épée fée thé café été élève étoile écrire énergie émission épisode équipe établi étage étude évaluer général intérêt déçu';
    const encoded = `<p>${accented.replace(/é/g, '&eacute;').replace(/è/g, '&#232;').replace(/ç/g, '&#xe7;').replace(/ê/g, '&ecirc;')}</p>`;
    expect(extractWorthShowing(encoded, `<p>${accented}.</p>`)).toBe(true);
  });
});

describe('showsSkeleton / showsReadingTime', () => {
  it('le squelette et la pastille de durée sont exclusifs', () => {
    const waiting = { rssHtml: '', extractedHtml: null, autoExtract: true };
    expect(showsSkeleton(waiting)).toBe(true);
    expect(showsReadingTime(waiting)).toBe(false);
  });

  it('la durée s’affiche dès qu’il y a du texte, extraction ou non', () => {
    const rssOnly = { rssHtml: RSS, extractedHtml: null, autoExtract: true };
    expect(showsSkeleton(rssOnly)).toBe(false);
    expect(showsReadingTime(rssOnly)).toBe(true);
  });
});
