import { describe, it, expect } from 'vitest';
import { imageBudget, collectImageUrls, prioritizeForOffline } from './offlineImages';
import type { Article } from '../types';

const MB = 1024 * 1024;

describe('imageBudget', () => {
  it('downloads nothing when disabled', () => {
    expect(imageBudget('none', 500)).toEqual({ bytes: 0, perArticle: 0 });
  });
  it('keeps only the thumbnail on the light preset', () => {
    expect(imageBudget('light', 500)).toEqual({ bytes: 200 * MB, perArticle: 1 });
  });
  it('allows body images on standard', () => {
    expect(imageBudget('standard', 500)).toEqual({ bytes: 500 * MB, perArticle: 6 });
  });
  it('allows more on max, at a round 1 Go so it reads as "1 Go"', () => {
    expect(imageBudget('max', 500)).toEqual({ bytes: 1024 * MB, perArticle: 10 });
  });
  it('honours a custom size', () => {
    expect(imageBudget('custom', 250)).toEqual({ bytes: 250 * MB, perArticle: 6 });
  });
  it('clamps a nonsensical custom size', () => {
    expect(imageBudget('custom', 0).bytes).toBe(50 * MB);
    expect(imageBudget('custom', 99999).bytes).toBe(5000 * MB);
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
