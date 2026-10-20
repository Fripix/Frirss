// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { aiRouting } from './aiRouting';
import type { Subscription } from '../types';

const subs: Subscription[] = [
  { id: 'feed/1', title: 'A', categories: [{ id: 'user/-/label/Tech', label: 'Tech' }, { id: 'user/-/label/Dev', label: 'Dev' }] },
];
const none = { feedSettings: {}, aiCategoryProviders: {}, aiPreferredProvider: null, aiFallback: true };

describe('aiRouting', () => {
  it('sends each stage that is set, and only those', () => {
    expect(aiRouting('feed/1', subs, none)).toEqual({ fallback: true });
    expect(aiRouting('feed/1', subs, {
      feedSettings: { 'feed/1': { aiProvider: 4 } }, aiCategoryProviders: { Dev: 2 }, aiPreferredProvider: 9, aiFallback: false,
    })).toEqual({ feedProvider: 4, categoryProvider: 2, preferredProvider: 9, fallback: false });
  });
  it("takes the first of the feed's categories that carries a provider", () => {
    expect(aiRouting('feed/1', subs, { ...none, aiCategoryProviders: { Dev: 2, Tech: 5 } }).categoryProvider).toBe(5);
    expect(aiRouting('feed/1', subs, { ...none, aiCategoryProviders: { Dev: 2 } }).categoryProvider).toBe(2);
  });
  it('an unknown feed sends no feed or category stage', () => {
    expect(aiRouting('feed/404', subs, { ...none, aiCategoryProviders: { Tech: 5 } })).toEqual({ fallback: true });
    expect(aiRouting(undefined, subs, { ...none, aiCategoryProviders: { Tech: 5 } })).toEqual({ fallback: true });
  });
  it('still sends the preferred provider for an unknown feed', () => {
    expect(aiRouting('feed/404', subs, { ...none, aiPreferredProvider: 3 })).toEqual({ preferredProvider: 3, fallback: true });
  });
  it('drops a stored feed provider that is not a valid id (synced unnormalised)', () => {
    for (const bad of ['3', -1, 0, 1.5, null, NaN]) {
      const feedSettings = { 'feed/1': { aiProvider: bad } } as never;
      expect(aiRouting('feed/1', subs, { ...none, feedSettings })).toEqual({ fallback: true });
    }
  });
  it('a category named like an Object.prototype member sends nothing unless assigned', () => {
    const odd: Subscription[] = [{ id: 'feed/1', title: 'A', categories: [
      { id: 'x', label: 'constructor' }, { id: 'y', label: 'toString' }, { id: 'z', label: '__proto__' }] }];
    expect(aiRouting('feed/1', odd, none)).toEqual({ fallback: true });
    expect(aiRouting('feed/1', odd, { ...none, aiCategoryProviders: { toString: 6 } }).categoryProvider).toBe(6);
  });
  it('ignores an invalid category value and moves on to the next category', () => {
    const prefs = { ...none, aiCategoryProviders: { Tech: '5', Dev: 2 } as never };
    expect(aiRouting('feed/1', subs, prefs).categoryProvider).toBe(2);
  });
  it('drops an invalid preferred provider', () => {
    expect(aiRouting('feed/1', subs, { ...none, aiPreferredProvider: -3 })).toEqual({ fallback: true });
  });
});
