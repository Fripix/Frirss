import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Stub i18n so date labels are deterministic: t(key) → key, English locale.
vi.mock('../i18n', () => ({
  default: { t: (k: string) => k, language: 'en' },
}));

import { groupByDate } from './dates';
import type { Article } from '../types';

const article = (d: Date): Article => ({ published: d.getTime() } as Article);
const label = (articles: Article[]) => groupByDate(articles)[0].label;

const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const weekdayLabel = (d: Date) => `dates.${dayKeys[d.getDay()]}`.toUpperCase();

// Fixed "now": Monday 15 June 2026, noon (local).
const NOW = new Date(2026, 5, 15, 12, 0, 0);
const daysAgo = (n: number, hour = 10) =>
  new Date(2026, 5, 15 - n, hour, 0, 0);

describe('groupByDate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('returns an empty list for no articles', () => {
    expect(groupByDate([])).toEqual([]);
  });

  // Chaque libellé porte une DATE en plus du mot : « MERCREDI » seul ne dit
  // pas de quel mercredi il s'agit, ce qui est précisément ce qu'on cherche à
  // savoir en faisant défiler une liste sans fin.
  it('labels an article from today, with the date', () => {
    expect(label([article(daysAgo(0))])).toBe('DATES.TODAY · JUNE 15');
  });

  it('labels an article from yesterday, with the date', () => {
    expect(label([article(daysAgo(1))])).toBe('DATES.YESTERDAY · JUNE 14');
  });

  it('labels an article within the last week by weekday, with the date', () => {
    const d = daysAgo(3);
    expect(label([article(d)])).toBe(`${weekdayLabel(d)} · JUNE 12`);
  });

  it('labels an article 7+ days old with a full date (no year, same year)', () => {
    // 10 days before 15 June → 5 June 2026.
    expect(label([article(daysAgo(10))])).toBe('JUNE 5');
  });

  it('includes the year for an article from a previous year', () => {
    expect(label([article(new Date(2025, 5, 5, 10))])).toContain('2025');
  });

  it('groups consecutive articles that share a day, splitting on change', () => {
    const groups = groupByDate([
      article(daysAgo(0, 11)),
      article(daysAgo(0, 9)),
      article(daysAgo(1, 15)),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].label).toBe('DATES.TODAY · JUNE 15');
    expect(groups[0].articles).toHaveLength(2);
    expect(groups[1].label).toBe('DATES.YESTERDAY · JUNE 14');
    expect(groups[1].articles).toHaveLength(1);
  });

  it('re-opens a new group when a day recurs later in the list', () => {
    // today, yesterday, today again → three groups (order preserved).
    const groups = groupByDate([
      article(daysAgo(0)),
      article(daysAgo(1)),
      article(daysAgo(0)),
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      'DATES.TODAY · JUNE 15',
      'DATES.YESTERDAY · JUNE 14',
      'DATES.TODAY · JUNE 15',
    ]);
  });
});

// La clé de rendu d'une bande de date. Elle valait `${label}-${index}` : vider
// une bande décalait l'index de TOUTES les suivantes, donc leur clé, donc React
// démontait et remontait leurs sous-arbres entiers. Les lignes remontées
// portaient encore `data-stagger` et rejouaient leur animation d'entrée sur des
// nœuds neufs : marquer lu le dernier article d'« Aujourd'hui » faisait
// clignoter jusqu'à dix lignes d'un coup.
describe('groupByDate — clés de bandes', () => {
  const withId = (id: string, d: Date): Article => ({ id, published: d.getTime() } as Article);
  // Une clé absente comparerait `undefined` à `undefined` : les tests de
  // stabilité passeraient sans rien garder. On exige donc une vraie clé.
  const keys = (articles: Article[]) =>
    groupByDate(articles).map((g) => {
      expect(typeof g.key).toBe('string');
      expect(g.key).not.toBe('');
      return g.key;
    });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('garde la clé des bandes suivantes quand la première se vide', () => {
    const list = [
      withId('a0', daysAgo(0, 11)),
      withId('a1', daysAgo(1, 15)),
      withId('a2', daysAgo(2, 9)),
    ];
    expect(keys(list.slice(1))).toEqual(keys(list).slice(1));
  });

  it('garde la clé d’une bande quand elle perd une ligne', () => {
    const list = [withId('a0', daysAgo(0, 11)), withId('a1', daysAgo(0, 9))];
    expect(keys([list[0]])).toEqual(keys(list));
  });

  it('distingue deux bandes portant le même libellé', () => {
    // Cas déjà couvert plus haut : une liste dont un jour revient plus bas
    // rouvre une bande de même libellé. Deux clés identiques feraient deux
    // enfants React sous la même clé.
    const ks = keys([
      withId('a0', daysAgo(0)),
      withId('a1', daysAgo(1)),
      withId('a2', daysAgo(0)),
    ]);
    expect(new Set(ks).size).toBe(3);
  });
});
