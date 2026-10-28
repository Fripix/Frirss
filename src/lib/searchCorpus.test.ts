import { describe, it, expect, vi } from 'vitest';
import {
  CORPUS_TTL_MS,
  createCorpus,
  addPage,
  corpusIsUsable,
  corpusMatches,
  matchPage,
  newerEntries,
  prependEntries,
  patchCorpusArticle,
  patchCorpusByEntry,
  withLabel,
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

  it('se déclare complet quand la continuation tombe', () => {
    let c = createCorpus('feed/1', '7', 1_000);
    c = addPage(c, [entry('a', 'alpha')], null, 1_100);
    expect(c.complete).toBe(true);
  });

  it('déduplique par identifiant — un flux qui bouge livre deux fois le même article', () => {
    let c = createCorpus('feed/1', '7', 1_000);
    c = addPage(c, [entry('a', 'alpha')], 'CONT1', 1_100);
    c = addPage(c, [entry('a', 'alpha'), entry('b', 'beta')], null, 1_200);
    expect(c.entries.map((e) => e.article.id)).toEqual(['a', 'b']);
  });
});

describe('corpusIsUsable', () => {
  const complete = () => addPage(createCorpus('feed/1', '7', 0), [entry('a', 'alpha')], null, 1_000);

  it('accepte un corpus complet, frais, du bon périmètre et du bon serveur', () => {
    expect(corpusIsUsable(complete(), 'feed/1', '7', 1_000 + CORPUS_TTL_MS - 1)).toBe(true);
  });

  it('accepte un corpus exactement à la limite de fraîcheur', () => {
    expect(corpusIsUsable(complete(), 'feed/1', '7', 1_000 + CORPUS_TTL_MS)).toBe(true);
  });

  it('refuse un corpus périmé', () => {
    expect(corpusIsUsable(complete(), 'feed/1', '7', 1_000 + CORPUS_TTL_MS + 1)).toBe(false);
  });

  it('refuse un autre périmètre', () => {
    expect(corpusIsUsable(complete(), 'feed/2', '7', 1_000)).toBe(false);
  });

  it('refuse un autre serveur — ses articles décrivent un autre monde', () => {
    expect(corpusIsUsable(complete(), 'feed/1', '8', 1_000)).toBe(false);
  });

  it('refuse un corpus incomplet : il ne prouve pas une absence', () => {
    const partial = addPage(createCorpus('feed/1', '7', 0), [entry('a', 'alpha')], 'CONT1', 1_000);
    expect(corpusIsUsable(partial, 'feed/1', '7', 1_000)).toBe(false);
  });

  it('refuse un corpus absent', () => {
    expect(corpusIsUsable(null, 'feed/1', '7', 0)).toBe(false);
  });
});

describe('addPage — index des identifiants', () => {
  // Le `Set` des identifiants était reconstruit à CHAQUE page : à la dixième
  // tranche de 1 000, 9 000 insertions pour en écarter quelques-unes.
  it('dix tranches ne reconstruisent pas l’index : une insertion par article', () => {
    const tranche = (n: number) => Array.from({ length: 100 }, (_, i) => entry(`p${n}-${i}`, 'titre'));
    const add = vi.spyOn(Set.prototype, 'add');
    try {
      let c = createCorpus('feed/1', '7', 0);
      for (let n = 0; n < 10; n++) c = addPage(c, tranche(n), n < 9 ? `C${n}` : null, 0);
      expect(c.entries).toHaveLength(1_000);
      expect(add.mock.calls.length).toBe(1_000);
    } finally {
      add.mockRestore();
    }
  });

  it('écarte aussi un doublon à l’intérieur d’une même page', () => {
    const c = addPage(createCorpus('feed/1', '7', 0), [entry('a', 'alpha'), entry('a', 'alpha')], null, 0);
    expect(c.entries.map((e) => e.article.id)).toEqual(['a']);
  });

  // L'index est partagé entre versions successives : étendre une ANCIENNE
  // version ne doit pas se croire déjà au courant d'articles qu'elle n'a pas.
  it('reste juste quand on étend une version antérieure du corpus', () => {
    const v1 = addPage(createCorpus('feed/1', '7', 0), [entry('a', 'alpha')], 'C1', 0);
    addPage(v1, [entry('b', 'beta')], null, 0);
    const branche = addPage(v1, [entry('b', 'beta')], null, 0);
    expect(branche.entries.map((e) => e.article.id)).toEqual(['a', 'b']);
  });
});

