import { describe, it, expect } from 'vitest';
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

  it('décode les entités', () => {
    expect(stripHtml('l&#39;été &amp; la pluie')).toBe("l'été & la pluie");
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
