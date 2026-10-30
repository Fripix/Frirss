// @vitest-environment jsdom
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

  // Un flux qui échappe son titre deux fois : FreshRSS retire une couche, puis
  // met `＆` à la place du `&` qui reste, et l'entité s'affichait en toutes
  // lettres. Inoreader montre l'emoji.
  describe('entités d’un titre échappé deux fois', () => {
    it('rend l’emoji, en décimal comme en hexadécimal', () => {
      expect(fromFreshrssTitle('＆#127916; Film')).toBe('🎬 Film');
      expect(fromFreshrssTitle('＆#x1F3AC; Film')).toBe('🎬 Film');
      expect(fromFreshrssTitle('＆#X1f3ac; Film')).toBe('🎬 Film');
    });

    it('rend les entités nommées', () => {
      expect(fromFreshrssTitle('Tom ＆amp; Jerry')).toBe('Tom & Jerry');
      expect(fromFreshrssTitle('Caf＆eacute; ＆hellip;')).toBe('Café …');
    });

    it('ne retire qu’une couche', () => {
      expect(fromFreshrssTitle('＆amp;#127916;')).toBe('&#127916;');
    });

    it('reste du texte', () => {
      expect(fromFreshrssTitle('＆lt;script＆gt;')).toBe('<script>');
    });

    // Le décodeur du navigateur accepte des formes sans point-virgule :
    // « R&D&copy » y deviendrait « R&D© ».
    it('exige l’entité entière', () => {
      expect(fromFreshrssTitle('R＆D＆copy 2026')).toBe('R&D&copy 2026');
      expect(fromFreshrssTitle('Q＆A; suite')).toBe('Q&A; suite');
      expect(fromFreshrssTitle('＆inconnu;')).toBe('&inconnu;');
    });

    it('un point de code invalide ne fait pas échouer la lecture', () => {
      expect(fromFreshrssTitle('＆#55357; x')).toBe('\uFFFD x');
      expect(fromFreshrssTitle('＆#99999999; x')).toBe('&#99999999; x');
    });

    it('le `；` d’un titre reste un signe ordinaire', () => {
      expect(fromFreshrssTitle('A＆amp；B')).toBe('A&amp；B');
    });

    // FreshRSS remplace aussi `;` dans les noms : l'entité s'y finit par `；`.
    it('les noms de flux aussi, avec le `；` qu’y met FreshRSS', () => {
      expect(fromFreshrssName('＆#127916； Cinéma')).toBe('🎬 Cinéma');
      expect(fromFreshrssName('＆#127916; Cinéma')).toBe('🎬 Cinéma');
    });
  });

  it('laisse un titre ordinaire intact, et tolère l’absence de titre', () => {
    expect(fromFreshrssTitle('Rien à changer')).toBe('Rien à changer');
    expect(fromFreshrssTitle('')).toBe('');
    expect(fromFreshrssName(undefined)).toBe('');
  });
});
