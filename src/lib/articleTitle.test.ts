import { describe, it, expect } from 'vitest';
import { articleTitle } from './articleTitle';

/*
 * Un article sans titre garde un `title` vide dans le store : le libellé
 * « Sans titre » est posé au rendu, dans la langue du moment. Calculé à la
 * normalisation, il restait figé dans le cache mémoire et la liste hors ligne
 * après un changement de langue, et la recherche l'indexait.
 */
const t = (k: string) => `<${k}>`;

describe('articleTitle', () => {
  it('rend le titre tel quel', () => {
    expect(articleTitle({ title: 'Vec<String> en Rust' }, t)).toBe('Vec<String> en Rust');
  });

  it('un titre vide reçoit le libellé traduit', () => {
    expect(articleTitle({ title: '' }, t)).toBe('<articleList.untitled>');
  });

  it('un titre fait de blancs aussi', () => {
    expect(articleTitle({ title: '  \n ' }, t)).toBe('<articleList.untitled>');
  });

  it('un titre absent (liste rangée par une ancienne version) aussi', () => {
    expect(articleTitle({ title: undefined as unknown as string }, t)).toBe('<articleList.untitled>');
  });
});
