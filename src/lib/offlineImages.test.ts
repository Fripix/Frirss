import { describe, it, expect } from 'vitest';
import {
  imageBudget, defaultPresetMb, collectImageUrls, articleImageUrls, prioritizeForOffline,
  OFFLINE_IMAGE_PRESETS,
} from './offlineImages';
import type { Article } from '../types';

const MB = 1024 * 1024;
const GB = 1024 * MB;

describe('defaultPresetMb', () => {
  it('derives roughly 10/25/50% of the device quota', () => {
    const quota = 16 * GB;
    expect(defaultPresetMb('light', quota)).toBe(1650);
    expect(defaultPresetMb('standard', quota)).toBe(4100);
    expect(defaultPresetMb('max', quota)).toBe(8200);
  });

  it('rounds to a tidy 50 Mo step', () => {
    expect(defaultPresetMb('standard', 16 * GB) % 50).toBe(0);
    expect(defaultPresetMb('light', 3 * GB) % 50).toBe(0);
  });

  it('scales down on a small device', () => {
    const quota = 1.5 * GB;
    expect(defaultPresetMb('light', quota)).toBe(150);
    expect(defaultPresetMb('standard', quota)).toBe(400);
    expect(defaultPresetMb('max', quota)).toBe(750);
  });

  it('falls back to fixed values when the quota is unknown', () => {
    expect(defaultPresetMb('light', 0)).toBe(200);
    expect(defaultPresetMb('standard', 0)).toBe(500);
    expect(defaultPresetMb('max', 0)).toBe(1024);
  });

  it('keeps a floor on a tiny quota', () => {
    expect(defaultPresetMb('light', 100 * MB)).toBe(100);
  });

  it('keeps a ceiling on a huge quota', () => {
    const quota = 500 * GB;
    expect(defaultPresetMb('light', quota)).toBe(2048);
    expect(defaultPresetMb('standard', quota)).toBe(5120);
    expect(defaultPresetMb('max', quota)).toBe(10240);
  });
});

describe('imageBudget', () => {
  const quota = 16 * GB;

  it('downloads nothing when disabled', () => {
    expect(imageBudget('none', {}, quota)).toEqual({ bytes: 0, perArticle: 0 });
  });

  it('uses the quota-derived default when untouched', () => {
    expect(imageBudget('standard', {}, quota)).toEqual({ bytes: 4100 * MB, perArticle: 6 });
  });

  it('prefers an edited value over the default', () => {
    expect(imageBudget('standard', { standard: 250 }, quota)).toEqual({ bytes: 250 * MB, perArticle: 6 });
  });

  it('only applies the edit to its own preset', () => {
    expect(imageBudget('light', { standard: 250 }, quota).bytes).toBe(1650 * MB);
  });

  it('keeps thumbnails only on the light preset', () => {
    expect(imageBudget('light', {}, quota).perArticle).toBe(1);
  });

  it('allows more images on max', () => {
    expect(imageBudget('max', {}, quota).perArticle).toBe(10);
  });

  it('falls back to the suggestion when the field is cleared', () => {
    expect(imageBudget('standard', { standard: 0 }, quota).bytes).toBe(4100 * MB);
  });

  it('clamps an absurdly large edited value', () => {
    expect(imageBudget('standard', { standard: 99999 }, quota).bytes).toBe(20480 * MB);
  });

  // A browser that stored a preset we have since removed ('custom') must not
  // take the app down — it falls back to the standard budget.
  it('survives a preset persisted by an older version', () => {
    const stale = 'custom' as unknown as Parameters<typeof imageBudget>[0];
    expect(() => imageBudget(stale, {}, quota)).not.toThrow();
    expect(imageBudget(stale, {}, quota)).toEqual({ bytes: 4100 * MB, perArticle: 6 });
  });

  it('survives an unknown preset in defaultPresetMb', () => {
    const stale = 'custom' as unknown as Parameters<typeof defaultPresetMb>[0];
    expect(() => defaultPresetMb(stale, quota)).not.toThrow();
    expect(defaultPresetMb(stale, quota)).toBe(4100);
  });
});

describe('OFFLINE_IMAGE_PRESETS', () => {
  it('lists the three sizeable presets in order', () => {
    expect(OFFLINE_IMAGE_PRESETS).toEqual(['light', 'standard', 'max']);
  });
});

