import { describe, it, expect } from 'vitest';
import { groupFeedsByCategory, categoryNameOf, isValidCategoryName } from './feedCategories';
import type { Subscription } from '../types';

const feed = (id: string, title: string, cats?: Array<[string, string]>): Subscription => ({
  id,
  title,
  categories: cats?.map(([cid, label]) => ({ id: cid, label })),
} as Subscription);

const TECH = 'user/-/label/Tech';
const SECU = 'user/-/label/Sécurité';

describe('groupFeedsByCategory', () => {
  it('is empty for no feeds', () => {
    expect(groupFeedsByCategory([])).toEqual({ categories: [], uncategorised: [] });
  });

  it('groups feeds under their category, with the feeds kept in order', () => {
    const out = groupFeedsByCategory([
      feed('feed/1', 'Ars', [[TECH, 'Tech']]),
      feed('feed/2', 'Next', [[TECH, 'Tech']]),
    ]);
    expect(out.categories).toHaveLength(1);
    expect(out.categories[0].id).toBe(TECH);
    expect(out.categories[0].label).toBe('Tech');
    expect(out.categories[0].feeds.map((f) => f.title)).toEqual(['Ars', 'Next']);
  });

  it('collects feeds with no category apart, rather than inventing one', () => {
    const out = groupFeedsByCategory([feed('feed/1', 'Orphelin'), feed('feed/2', 'Ars', [[TECH, 'Tech']])]);
    expect(out.uncategorised.map((f) => f.title)).toEqual(['Orphelin']);
    expect(out.categories.map((c) => c.label)).toEqual(['Tech']);
  });

  it('treats an empty category array as no category', () => {
    expect(groupFeedsByCategory([feed('feed/1', 'X', [])]).uncategorised).toHaveLength(1);
  });

  it('sorts categories by name, ignoring case and accents', () => {
    const out = groupFeedsByCategory([
      feed('feed/1', 'a', [[TECH, 'Tech']]),
      feed('feed/2', 'b', [[SECU, 'Sécurité']]),
      feed('feed/3', 'c', [['user/-/label/auto', 'auto']]),
    ]);
    expect(out.categories.map((c) => c.label)).toEqual(['auto', 'Sécurité', 'Tech']);
  });

  it('lists a feed in every category it belongs to', () => {
    // FreshRSS gives one category per feed, but the Google Reader model allows
    // several. Showing the feed once per category is honest; hiding the second
    // membership would make a move look like it had failed.
    const out = groupFeedsByCategory([feed('feed/1', 'Ars', [[TECH, 'Tech'], [SECU, 'Sécurité']])]);
    expect(out.categories.map((c) => c.label)).toEqual(['Sécurité', 'Tech']);
    expect(out.categories.every((c) => c.feeds.length === 1)).toBe(true);
  });

  it('ignores a category entry with no id or no label', () => {
    const out = groupFeedsByCategory([
      feed('feed/1', 'X', [['', 'Vide']]),
      feed('feed/2', 'Y', [[TECH, '']]),
    ]);
    expect(out.categories).toEqual([]);
    expect(out.uncategorised).toHaveLength(2);
  });
});

describe('categoryNameOf', () => {
  it('takes the readable name out of a stream id', () => {
    expect(categoryNameOf(TECH)).toBe('Tech');
    expect(categoryNameOf('user/-/label/Self-hosting')).toBe('Self-hosting');
  });

  it('returns the id untouched when it has no label segment', () => {
    expect(categoryNameOf('feed/42')).toBe('feed/42');
  });
});

describe('isValidCategoryName', () => {
  it('accepts an ordinary name', () => {
    expect(isValidCategoryName('Tech FR')).toBe(true);
  });

  it('rejects empty or blank', () => {
    expect(isValidCategoryName('')).toBe(false);
    expect(isValidCategoryName('   ')).toBe(false);
  });

  it('rejects a name with a slash', () => {
    // The stream id is `user/-/label/<name>`: a slash inside the name would
    // read as nesting and produce a category nobody asked for.
    expect(isValidCategoryName('Tech/FR')).toBe(false);
  });
});
