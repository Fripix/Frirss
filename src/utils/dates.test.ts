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

  it('labels an article from today', () => {
    expect(label([article(daysAgo(0))])).toBe('DATES.TODAY');
  });

  it('labels an article from yesterday', () => {
    expect(label([article(daysAgo(1))])).toBe('DATES.YESTERDAY');
  });

  it('labels an article within the last week by weekday', () => {
    const d = daysAgo(3);
    expect(label([article(d)])).toBe(weekdayLabel(d));
  });

  it('labels an article 7+ days old with a full date (no year, same year)', () => {
    // 10 days before 15 June → 5 June 2026.
    expect(label([article(daysAgo(10))])).toBe('June 5');
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
    expect(groups[0].label).toBe('DATES.TODAY');
    expect(groups[0].articles).toHaveLength(2);
    expect(groups[1].label).toBe('DATES.YESTERDAY');
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
      'DATES.TODAY',
      'DATES.YESTERDAY',
      'DATES.TODAY',
    ]);
  });
});
