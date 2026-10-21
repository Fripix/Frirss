// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { rememberShown, forgetShown, recallShown } from './aiShownTranslations';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('aiShownTranslations', () => {
  it('remembers a shown translation and recalls it for the same body', () => {
    rememberShown('1', 'a1', { lang: 'fr', providerId: 3, hash: 'abc' }, () => 1000);
    expect(recallShown('1', 'a1', 'abc')).toEqual({ lang: 'fr', providerId: 3, hash: 'abc', at: 1000 });
  });

  it('keeps no provider when none was reported', () => {
    rememberShown('1', 'a1', { lang: 'de', hash: 'abc' }, () => 1);
    expect(recallShown('1', 'a1', 'abc')).toMatchObject({ lang: 'de', hash: 'abc' });
    expect(recallShown('1', 'a1', 'abc')?.providerId).toBeUndefined();
  });

  it('recalls nothing for another body or another article', () => {
    rememberShown('1', 'a1', { lang: 'fr', hash: 'abc' });
    expect(recallShown('1', 'a1', 'zzz')).toBeNull();
    expect(recallShown('1', 'a2', 'abc')).toBeNull();
  });

  it('keeps two accounts apart', () => {
    rememberShown('1', 'a1', { lang: 'fr', hash: 'abc' });
    expect(recallShown('2', 'a1', 'abc')).toBeNull();
    rememberShown('2', 'a1', { lang: 'de', hash: 'abc' });
    forgetShown('1', 'a1');
    expect(recallShown('1', 'a1', 'abc')).toBeNull();
    expect(recallShown('2', 'a1', 'abc')?.lang).toBe('de');
  });

  it('remembering again replaces the entry and refreshes its date', () => {
    rememberShown('1', 'a1', { lang: 'fr', hash: 'abc' }, () => 1);
    rememberShown('1', 'a1', { lang: 'de', hash: 'def' }, () => 2);
    expect(recallShown('1', 'a1', 'abc')).toBeNull();
    expect(recallShown('1', 'a1', 'def')).toEqual({ lang: 'de', hash: 'def', at: 2 });
  });

  it('keeps 200 entries at most: the 201st evicts the oldest', () => {
    for (let i = 0; i < 201; i++) rememberShown('1', `a${i}`, { lang: 'fr', hash: 'h' }, () => i);
    expect(recallShown('1', 'a0', 'h')).toBeNull();
    expect(recallShown('1', 'a1', 'h')).not.toBeNull();
    expect(recallShown('1', 'a200', 'h')).not.toBeNull();
    expect(Object.keys(JSON.parse(localStorage.getItem('frirss_aiShown:1') ?? '{}'))).toHaveLength(200);
  });

  it('evicts by date, not by position: a refreshed entry survives', () => {
    for (let i = 0; i < 200; i++) rememberShown('1', `a${i}`, { lang: 'fr', hash: 'h' }, () => i);
    rememberShown('1', 'a0', { lang: 'fr', hash: 'h' }, () => 500);
    rememberShown('1', 'new', { lang: 'fr', hash: 'h' }, () => 501);
    expect(recallShown('1', 'a0', 'h')).not.toBeNull();
    expect(recallShown('1', 'a1', 'h')).toBeNull();
  });

  it('survives a storage that throws or holds garbage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => rememberShown('1', 'a1', { lang: 'fr', hash: 'h' })).not.toThrow();
    expect(() => forgetShown('1', 'a1')).not.toThrow();
    expect(recallShown('1', 'a1', 'h')).toBeNull();
    vi.restoreAllMocks();
    localStorage.setItem('frirss_aiShown:1', '{not json');
    expect(recallShown('1', 'a1', 'h')).toBeNull();
    expect(() => rememberShown('1', 'a1', { lang: 'fr', hash: 'h' })).not.toThrow();
    expect(recallShown('1', 'a1', 'h')).not.toBeNull();
    localStorage.setItem('frirss_aiShown:1', JSON.stringify({ a1: { lang: 42 } }));
    expect(recallShown('1', 'a1', 'h')).toBeNull();
  });
});
