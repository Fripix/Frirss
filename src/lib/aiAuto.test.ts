// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { autoFor } from './aiAuto';
import type { Subscription } from '../types';

const subs: Subscription[] = [
  { id: 'feed/1', title: 'A', categories: [{ id: 'user/-/label/Tech', label: 'Tech' }, { id: 'user/-/label/Dev', label: 'Dev' }] },
  { id: 'feed/2', title: 'B', categories: [{ id: 'user/-/label/constructor', label: 'constructor' }] },
];
const none = { feedSettings: {}, aiCategoryAutoSummary: {}, aiCategoryAutoTranslate: {}, aiAutoSummary: false };

describe('autoFor', () => {
  it("lets the feed's own value win, an explicit false included", () => {
    const prefs = { ...none, feedSettings: { 'feed/1': { aiAutoTranslate: false, aiAutoSummary: true } }, aiCategoryAutoTranslate: { Tech: true as const } };
    expect(autoFor('translate', 'feed/1', subs, prefs)).toBe(false);
    expect(autoFor('summary', 'feed/1', subs, { ...prefs, aiAutoSummary: false })).toBe(true);
  });
  it('is on as soon as one of the feed categories is on', () => {
    expect(autoFor('translate', 'feed/1', subs, { ...none, aiCategoryAutoTranslate: { Dev: true } })).toBe(true);
    expect(autoFor('translate', 'feed/1', subs, { ...none, aiCategoryAutoTranslate: { Tech: true } })).toBe(true);
    expect(autoFor('summary', 'feed/1', subs, { ...none, aiCategoryAutoSummary: { Dev: true } })).toBe(true);
    expect(autoFor('translate', 'feed/1', subs, { ...none, aiCategoryAutoSummary: { Dev: true } })).toBe(false);
  });
  it('falls back to the global auto-summary for a summary, to off for a translation', () => {
    expect(autoFor('summary', 'feed/1', subs, { ...none, aiAutoSummary: true })).toBe(true);
    expect(autoFor('summary', 'feed/1', subs, none)).toBe(false);
    expect(autoFor('translate', 'feed/1', subs, { ...none, aiAutoSummary: true })).toBe(false);
  });
  it('ignores a non-boolean feed value', () => {
    const feedSettings = { 'feed/1': { aiAutoTranslate: 'yes' } } as never;
    expect(autoFor('translate', 'feed/1', subs, { ...none, feedSettings, aiCategoryAutoTranslate: { Tech: true } })).toBe(true);
  });
  it('does not match a category named like an Object.prototype member', () => {
    expect(autoFor('translate', 'feed/2', subs, none)).toBe(false);
    expect(autoFor('summary', 'feed/2', subs, none)).toBe(false);
  });
  it('handles an unknown or missing feed', () => {
    expect(autoFor('translate', 'feed/9', subs, { ...none, aiCategoryAutoTranslate: { Tech: true } })).toBe(false);
    expect(autoFor('summary', undefined, subs, { ...none, aiAutoSummary: true })).toBe(true);
  });
});
