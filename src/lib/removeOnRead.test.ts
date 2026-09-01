import { describe, it, expect } from 'vitest';
import { shouldLeaveList } from './removeOnRead';

const base = { becameRead: true, filter: 'unread' as const, implicit: false, selected: false };

describe('shouldLeaveList', () => {
  it('retire la ligne quand un geste explicite marque lu sous le filtre non-lus', () => {
    expect(shouldLeaveList(base)).toBe(true);
  });

  it('ne retire rien quand on marque NON lu', () => {
    // `toggleRead` est une bascule : elle sert aussi à remettre en non-lu,
    // et cette transition n'a aucune raison de faire disparaître la ligne.
    expect(shouldLeaveList({ ...base, becameRead: false })).toBe(false);
  });

  it('ne retire rien hors du filtre non-lus', () => {
    // La vue Favoris et la vue À lire plus tard montrent délibérément des
    // articles lus : y faire disparaître une ligne serait incompréhensible.
    for (const filter of ['all', 'starred', 'readlater'] as const) {
      expect(shouldLeaveList({ ...base, filter }), filter).toBe(false);
    }
  });

  it('ne retire rien pour une écriture implicite', () => {
    // Le marquage au défilement décide à la place de l'utilisateur. Retirer
    // ces lignes ferait s'effondrer la liste en continu pendant qu'il défile.
    expect(shouldLeaveList({ ...base, implicit: true })).toBe(false);
  });

  it('ne retire rien quand l’article marqué lu est celui qui est ouvert', () => {
    // Sa ligne est sa place dans la liste : sans elle, `selectNextArticle` ne
    // le retrouve plus et saute en tête, et suivant/précédent devient inerte.
    expect(shouldLeaveList({ ...base, selected: true })).toBe(false);
  });
});