describe('collectImageUrls', () => {
  it('returns http(s) image sources in order', () => {
    const html = '<img src="https://a/1.jpg"><p>x</p><img src="http://b/2.png">';
    expect(collectImageUrls(html, 5)).toEqual(['https://a/1.jpg', 'http://b/2.png']);
  });
  it('drops data: and relative sources', () => {
    const html = '<img src="data:image/png;base64,AAA"><img src="/local.jpg"><img src="https://a/1.jpg">';
    expect(collectImageUrls(html, 5)).toEqual(['https://a/1.jpg']);
  });
  it('de-duplicates repeated sources', () => {
    const html = '<img src="https://a/1.jpg"><img src="https://a/1.jpg">';
    expect(collectImageUrls(html, 5)).toEqual(['https://a/1.jpg']);
  });
  it('respects the limit', () => {
    const html = '<img src="https://a/1.jpg"><img src="https://a/2.jpg"><img src="https://a/3.jpg">';
    expect(collectImageUrls(html, 2)).toEqual(['https://a/1.jpg', 'https://a/2.jpg']);
  });
  it('returns nothing for a zero limit or empty html', () => {
    expect(collectImageUrls('<img src="https://a/1.jpg">', 0)).toEqual([]);
    expect(collectImageUrls('', 5)).toEqual([]);
  });
});

const art = (over: Partial<Article>): Article => ({
  id: 'x', title: 't', summary: '', content: '', author: '', url: 'u',
  source: 's', sourceId: 'f', published: 0, read: false, starred: false,
  labels: [], tags: [], ...over,
});

describe('articleImageUrls', () => {
  const img = (n: string) => `<img src="https://cdn.example/${n}.jpg">`;

  it('keeps the RSS thumbnail first, then body images from the extract', () => {
    expect(articleImageUrls(img('thumb'), img('a') + img('b'), 6)).toEqual([
      'https://cdn.example/thumb.jpg',
      'https://cdn.example/a.jpg',
      'https://cdn.example/b.jpg',
    ]);
  });

  it('takes the thumbnail only when the preset allows a single image', () => {
    expect(articleImageUrls(img('thumb'), img('a') + img('b'), 1))
      .toEqual(['https://cdn.example/thumb.jpg']);
  });

  it('caps the list at perArticle and never repeats a URL', () => {
    const urls = articleImageUrls(img('a'), img('a') + img('b') + img('c'), 2);
    expect(urls).toEqual(['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg']);
  });

  it('falls back to the RSS content when there is no extract', () => {
    expect(articleImageUrls(img('a') + img('b'), null, 6)).toHaveLength(2);
  });

  // Le preset « aucune » passe par ici : budget nul, zéro image.
  it('returns nothing when the budget allows no image', () => {
    expect(articleImageUrls(img('a'), img('b'), 0)).toEqual([]);
  });
});

describe('prioritizeForOffline', () => {
  const LATER = 'user/-/label/Read later';

  it('puts read-later and starred first', () => {
    const later = art({ id: 'later', published: 1, read: true, labels: [LATER] });
    const starred = art({ id: 'starred', published: 2, starred: true, read: true });
    const unread = art({ id: 'unread', published: 9 });
    const out = prioritizeForOffline([unread, later, starred], LATER);
    expect(out.slice(0, 2).map((a) => a.id).sort()).toEqual(['later', 'starred']);
    expect(out[2].id).toBe('unread');
  });

  it('orders unread before read', () => {
    const read = art({ id: 'read', published: 10, read: true });
    const unread = art({ id: 'unread', published: 1 });
    expect(prioritizeForOffline([read, unread], LATER).map((a) => a.id)).toEqual(['unread', 'read']);
  });

  it('orders each group newest first', () => {
    const old = art({ id: 'old', published: 1 });
    const recent = art({ id: 'recent', published: 5 });
    expect(prioritizeForOffline([old, recent], LATER).map((a) => a.id)).toEqual(['recent', 'old']);
  });

  it('does not mutate the input array', () => {
    const input = [art({ id: 'a', published: 1 }), art({ id: 'b', published: 2 })];
    const copy = [...input];
    prioritizeForOffline(input, LATER);
    expect(input).toEqual(copy);
  });
});
