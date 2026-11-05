import { describe, it, expect } from 'vitest';
import { mergeRefreshedPage, appendPage, keepOpenRow } from './refreshMerge';

/** Identifiant greader : l'id d'entrée FreshRSS en hexadécimal sur seize caractères. */
const gid = (n: number) => `tag:google.com,2005:reader/item/${n.toString(16).padStart(16, '0')}`;
const rows = (ids: number[]) => ids.map((n) => ({ id: gid(n) }));
const ids = (list: { id: string }[]) => list.map((a) => a.id);
/** `from` vers `to` inclus, par pas de `step` (négatif pour descendre). */
const span = (from: number, to: number, step = from <= to ? 1 : -1) => {
  const out: number[] = [];
  for (let n = from; step > 0 ? n <= to : n >= to; n += step) out.push(n);
  return out;
};

describe('mergeRefreshedPage — la page reçue dépasse la fin de la liste chargée (L-01)', () => {
  // 100 non-lus chargés (deux pages), les rangs 30 à 100 lus ailleurs : la
  // première page du serveur s'étend AU-DELÀ du dernier article chargé.
  const shown = rows(span(1000, 901));
  const page = rows([...span(1000, 972), ...span(900, 880)]);

  it('plus récents d’abord : la queue périmée ne revient pas sous la page, la suite est celle de la page', () => {
    const merged = mergeRefreshedPage(shown, 'after-901', page, 'after-880', 'newest');
    expect(ids(merged.articles)).toEqual(ids(page));
    expect(merged.continuation).toBe('after-880');
  });

  it('plus anciens d’abord : même règle dans l’autre sens', () => {
    const shownOld = rows(span(1, 100));
    const pageOld = rows([...span(1, 29), ...span(101, 121)]);
    const merged = mergeRefreshedPage(shownOld, 'after-100', pageOld, 'after-121', 'oldest');
    expect(ids(merged.articles)).toEqual(ids(pageOld));
    expect(merged.continuation).toBe('after-121');
  });

  it('sans identifiant lisible, la page remplace tout plutôt que de risquer un doublon', () => {
    const plain = (list: number[]) => list.map((n) => ({ id: `x${n}` }));
    const merged = mergeRefreshedPage(plain(span(1, 100)), 'after-100', plain([...span(1, 29), ...span(101, 121)]), 'after-121', 'newest');
    expect(ids(merged.articles)).toEqual(ids(plain([...span(1, 29), ...span(101, 121)])));
    expect(merged.continuation).toBe('after-121');
  });
});

describe('mergeRefreshedPage — un article entré dans la vue termine la page', () => {
  // Liste chargée : 200, 198 … 2 (100 articles). Un article ancien (101) est
  // revenu dans la vue entre 102 et 100, et 102 l'a quittée. La page s'arrête
  // sur 101, qui n'est pas dans la liste : seule la position ne dit plus où
  // reprendre, l'ordre FreshRSS (id d'entrée) le dit.
  const shown = rows(span(200, 2, -2));
  const page = rows([...span(200, 104, -2), 101]);

  it('plus récents d’abord : la queue au-delà de la page reste, celle d’avant part', () => {
    const merged = mergeRefreshedPage(shown, 'after-2', page, 'after-101', 'newest');
    expect(ids(merged.articles)).toEqual(ids(rows([...span(200, 104, -2), 101, ...span(100, 2, -2)])));
    expect(merged.continuation).toBe('after-2');
  });

  it('plus anciens d’abord : même règle dans l’autre sens', () => {
    const shownOld = rows(span(2, 200, 2));
    const pageOld = rows([...span(2, 98, 2), 101]);
    const merged = mergeRefreshedPage(shownOld, 'after-200', pageOld, 'after-101', 'oldest');
    expect(ids(merged.articles)).toEqual(ids(rows([...span(2, 98, 2), 101, ...span(102, 200, 2)])));
    expect(merged.continuation).toBe('after-200');
  });
});

describe('appendPage', () => {
  it('n’ajoute pas un article déjà dans la liste', () => {
    const list = rows(span(100, 51));
    const next = rows(span(60, 11));
    const out = appendPage(list, next);
    expect(ids(out)).toEqual(ids(rows(span(100, 11))));
  });
});

describe('keepOpenRow — l’article ouvert reste à sa place parmi ses voisins (L-02)', () => {
  const v = (n: number) => ({ id: `v${n}` });
  const vs = (list: number[]) => list.map(v);

  it('les lignes lues au-dessus ont disparu : il se place avant le non-lu qui le suivait', () => {
    // V001→V040 lus ici à la flèche, V040 ouvert ; la relecture ne rend que V041 et suivants.
    const out = keepOpenRow(vs(span(1, 100)), vs(span(41, 100)), v(40));
    expect(ids(out).slice(0, 3)).toEqual(['v40', 'v41', 'v42']);
  });

  it('son voisin du dessous est parti aussi : il se place avant le suivant encore là', () => {
    const out = keepOpenRow(vs(span(1, 10)), vs([1, 2, 3, 6, 7]), v(4));
    expect(ids(out)).toEqual(['v1', 'v2', 'v3', 'v4', 'v6', 'v7']);
  });

  it('plus rien en dessous : il se place après le voisin du dessus', () => {
    const out = keepOpenRow(vs(span(1, 10)), vs([1, 2, 3]), v(10));
    expect(ids(out)).toEqual(['v1', 'v2', 'v3', 'v10']);
  });

  it('aucun voisin retrouvé : en tête', () => {
    expect(ids(keepOpenRow(vs([1, 2, 3]), vs([7, 8]), v(2)))).toEqual(['v2', 'v7', 'v8']);
    expect(ids(keepOpenRow([], vs([7, 8]), v(2)))).toEqual(['v2', 'v7', 'v8']);
  });
});
