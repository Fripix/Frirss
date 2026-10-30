// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { normalizeArticle } from './feedStore';

/*
 * Les titres d'articles arrivent de FreshRSS avec `& < >` en pleine chasse ;
 * un article sans titre garde un titre vide (libellé posé au rendu).
 */
describe('normalizeArticle', () => {
  it('rend & aux titres et aux noms de flux', () => {
    const a = normalizeArticle({ id: 'x', title: 'Black Friday ＆ Cyber Monday', origin: { streamId: 'feed/1', title: 'r／selfhosted' } } as never);
    expect(a.title).toBe('Black Friday & Cyber Monday');
    expect(a.source).toBe('r/selfhosted');
  });

  // Le libellé « Sans titre » se pose au rendu (`articleTitle`), pas ici :
  // calculé à la normalisation, il restait figé dans le cache mémoire et la
  // liste hors ligne après un changement de langue, et la recherche l'indexait.
  it('un article sans titre garde un titre vide', () => {
    expect(normalizeArticle({ id: 'x', title: '' } as never).title).toBe('');
    expect(normalizeArticle({ id: 'x' } as never).title).toBe('');
  });
});
