import { describe, expect, it } from 'vitest';
import type { Article } from '../types';
import { buildSavedArticleSignals, sameSavedArticleSignals } from './savedArticleSignals';

const article = (id: string, overrides: Partial<Article> = {}): Article => ({
  id,
  title: `Title ${id}`,
  summary: `Summary ${id}`,
  content: `<p>Body ${id}</p>`,
  author: '',
  url: '',
  source: '',
  sourceId: 'feed/x',
  published: 0,
  read: false,
  starred: false,
  labels: [],
  tags: [],
  ...overrides,
});

describe('buildSavedArticleSignals', () => {
  it('merges the two lists by id and keeps both flags', () => {
    const signals = buildSavedArticleSignals(
      [article('a', { starred: true }), article('b', { starred: true })],
      [article('b', { starred: true }), article('c'), article('d', { starred: true })],
    );
    expect(signals.map(({ id, starred, readLater }) => [id, starred, readLater])).toEqual([
      ['a', true, false],
      ['b', true, true],
      ['c', false, true],
      // Starred but only seen in the read-later list (starred list capped at 200).
      ['d', true, true],
    ]);
  });

  it('skips entries without an id and bounds stored content', () => {
    const signals = buildSavedArticleSignals(
      [article('', { starred: true }), article('long', { content: 'x'.repeat(50_000) })],
      [{ ...article('weird'), content: undefined as unknown as string }],
    );
    expect(signals.map((s) => s.id)).toEqual(['long', 'weird']);
    expect(signals[0].content).toHaveLength(20_000);
    expect(signals[1].content).toBe('');
  });
});

describe('sameSavedArticleSignals', () => {
  const base = buildSavedArticleSignals([article('a', { starred: true })], [article('b')]);

  it('is true for an identical rebuild', () => {
    expect(sameSavedArticleSignals(base, buildSavedArticleSignals([article('a', { starred: true })], [article('b')]))).toBe(true);
  });

  it('notices added, removed, re-flagged and edited articles', () => {
    expect(sameSavedArticleSignals(base, buildSavedArticleSignals([article('a')], []))).toBe(false);
    expect(sameSavedArticleSignals(base, buildSavedArticleSignals([article('a')], [article('b'), article('c')]))).toBe(false);
    expect(sameSavedArticleSignals(base, buildSavedArticleSignals([], [article('a'), article('b')]))).toBe(false);
    expect(sameSavedArticleSignals(base, buildSavedArticleSignals([article('a', { title: 'New' })], [article('b')]))).toBe(false);
  });
});
