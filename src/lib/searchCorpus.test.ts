import { describe, it, expect } from 'vitest';
import {
  CORPUS_TTL_MS,
  createCorpus,
  addPage,
  corpusIsUsable,
  corpusMatches,
  patchCorpusArticle,
  type CorpusEntry,
} from './searchCorpus';
import type { Article } from '../types';

const art = (id: string, title: string, over: Partial<Article> = {}): Article => ({
  id, title, summary: '', content: '', author: '', url: `https://example.com/${id}`,
  source: 'Flux', sourceId: 'feed/1', published: 0, read: false, starred: false,
  labels: [], tags: [], ...over,
});

const entry = (id: string, title: string, over: Partial<Article> = {}): CorpusEntry => ({
  article: art(id, title, over),
  haystack: title.toLowerCase(),
});

describe('corpus', () => {
  it('accumule les pages et retient la continuation', () => {
    let c = createCorpus('feed/1', '7', 1_000);
    c = addPage(c, [entry('a', 'alpha')], 'CONT1', 1_100);
    expect(c.entries).toHaveLength(1);
    expect(c.continuation).toBe('CONT1');
    expect(c.complete).toBe(false);
  });

  it('se declare complet quand la continuation tombe', () => {
    let c = createCorpus('feed/1', '7', 1_000);
    c = addPage(c, [entry('a', 'alpha')], null, 1_100);
    expect(c.complete).toBe(true);
  });

  it('deduplique par identifiant un flux qui bouge livre deux fois le meme article', () => {
    let c = createCorpus('feed/1', '7', 1_000);
    c = addPage(c, [entry('a', 'alpha')], 'CONT1', 1_100);
    c = addPage(c, [entry('a', 'alpha'), entry('b', 'beta')], null, 1_200);
    expect(c.entries.map((e) => e.article.id)).toEqual(['a', 'b']);
  });
});

describe('corpusIsUsable', () => {
  const complete = () => addPage(createCorpus('feed/1', '7', 0), [entry('a', 'alpha')], null, 1_000);

  it('accepte un corpus complet, frais, du bon perimetre et du bon serveur', () => {
    expect(corpusIsUsable(complete(), 'feed/1', '7', 1_000 + CORPUS_TTL_MS - 1)).toBe(true);
  });

  it('accepte un corpus exactement a la limite de perennite TTL', () => {
    expect(corpusIsUsable(complete(), 'feed/1', '7', 1_000 + CORPUS_TTL_MS)).toBe(true);
  });

  it('refuse un corpus perime', () => {
    expect(corpusIsUsable(complete(), 'feed/1', '7', 1_000 + CORPUS_TTL_MS + 1)).toBe(false);
  });

  it('refuse un autre perimetre', () => {
    expect(corpusIsUsable(complete(), 'feed/2', '7', 1_000)).toBe(false);
  });

  it('refuse un autre serveur ses articles decrivent un autre monde', () => {
    expect(corpusIsUsable(complete(), 'feed/1', '8', 1_000)).toBe(false);
  });

  it('refuse un corpus incomplet il ne prouve pas une absence', () => {
    const partial = addPage(createCorpus('feed/1', '7', 0), [entry('a', 'alpha')], 'CONT1', 1_000);
    expect(corpusIsUsable(partial, 'feed/1', '7', 1_000)).toBe(false);
  });

  it('refuse un corpus absent', () => {
    expect(corpusIsUsable(null, 'feed/1', '7', 0)).toBe(false);
  });
});

describe('corpusMatches', () => {
  it('rend les articles correspondants dans l ordre du corpus', () => {
    let c = createCorpus('feed/1', '7', 0);
    c = addPage(c, [entry('a', 'alpha moteur'), entry('b', 'beta'), entry('c', 'gamma moteur')], null, 0);
    expect(corpusMatches(c, ['moteur']).map((a) => a.id)).toEqual(['a', 'c']);
  });
});

describe('patchCorpusArticle', () => {
  it('met a jour l article garde sinon la recherche suivante ressortirait l ancien etat', () => {
    let c = createCorpus('feed/1', '7', 0);
    c = addPage(c, [entry('a', 'alpha')], null, 0);
    c = patchCorpusArticle(c, 'a', { read: true });
    expect(c.entries[0].article.read).toBe(true);
  });

  it('ignore un identifiant inconnu', () => {
    let c = createCorpus('feed/1', '7', 0);
    c = addPage(c, [entry('a', 'alpha')], null, 0);
    expect(patchCorpusArticle(c, 'zzz', { read: true }).entries[0].article.read).toBe(false);
  });
});
