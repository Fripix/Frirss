// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { normalizeArticle } from './feedStore';

/*
 * Les titres d'articles arrivent de FreshRSS avec `& < >` en pleine chasse ;
 * et un article sans titre recevait « Sans titre » en dur, dans les dix langues.
 */
describe('normalizeArticle', () => {
  it('rend & aux titres et aux noms de flux', () => {
    const a = normalizeArticle({ id: 'x', title: 'Black Friday ＆ Cyber Monday', origin: { streamId: 'feed/1', title: 'r／selfhosted' } } as never);
    expect(a.title).toBe('Black Friday & Cyber Monday');
    expect(a.source).toBe('r/selfhosted');
  });

  it('un article sans titre reçoit le libellé traduit', () => {
    const a = normalizeArticle({ id: 'x', title: '' } as never);
    expect(a.title).not.toBe('');
    expect(a.title).toBe(untitled());
  });
});

import i18next from 'i18next';
function untitled(): string {
  return i18next.isInitialized ? i18next.t('articleList.untitled') : 'Sans titre';
}
