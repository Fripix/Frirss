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
    const toggleRead = vi.fn();
    openArticleAtSource(article(), toggleRead);
    expect(openExternalModule.openExternal).toHaveBeenCalledWith('https://example.com/1');
  });

  it('marque lu un article non lu', () => {
    const toggleRead = vi.fn();
    openArticleAtSource(article({ read: false }), toggleRead);
    expect(toggleRead).toHaveBeenCalledOnce();
  });

  it('NE bascule PAS un article déjà lu — sinon il repasserait à non lu', () => {
    const toggleRead = vi.fn();
    openArticleAtSource(article({ read: true }), toggleRead);
    expect(toggleRead).not.toHaveBeenCalled();
  });

  it.each([
    ['vide', ''],
    ['absente', undefined],
    ['nulle', null],
    ['blanche', '   '],
  ])("sans URL (%s) : n'ouvre rien ET ne marque rien", (_label, url) => {
    const toggleRead = vi.fn();
    openArticleAtSource(article({ url } as Partial<Article>), toggleRead);
    expect(openExternalModule.openExternal).not.toHaveBeenCalled();
    // Le piège : `openExternal('')` ne fait rien, mais le marquage partait
    // quand même — l'article devenait lu sans que rien ne s'ouvre.
    expect(toggleRead).not.toHaveBeenCalled();
  });
});
