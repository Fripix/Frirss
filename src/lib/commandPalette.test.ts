import { describe, it, expect } from 'vitest';
import { normalizeForSearch, matchScore, rankCommands, type Command } from './commandPalette';

const cmd = (id: string, label: string, group = 'feeds'): Command =>
  ({ id, label, group, run: () => {} });

describe('normalizeForSearch', () => {
  it('folds case', () => {
    expect(normalizeForSearch('Sécurité')).toBe(normalizeForSearch('SÉCURITÉ'));
  });

  it('folds accents, so a French label is reachable from a plain keyboard', () => {
    expect(normalizeForSearch('Sécurité')).toBe('securite');
    expect(normalizeForSearch('À lire plus tard')).toBe('a lire plus tard');
  });
});

describe('matchScore', () => {
  it('has no score when the query is absent', () => {
    expect(matchScore('zzz', 'Tech FR')).toBeNull();
  });

  it('scores a prefix above a word start, and a word start above the middle', () => {
    const prefix = matchScore('tech', 'Tech FR')!;
    const wordStart = matchScore('fr', 'Tech FR')!;
    const middle = matchScore('ech', 'Tech FR')!;
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(middle);
  });

  it('ignores accents and case in both directions', () => {
    expect(matchScore('securite', 'Sécurité')).not.toBeNull();
    expect(matchScore('SÉCU', 'securite')).not.toBeNull();
  });

  it('matches everything on an empty query, so the palette opens full', () => {
    expect(matchScore('', 'anything')).not.toBeNull();
  });
});

describe('rankCommands', () => {
  const list = [
    cmd('a', 'Tech FR'),
    cmd('b', 'Tech EN'),
    cmd('c', 'Sécurité'),
    cmd('d', 'Marquer tout comme lu', 'actions'),
  ];

  it('keeps only what matches', () => {
    expect(rankCommands(list, 'tech').map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('puts the better match first', () => {
    const ranked = rankCommands([cmd('a', 'Vieux Tech'), cmd('b', 'Tech FR')], 'tech');
    expect(ranked[0].id).toBe('b');
  });

  it('keeps the original order between equal scores, so the list does not jump', () => {
    const ranked = rankCommands([cmd('a', 'Tech FR'), cmd('b', 'Tech EN')], 'tech');
    expect(ranked.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('returns everything, in order, on an empty query', () => {
    expect(rankCommands(list, '  ').map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('caps the result list', () => {
    const many = Array.from({ length: 100 }, (_, i) => cmd(`c${i}`, `Feed ${i}`));
    expect(rankCommands(many, 'feed', 12)).toHaveLength(12);
  });

  it('finds an accented label from an unaccented query', () => {
    expect(rankCommands(list, 'securite').map((c) => c.id)).toEqual(['c']);
  });
});