describe('matchPage', () => {
  it('ne regarde que la tranche donnée', () => {
    const page = [entry('a', 'alpha moteur'), entry('b', 'beta'), entry('c', 'gamma moteur')];
    expect(matchPage(page, ['moteur']).map((a) => a.id)).toEqual(['a', 'c']);
    expect(matchPage([], ['moteur'])).toEqual([]);
  });
});

describe('newerEntries / prependEntries — compléter par le haut', () => {
  const base = () => addPage(createCorpus('feed/1', '7', 0), [entry('a', 'alpha'), entry('b', 'beta')], null, 0);

  it('prend le haut de la page jusqu’au premier article connu', () => {
    const { fresh, reachedKnown } = newerEntries(base(), [entry('n1', 'neuf'), entry('n2', 'neuf'), entry('a', 'alpha'), entry('x', 'jamais')]);
    expect(fresh.map((e) => e.article.id)).toEqual(['n1', 'n2']);
    expect(reachedKnown).toBe(true);
  });

  it('signale une page entièrement nouvelle', () => {
    const { fresh, reachedKnown } = newerEntries(base(), [entry('n1', 'neuf')]);
    expect(fresh).toHaveLength(1);
    expect(reachedKnown).toBe(false);
  });

  // Identifiants d'entrée réels : un article retiré du flux depuis le
  // balayage ne doit pas faire croire que tout ce qui suit est nouveau.
  it('s’arrête à un article plus ancien que le plus récent connu, même inconnu', () => {
    const c = addPage(createCorpus('feed/1', '7', 0), [entry('1788386439680600', 't')], null, 0);
    const { fresh, reachedKnown } = newerEntries(c, [entry('1788386439680700', 't'), entry('1788386439680550', 't')]);
    expect(fresh.map((e) => e.article.id)).toEqual(['1788386439680700']);
    expect(reachedKnown).toBe(true);
  });

  it('place les nouveaux en tête, sans doublon, et garde la date du balayage', () => {
    const c0 = base();
    const c = prependEntries(c0, [entry('n1', 'neuf'), entry('n1', 'neuf'), entry('a', 'alpha')]);
    expect(c.entries.map((e) => e.article.id)).toEqual(['n1', 'a', 'b']);
    expect(c.at).toBe(c0.at);
    expect(c.complete).toBe(c0.complete);
  });
});

describe('corpusMatches', () => {
  it("rend les articles correspondants dans l'ordre du corpus", () => {
    let c = createCorpus('feed/1', '7', 0);
    c = addPage(c, [entry('a', 'alpha moteur'), entry('b', 'beta'), entry('c', 'gamma moteur')], null, 0);
    expect(corpusMatches(c, ['moteur']).map((a) => a.id)).toEqual(['a', 'c']);
  });
});

