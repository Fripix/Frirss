import { describe, it, expect } from 'vitest';
import { fromFreshrssTitle, fromFreshrssName } from './freshrssText';

/*
 * FreshRSS remplace dans ses réponses `& < >` des titres par leurs formes
 * pleine chasse (`escapeToUnicodeAlternative`), et aussi `/` dans les noms de
 * flux : « Black Friday ＆ Cyber Monday », « r／selfhosted ». Affichés tels
 * quels, copiés ou partagés, et introuvables par une recherche sur « & ».
 */
describe('texte venu de FreshRSS', () => {
  it('rend & < > aux titres d’articles', () => {
    expect(fromFreshrssTitle('Black Friday ＆ Cyber Monday')).toBe('Black Friday & Cyber Monday');
    expect(fromFreshrssTitle('a ＜b＞ c')).toBe('a <b> c');
  });

  it('rend aussi / aux noms de flux', () => {
    expect(fromFreshrssName('r／selfhosted')).toBe('r/selfhosted');
    expect(fromFreshrssName('Tom ＆ Jerry')).toBe('Tom & Jerry');
  });

  // Signes ordinaires du chinois et du japonais : les rendre en ASCII
  // abîmerait ces titres.
  it('laisse la ponctuation pleine chasse des langues CJK', () => {
    expect(fromFreshrssTitle('这是什么？好；')).toBe('这是什么？好；');
    expect(fromFreshrssName('新闻？')).toBe('新闻？');
  });

  it('laisse un titre ordinaire intact, et tolère l’absence de titre', () => {
    expect(fromFreshrssTitle('Rien à changer')).toBe('Rien à changer');
    expect(fromFreshrssTitle('')).toBe('');
    expect(fromFreshrssName(undefined)).toBe('');
  });
});
