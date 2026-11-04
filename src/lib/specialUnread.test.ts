import { describe, it, expect } from 'vitest';
import { afterReadChange, afterMembershipChange, specialRowCounts, type SpecialUnread } from './specialUnread';
import { READ_LATER_LABEL } from './viewLists';
import type { Article } from '../types';

const base: SpecialUnread = { starred: 3, readLater: 2 };

describe('afterReadChange — un article change d’état de lecture', () => {
  it('décompte un favori lu, et lui seul', () => {
    expect(afterReadChange(base, { starred: true, labels: [] }, -1)).toEqual({ starred: 2, readLater: 2 });
  });

  it('décompte un article à lire plus tard lu', () => {
    expect(afterReadChange(base, { starred: false, labels: [READ_LATER_LABEL] }, -1)).toEqual({ starred: 3, readLater: 1 });
  });

  it('touche les deux listes quand l’article est dans les deux', () => {
    expect(afterReadChange(base, { starred: true, labels: [READ_LATER_LABEL] }, 1)).toEqual({ starred: 4, readLater: 3 });
  });

  it('ne bouge pas pour un article hors des deux listes (même objet rendu)', () => {
    expect(afterReadChange(base, { starred: false, labels: ['user/-/label/Autre'] }, -1)).toBe(base);
  });

  it('ne descend jamais sous zéro', () => {
    expect(afterReadChange({ starred: 0, readLater: 0 }, { starred: true, labels: [READ_LATER_LABEL] }, -1))
      .toEqual({ starred: 0, readLater: 0 });
  });

  it('tolère un article sans étiquettes', () => {
    expect(afterReadChange(base, { starred: true } as unknown as Article, -1)).toEqual({ starred: 2, readLater: 2 });
  });
});

describe('afterMembershipChange — un article entre dans une liste ou en sort', () => {
  it('compte un article non lu qui devient favori', () => {
    expect(afterMembershipChange(base, { read: false }, 'starred', true)).toEqual({ starred: 4, readLater: 2 });
  });

  it('décompte un article non lu retiré de « À lire plus tard »', () => {
    expect(afterMembershipChange(base, { read: false }, 'readLater', false)).toEqual({ starred: 3, readLater: 1 });
  });

  it('ignore un article déjà lu, dans les deux sens (même objet rendu)', () => {
    expect(afterMembershipChange(base, { read: true }, 'starred', true)).toBe(base);
    expect(afterMembershipChange(base, { read: true }, 'readLater', false)).toBe(base);
  });

  it('ne descend jamais sous zéro', () => {
    expect(afterMembershipChange({ starred: 0, readLater: 0 }, { read: false }, 'starred', false))
      .toEqual({ starred: 0, readLater: 0 });
  });
});

describe('specialRowCounts — ce que la ligne de la sidebar affiche', () => {
  it('par défaut (total seul), le chiffre d’aujourd’hui et rien d’autre', () => {
    expect(specialRowCounts(42, 3, { showTotals: true, showUnread: false })).toEqual({ count: undefined, badge: 42 });
  });
  it('les deux réglages sont indépendants', () => {
    expect(specialRowCounts(42, 3, { showTotals: false, showUnread: true })).toEqual({ count: 3, badge: undefined });
    expect(specialRowCounts(42, 3, { showTotals: true, showUnread: true })).toEqual({ count: 3, badge: 42 });
    expect(specialRowCounts(42, 3, { showTotals: false, showUnread: false })).toEqual({ count: undefined, badge: undefined });
  });
});
