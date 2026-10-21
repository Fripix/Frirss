// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { autoFor, panelFor } from './aiAuto';
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

describe('panelFor', () => {
  const base = { ...none, aiCategoryPanel: {}, aiPanelAlways: true };
  it('falls back to the global setting when nothing more specific says', () => {
    expect(panelFor('feed/1', subs, base)).toBe(true);
    expect(panelFor('feed/1', subs, { ...base, aiPanelAlways: false })).toBe(false);
  });
  it('lets the feed own value win over a category, an explicit false included', () => {
    const prefs = { ...base, aiPanelAlways: true, aiCategoryPanel: { Tech: true }, feedSettings: { 'feed/1': { aiPanel: false } } };
    expect(panelFor('feed/1', subs, prefs)).toBe(false);
    const hidden = { ...base, aiPanelAlways: false, aiCategoryPanel: { Tech: false }, feedSettings: { 'feed/1': { aiPanel: true } } };
    expect(panelFor('feed/1', subs, hidden)).toBe(true);
  });
  it('lets a category beat the global setting, both ways', () => {
    expect(panelFor('feed/1', subs, { ...base, aiPanelAlways: false, aiCategoryPanel: { Dev: true } })).toBe(true);
    expect(panelFor('feed/1', subs, { ...base, aiPanelAlways: true, aiCategoryPanel: { Dev: false } })).toBe(false);
  });
  it('is on when one category is explicitly on and another explicitly off', () => {
    expect(panelFor('feed/1', subs, { ...base, aiPanelAlways: false, aiCategoryPanel: { Tech: true, Dev: false } })).toBe(true);
    expect(panelFor('feed/1', subs, { ...base, aiPanelAlways: false, aiCategoryPanel: { Tech: false, Dev: true } })).toBe(true);
  });
  it('ignores a non-boolean feed value, and a category named like an Object.prototype member', () => {
    const feedSettings = { 'feed/1': { aiPanel: 'no' } } as never;
    expect(panelFor('feed/1', subs, { ...base, feedSettings, aiPanelAlways: false })).toBe(false);
    expect(panelFor('feed/2', subs, { ...base, aiPanelAlways: false })).toBe(false);
  });
  it('handles an unknown or missing feed', () => {
    expect(panelFor('feed/9', subs, { ...base, aiCategoryPanel: { Tech: false } })).toBe(true);
    expect(panelFor(undefined, subs, { ...base, aiPanelAlways: false })).toBe(false);
  });
});
