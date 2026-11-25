// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getFavicon, setFavicon, blobToDataUrl, faviconIsStale, refreshFavicon, FAVICON_MAX_AGE_MS, resetFaviconSession } from './faviconCache';

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

// Le cache gardait une icône pour toujours. Un navigateur qui avait chargé les
// icônes pendant que FreshRSS servait son icône par défaut (le globe, servi en
// 200 pour une adresse qu'il n'a pas encore) restait sur le globe, alors que
// FreshRSS avait depuis la vraie icône (capture de Fripix, 2026-11-24).
describe('faviconCache — revérification', () => {
  beforeEach(() => { localStorage.clear(); resetFaviconSession(); });

  it('une icône gardée sans date de vérification (avant 1.10.0) est à revérifier', () => {
    const url = 'https://rss.example/f.php?h=old';
    localStorage.setItem('frirss_favicon:' + url, 'data:image/x-icon;base64,GLOBE');
    expect(faviconIsStale(url)).toBe(true);
  });

  it('une icône vérifiée récemment ne l’est pas, puis le redevient au bout du délai', () => {
    const url = 'https://rss.example/f.php?h=fresh';
    const t0 = 1_700_000_000_000;
    setFavicon(url, 'data:image/png;base64,AAA', t0);
    expect(faviconIsStale(url, t0 + 1000)).toBe(false);
    expect(faviconIsStale(url, t0 + FAVICON_MAX_AGE_MS + 1)).toBe(true);
  });

  it('la date de vérification survit au rechargement', () => {
    const url = 'https://rss.example/f.php?h=persist';
    const t0 = 1_700_000_000_000;
    setFavicon(url, 'data:image/png;base64,AAA', t0);
    resetFaviconSession({ dropMemory: true });
    expect(faviconIsStale(url, t0 + 1000)).toBe(false);
  });

  it('refreshFavicon remplace l’icône gardée par celle du serveur', async () => {
    const url = 'https://rss.example/f.php?h=heal';
    localStorage.setItem('frirss_favicon:' + url, 'data:image/x-icon;base64,GLOBE');
    const fetchImage = vi.fn(async () => 'data:image/png;base64,REAL');
    await expect(refreshFavicon(url, fetchImage)).resolves.toBe('data:image/png;base64,REAL');
    expect(getFavicon(url)).toBe('data:image/png;base64,REAL');
    expect(faviconIsStale(url)).toBe(false);
  });

  it('une seule requête par adresse et par session, même pour plusieurs icônes affichées', async () => {
    const url = 'https://rss.example/f.php?h=once';
    localStorage.setItem('frirss_favicon:' + url, 'data:image/x-icon;base64,GLOBE');
    const fetchImage = vi.fn(async () => 'data:image/png;base64,REAL');
    await Promise.all([refreshFavicon(url, fetchImage), refreshFavicon(url, fetchImage), refreshFavicon(url, fetchImage)]);
    await refreshFavicon(url, fetchImage);
    expect(fetchImage).toHaveBeenCalledTimes(1);
  });

  it('un échec garde l’icône gardée et ne réessaie pas dans la même session', async () => {
    const url = 'https://rss.example/f.php?h=fail';
    localStorage.setItem('frirss_favicon:' + url, 'data:image/x-icon;base64,GLOBE');
    const fetchImage = vi.fn(async () => null);
    await expect(refreshFavicon(url, fetchImage)).resolves.toBeNull();
    await refreshFavicon(url, fetchImage);
    expect(fetchImage).toHaveBeenCalledTimes(1);
    expect(getFavicon(url)).toBe('data:image/x-icon;base64,GLOBE');
    expect(faviconIsStale(url)).toBe(true);
  });
});
