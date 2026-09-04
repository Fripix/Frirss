import { describe, it, expect, vi, afterEach } from 'vitest';
import { openArticleAtSource } from './openArticleAtSource';
import * as openExternalModule from './openExternal';
import type { Article } from '../types';

vi.mock('./openExternal', () => ({ openExternal: vi.fn() }));

afterEach(() => vi.clearAllMocks());

const article = (over: Partial<Article> = {}): Article => ({
  id: 'a1', title: 'T', summary: '', content: '', author: '',
  url: 'https://example.com/1', source: '', sourceId: 'feed/1',
  published: 0, read: false, starred: false, labels: [], tags: [],
  ...over,
} as Article);

describe('openArticleAtSource', () => {
  it("ouvre l'URL de l'article", () => {
    openArticleAtSource(article(), vi.fn());
    expect(openExternalModule.openExternal).toHaveBeenCalledWith('https://example.com/1');
  });

  // Le comportement a changé : l'icône marquait lu, elle sélectionne. C'est
  // `selectArticle` qui marque lu au passage, et c'est ce qui permet d'agir
  // ensuite sur l'article sans le rechercher dans la liste.
  it("sélectionne l'article ouvert", () => {
    const selectArticle = vi.fn();
    const a = article({ read: false });
    openArticleAtSource(a, selectArticle);
    expect(selectArticle).toHaveBeenCalledOnce();
    expect(selectArticle).toHaveBeenCalledWith(a);
  });

  // L'ancienne version refusait d'agir sur un article déjà lu, parce que
  // `toggleRead` l'aurait repassé non lu. `selectArticle` n'est pas une
  // bascule : il sélectionne dans les deux cas, et la garde disparaît avec le
  // danger qui la justifiait.
  it('sélectionne aussi un article déjà lu', () => {
    const selectArticle = vi.fn();
    const a = article({ read: true });
    openArticleAtSource(a, selectArticle);
    expect(selectArticle).toHaveBeenCalledOnce();
    expect(selectArticle).toHaveBeenCalledWith(a);
  });

  it.each([
    ['vide', ''],
    ['absente', undefined],
    ['nulle', null],
    ['blanche', '   '],
  ])("sans URL (%s) : n'ouvre rien ET ne sélectionne rien", (_label, url) => {
    const selectArticle = vi.fn();
    openArticleAtSource(article({ url } as Partial<Article>), selectArticle);
    expect(openExternalModule.openExternal).not.toHaveBeenCalled();
    // Le piège : `openExternal('')` ne fait rien, mais la suite partait quand
    // même — l'article changeait d'état sans que rien ne s'ouvre.
    expect(selectArticle).not.toHaveBeenCalled();
  });
});
