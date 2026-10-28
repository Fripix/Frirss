// @vitest-environment jsdom
//
// jsdom : `stripHtml` décode les entités avec le décodeur HTML du navigateur
// (voir `decodeEntities`), comme dans l'app.
import { describe, it, expect, vi } from 'vitest';
import {
  normalizeForSearch,
  stripHtml,
  parseQuery,
  articleHaystack,
  matchesTerms,
} from './searchMatch';
import type { Article } from '../types';

const article = (over: Partial<Article> = {}): Article => ({
  id: 'a1',
  title: 'Titre',
  summary: '',
  content: '',
  author: '',
  url: 'https://example.com/a1',
  source: 'Flux',
  sourceId: 'feed/1',
  published: 0,
  read: false,
  starred: false,
  labels: [],
  tags: [],
  ...over,
});

describe('normalizeForSearch', () => {
  it('replie la casse et les accents', () => {
    expect(normalizeForSearch('Élection')).toBe('election');
    expect(normalizeForSearch('ÉTÉ')).toBe('ete');
  });
});

describe('stripHtml', () => {
  it('retire les balises sans coller les mots', () => {
    expect(stripHtml('<p>Bonjour <b>le</b> monde</p>')).toBe('Bonjour le monde');
  });

  it('ne colle pas les mots quand deux balises sont adjacentes', () => {
    expect(stripHtml('<b>moteur</b><i>recherche</i>')).toBe('moteur recherche');
  });

  it('décode les entités', () => {
    expect(stripHtml('l&#39;été &amp; la pluie')).toBe("l'été & la pluie");
  });

  // Six entités nommées seulement jusqu'ici : « &eacute;t&eacute; » restait
  // tel quel dans le texte cherchable, et « été » ne le trouvait pas.
  it('décode toutes les entités nommées, pas seulement les six de base', () => {
    expect(stripHtml('&eacute;t&eacute;')).toBe('été');
    expect(stripHtml('l&rsquo;avion')).toBe('l’avion');
    expect(stripHtml('la suite&hellip;')).toBe('la suite…');
  });

  // `String.fromCodePoint` levait une RangeError hors plage : l'erreur
  // remontait jusqu'au balayage et le faisait échouer pour tout le flux.
  it('ne lève pas sur une entité numérique hors plage', () => {
    expect(() => stripHtml('a &#99999999; b &#x110000; c')).not.toThrow();
    expect(stripHtml('a &#99999999; b')).toBe('a \uFFFD b');
    expect(stripHtml('a &#x110000; b')).toBe('a \uFFFD b');
  });

  it('sans DOM (Node), se replie sur les entités de base sans jamais lever', () => {
    vi.stubGlobal('document', undefined);
    try {
      expect(stripHtml('l&#39;été &amp; &#99999999; &eacute;')).toBe("l'été & \uFFFD &eacute;");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('ne garde pas le contenu des <script> et <style>', () => {
    const text = stripHtml('<p>avant</p><script>var cache = "moteur";</script><style>.a { color: red }</style><p>après</p>');
    expect(text).toBe('avant après');
  });

  it('retire aussi un <script> jamais refermé', () => {
    expect(stripHtml('texte <script>var cache = "moteur";')).toBe('texte');
  });

  it('reste linéaire sur un balisage pathologique', () => {
    const evil = '<script '.repeat(20_000);
    const t0 = performance.now();
    stripHtml(evil);
    expect(performance.now() - t0).toBeLessThan(1_000);
  });

  // Mesure, pas un seuil : jsdom n'a pas la vitesse d'un navigateur. Les
  // chiffres de Chrome sont consignés dans le commit qui a choisi la méthode.
  it('mesure 10 000 articles synthétiques (non bloquant)', () => {
    const para = '<p>Le moteur de recherche l&rsquo;&eacute;t&eacute; &amp; <a href="https://example.com/?a=1&amp;b=2">lien</a> <b>gras</b><i>it</i> la suite&hellip; &#x2014; &nbsp;fin</p>';
    const html = para.repeat(15);
    const t0 = performance.now();
    let len = 0;
    for (let i = 0; i < 10_000; i++) len += articleHaystack(article({ title: `Titre ${i} l&rsquo;&eacute;t&eacute;`, content: html })).length;
    const ms = performance.now() - t0;
    console.info(`[stripHtml] 10 000 articles (${html.length} car.) : ${ms.toFixed(0)} ms`);
    expect(len).toBeGreaterThan(0);
  });
});

describe('parseQuery', () => {
  it('rend les mots normalisés, sans doublon ni vide', () => {
    expect(parseQuery('  Moteur   RECHERCHE moteur ')).toEqual(['moteur', 'recherche']);
  });

  it('rend un tableau vide pour une requête blanche', () => {
    expect(parseQuery('   ')).toEqual([]);
  });
});

describe('matchesTerms', () => {
  it('trouve les mots dans le désordre', () => {
    const hay = articleHaystack(article({ title: 'Le moteur de recherche' }));
    expect(matchesTerms(hay, parseQuery('recherche moteur'))).toBe(true);
  });

  it('exige TOUS les mots', () => {
    const hay = articleHaystack(article({ title: 'Le moteur de recherche' }));
    expect(matchesTerms(hay, parseQuery('moteur diesel'))).toBe(false);
  });

  it('cherche aussi dans le texte, accents pliés dans les deux sens', () => {
    const hay = articleHaystack(article({ title: 'Brève', content: '<p>Une élection serrée</p>' }));
    expect(matchesTerms(hay, parseQuery('election'))).toBe(true);
    expect(matchesTerms(hay, parseQuery('élection'))).toBe(true);
  });

  it('ne matche pas le balisage', () => {
    const hay = articleHaystack(article({ content: '<a href="https://example.com/x">lien</a>' }));
    expect(matchesTerms(hay, parseQuery('href'))).toBe(false);
    expect(matchesTerms(hay, parseQuery('lien'))).toBe(true);
  });

  it('retombe sur le résumé quand le contenu est vide', () => {
    const hay = articleHaystack(article({ content: '', summary: '<p>Résumé parlant</p>' }));
    expect(matchesTerms(hay, parseQuery('parlant'))).toBe(true);
  });

  it('ne matche rien sans terme', () => {
    expect(matchesTerms(articleHaystack(article()), [])).toBe(false);
  });
});
