import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatBytes, clearImageCache, IMAGE_CACHE_NAME, PREPARED_IMAGE_CACHE_NAME } from './storageEstimate';

describe('formatBytes', () => {
  it('renders megabytes below a gigabyte', () => {
    expect(formatBytes(340 * 1024 * 1024)).toBe('340 Mo');
  });
  it('renders gigabytes with one decimal', () => {
    expect(formatBytes(1.25 * 1024 * 1024 * 1024)).toBe('1,3 Go');
  });
  it('renders small sizes as 0 Mo rather than a fraction', () => {
    expect(formatBytes(1024)).toBe('0 Mo');
  });
  it('handles zero', () => {
    expect(formatBytes(0)).toBe('0 Mo');
  });
  // L'unité et la virgule étaient écrites en dur : l'onglet affichait
  // « 12,0 Go » en anglais comme en chinois.
  it('prend l’unité et le séparateur décimal de la langue', () => {
    const units = { mb: 'MB', gb: 'GB' };
    expect(formatBytes(1.25 * 1024 * 1024 * 1024, units, 'en')).toBe('1.3 GB');
    expect(formatBytes(340 * 1024 * 1024, units, 'en')).toBe('340 MB');
    expect(formatBytes(2 * 1024 * 1024 * 1024, { mb: 'МБ', gb: 'ГБ' }, 'uk')).toBe('2,0 ГБ');
  });
});

describe('clearImageCache', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  // Les images préparées ont leur propre cache : « Vider les images » qui ne
  // viderait que celui des images vues en ligne laisserait l'essentiel.
  it('vide les deux caches d’images', async () => {
    const del = vi.fn(async () => true);
    vi.stubGlobal('caches', { delete: del });
    await clearImageCache();
    expect(del).toHaveBeenCalledWith(IMAGE_CACHE_NAME);
    expect(del).toHaveBeenCalledWith(PREPARED_IMAGE_CACHE_NAME);
    expect(PREPARED_IMAGE_CACHE_NAME).not.toBe(IMAGE_CACHE_NAME);
  });
});
