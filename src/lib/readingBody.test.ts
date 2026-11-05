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
