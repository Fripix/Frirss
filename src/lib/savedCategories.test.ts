import { describe, it, expect } from 'vitest';
import {
  savedCategories, categoryLabelId, isSavedCategory,
  READ_LATER_PREFIX, STARRED_PREFIX,
} from './savedCategories';
import type { Tag } from '../types';

const tag = (name: string): Tag => ({ id: `user/-/label/${name}` } as Tag);

describe('savedCategories', () => {
  const labels = [
    tag(READ_LATER_PREFIX),
    tag(`${READ_LATER_PREFIX}/Veille`),
    tag(`${READ_LATER_PREFIX}/Recettes`),
    tag(`${STARRED_PREFIX}/Perso`),
    tag('Autre'),
  ];

  it('returns only the sub-labels of the prefix', () => {
    expect(savedCategories(labels, READ_LATER_PREFIX).map((c) => c.name))
      .toEqual(['Recettes', 'Veille']);
  });

  it('never returns the prefix label itself', () => {
    expect(savedCategories(labels, READ_LATER_PREFIX).some((c) => c.name === '')).toBe(false);
  });

  it('keeps the full label id', () => {
    expect(savedCategories(labels, STARRED_PREFIX)[0].id)
      .toBe(`user/-/label/${STARRED_PREFIX}/Perso`);
  });

  it('returns nothing for a prefix with no category', () => {
    expect(savedCategories([tag('Autre')], READ_LATER_PREFIX)).toEqual([]);
  });

  it('handles an empty label list', () => {
    expect(savedCategories([], READ_LATER_PREFIX)).toEqual([]);
  });
});

describe('categoryLabelId', () => {
  it('builds a prefixed id', () => {
    expect(categoryLabelId(STARRED_PREFIX, 'Perso')).toBe(`user/-/label/${STARRED_PREFIX}/Perso`);
  });
  it('trims the name', () => {
    expect(categoryLabelId(STARRED_PREFIX, '  Perso  ')).toBe(`user/-/label/${STARRED_PREFIX}/Perso`);
  });
  it('strips slashes, which would create a nested level', () => {
    expect(categoryLabelId(STARRED_PREFIX, 'A/B')).toBe(`user/-/label/${STARRED_PREFIX}/A B`);
  });
});

describe('isSavedCategory', () => {
  it('recognises both prefixes', () => {
    expect(isSavedCategory(`user/-/label/${READ_LATER_PREFIX}/Veille`)).toBe(true);
    expect(isSavedCategory(`user/-/label/${STARRED_PREFIX}/Perso`)).toBe(true);
  });
  it('does not match the prefix labels themselves', () => {
    expect(isSavedCategory(`user/-/label/${READ_LATER_PREFIX}`)).toBe(false);
  });
  it('does not match an unrelated label', () => {
    expect(isSavedCategory('user/-/label/Autre')).toBe(false);
  });
});

describe('savedCategories with locally created names', () => {
  it('shows a category created locally before any article is filed', () => {
    const cats = savedCategories([], READ_LATER_PREFIX, ['Veille']);
    expect(cats.map((c) => c.name)).toEqual(['Veille']);
    expect(cats[0].id).toBe(`user/-/label/${READ_LATER_PREFIX}/Veille`);
  });

  it('does not duplicate a category that exists on both sides', () => {
    const server = [{ id: `user/-/label/${READ_LATER_PREFIX}/Veille` } as Tag];
    expect(savedCategories(server, READ_LATER_PREFIX, ['Veille'])).toHaveLength(1);
  });

  it('merges and sorts both sources', () => {
    const server = [{ id: `user/-/label/${READ_LATER_PREFIX}/Zoo` } as Tag];
    expect(savedCategories(server, READ_LATER_PREFIX, ['Alpha']).map((c) => c.name))
      .toEqual(['Alpha', 'Zoo']);
  });

  it('ignores blank local names', () => {
    expect(savedCategories([], READ_LATER_PREFIX, ['  ', ''])).toEqual([]);
  });
});
