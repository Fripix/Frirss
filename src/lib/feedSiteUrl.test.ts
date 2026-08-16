import { describe, it, expect } from 'vitest';
import { feedSiteUrl } from './feedSiteUrl';

describe('feedSiteUrl', () => {
  it('uses htmlUrl when it is a real site (distinct from the feed URL)', () => {
    expect(
      feedSiteUrl({ htmlUrl: 'https://korben.info/', url: 'http://feeds.feedburner.com/KorbensBlog' })
    ).toBe('https://korben.info/');
  });

  it('derives the site from an article when htmlUrl IS the feed URL (MacGeneration case)', () => {
    // htmlUrl === url === the RSS feed itself; the real site only appears in articles.
    expect(
      feedSiteUrl(
        { htmlUrl: 'https://megaflux.macg.co/', url: 'https://megaflux.macg.co/' },
        'https://www.macg.co/mac/2026/08/le-mac-310343'
      )
    ).toBe('https://www.macg.co/');
  });

  it('falls back to the htmlUrl origin when no article is available', () => {
    expect(
      feedSiteUrl({ htmlUrl: 'https://megaflux.macg.co/', url: 'https://megaflux.macg.co/' })
    ).toBe('https://megaflux.macg.co/');
  });

  it('avoids opening a feed-like htmlUrl path, using an article origin instead', () => {
    expect(
      feedSiteUrl({ htmlUrl: 'https://example.com/feed/', url: 'https://feeds.feedburner.com/x' }, 'https://example.com/post/1')
    ).toBe('https://example.com/');
  });

  it('derives from the feed URL origin when htmlUrl is empty', () => {
    expect(feedSiteUrl({ url: 'https://example.com/rss' })).toBe('https://example.com/');
  });

  it('returns null when there is nothing usable', () => {
    expect(feedSiteUrl({})).toBeNull();
  });
});
