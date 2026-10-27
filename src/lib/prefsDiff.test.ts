import { describe, it, expect } from 'vitest';
import { changedKeys, pickKeys, mergeForRelecture } from './prefsDiff';

describe('changedKeys', () => {
  it('ne rend que les clés dont la valeur diffère', () => {
    expect(changedKeys({ a: 1, b: { x: 1 } }, { a: 1, b: { x: 2 } })).toEqual(['b']);
  });

  it('l’ordre des clés d’un objet ne compte pas', () => {
    expect(changedKeys({ o: { x: 1, y: 2 } }, { o: { y: 2, x: 1 } })).toEqual([]);
  });

  it('l’ordre d’un tableau compte', () => {
    expect(changedKeys({ order: ['a', 'b'] }, { order: ['b', 'a'] })).toEqual(['order']);
  });

  it('une clé absente de la valeur connue est sale', () => {
    expect(changedKeys({ a: 1, b: 2 }, { a: 1 })).toEqual(['b']);
  });

  it('null et une clé absente ne se confondent pas', () => {
    expect(changedKeys({ p: null }, {})).toEqual(['p']);
    expect(changedKeys({ p: null }, { p: null })).toEqual([]);
  });

  it('une clé connue mais absente localement n’est pas rendue', () => {
    expect(changedKeys({ a: 1 }, { a: 1, z: 3 })).toEqual([]);
  });
});

describe('pickKeys', () => {
  it('ne garde que les clés demandées et présentes', () => {
    expect(pickKeys({ a: 1, b: 2, c: null }, ['a', 'c', 'z'])).toEqual({ a: 1, c: null });
  });
});

describe('mergeForRelecture', () => {
  it('écarte les clés encore sales localement', () => {
    expect(mergeForRelecture({ a: 1, b: 2 }, new Set(['b']))).toEqual({ a: 1 });
  });

  it('ne fabrique aucune clé absente côté serveur', () => {
    expect(mergeForRelecture({ a: 1 }, new Set(['z']))).toEqual({ a: 1 });
  });
});
