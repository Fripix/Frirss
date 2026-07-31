// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { getFavicon, setFavicon, blobToDataUrl } from './faviconCache';

describe('faviconCache', () => {
  beforeEach(() => localStorage.clear());

  it('returns null for an unknown or empty url', () => {
    expect(getFavicon('https://unknown.example/a.png')).toBeNull();
    expect(getFavicon(undefined)).toBeNull();
    expect(getFavicon('')).toBeNull();
  });

  it('caches a value and writes it through to localStorage', () => {
    const url = 'https://rss.example/f.php?h=aaa';
    setFavicon(url, 'data:image/png;base64,AAA');
    expect(getFavicon(url)).toBe('data:image/png;base64,AAA');
    expect(localStorage.getItem('frirss_favicon:' + url)).toBe('data:image/png;base64,AAA');
  });

  it('reads a value persisted by a previous session (localStorage only)', () => {
    // Simulate a reload: only localStorage holds it, the memory tier is empty
    // for this fresh url.
    const url = 'https://rss.example/f.php?h=persisted';
    localStorage.setItem('frirss_favicon:' + url, 'data:image/png;base64,BBB');
    expect(getFavicon(url)).toBe('data:image/png;base64,BBB');
  });

  it('ignores empty writes', () => {
    setFavicon('', 'x');
    setFavicon('https://rss.example/z.png', '');
    expect(getFavicon('https://rss.example/z.png')).toBeNull();
  });

  it('converts a Blob to a data URL', async () => {
    const blob = new Blob(['hello'], { type: 'text/plain' });
    const dataUrl = await blobToDataUrl(blob);
    expect(dataUrl.startsWith('data:text/plain')).toBe(true);
    expect(dataUrl).toContain('base64,');
  });
});