describe('patchCorpusArticle', () => {
  it("met à jour l'article gardé — sinon la recherche suivante ressortirait l'ancien état", () => {
    let c = createCorpus('feed/1', '7', 0);
    c = addPage(c, [entry('a', 'alpha')], null, 0);
    c = patchCorpusArticle(c, 'a', { read: true });
    expect(c.entries[0].article.read).toBe(true);
  });

  // Un rollback d'étiquette doit partir de l'état COURANT de l'entrée, pas
  // d'un instantané d'avant le clic : sinon il défait aussi ce qui a été posé
  // entre-temps.
  it('accepte un patch calculé sur l’article courant', () => {
    let c = addPage(createCorpus('feed/1', '7', 0), [entry('a', 'alpha', { labels: ['L1', 'L2'] })], null, 0);
    c = patchCorpusArticle(c, 'a', (a) => ({ labels: withLabel(a.labels, 'L1', false) }));
    expect(c.entries[0].article.labels).toEqual(['L2']);
  });

  it('ignore un identifiant inconnu', () => {
    let c = createCorpus('feed/1', '7', 0);
    c = addPage(c, [entry('a', 'alpha')], null, 0);
    expect(patchCorpusArticle(c, 'zzz', { read: true }).entries[0].article.read).toBe(false);
  });
});

describe('withLabel', () => {
  it('pose ou retire une seule étiquette, sans doublon ni effet sur les autres', () => {
    expect(withLabel(['A'], 'B', true)).toEqual(['A', 'B']);
    expect(withLabel(['A', 'B'], 'B', true)).toEqual(['A', 'B']);
    expect(withLabel(['A', 'B'], 'A', false)).toEqual(['B']);
    expect(withLabel(undefined, 'A', true)).toEqual(['A']);
  });
});

describe('patchCorpusByEntry', () => {
  // Identifiants d'entrée réels (décimaux) — l'ordre croissant EST l'ordre
  // d'insertion FreshRSS. `published` n'intervient nulle part ici : c'est
  // justement ce que ce correctif change.
  const vieuxId = '1788386439680500';
  const pivotId = '1788386439680550';
  const neufId = '1788386439680600';

  const daté = (id: string): CorpusEntry => ({ article: art(id, 'titre'), haystack: 'titre' });

  const corpus = () => addPage(createCorpus('feed/1', '7', 0), [
    daté(vieuxId), daté(pivotId), daté(neufId),
  ], null, 0);

  it('marque ce qui est plus ancien, sans toucher au pivot ni au plus récent', () => {
    const c = patchCorpusByEntry(corpus(), { direction: 'below', articleId: pivotId }, { read: true });
    expect(c.entries.map((e) => [e.article.id, e.article.read])).toEqual([
      [vieuxId, true], [pivotId, false], [neufId, false],
    ]);
  });

  it('marque ce qui est plus récent, sans toucher au pivot ni au plus ancien', () => {
    const c = patchCorpusByEntry(corpus(), { direction: 'above', articleId: pivotId }, { read: true });
    expect(c.entries.map((e) => [e.article.id, e.article.read])).toEqual([
      [vieuxId, false], [pivotId, false], [neufId, true],
    ]);
  });

  it('ne touche pas au texte cherchable : seul l’état change', () => {
    const c = patchCorpusByEntry(corpus(), { direction: 'below', articleId: pivotId }, { read: true });
    expect(c.entries.map((e) => e.haystack)).toEqual(['titre', 'titre', 'titre']);
  });

  it('ignore un identifiant pivot illisible : dans le doute, on ne marque pas', () => {
    const c = patchCorpusByEntry(corpus(), { direction: 'below', articleId: 'inconnu' }, { read: true });
    expect(c.entries.map((e) => e.article.read)).toEqual([false, false, false]);
  });

  // I3 (revue de markReadRelative) : le rollback d'un marquage de plage ne
  // doit jamais toucher un identifiant que l'appelant exclut explicitement
  // (confirmé par le serveur, ou déjà lu avant l'action) — seul un critère de
  // plage ne peut pas le distinguer.
  it('épargne les identifiants exclus, même dans la plage', () => {
    const c = patchCorpusByEntry(
      corpus(),
      { direction: 'below', articleId: pivotId },
      { read: true },
      (id) => id === vieuxId,
    );
    expect(c.entries.map((e) => [e.article.id, e.article.read])).toEqual([
      [vieuxId, false], [pivotId, false], [neufId, false],
    ]);
  });
});
