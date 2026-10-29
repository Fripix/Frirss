import { describe, it, expect, vi, afterEach } from 'vitest';
import { preparedImageFallback } from './swImageFallback';
import { PREPARED_IMAGE_CACHE_NAME } from './storageEstimate';

/*
 * La route des images du service worker lit d'abord son propre cache (images
 * gardées à l'affichage, plafonné). Quand il n'a rien, ce plugin sert l'image
 * préparée : c'est ce qui rend les images préparées visibles hors ligne
 * depuis qu'elles vivent dans un cache à part.
 */
describe('preparedImageFallback', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const request = { url: 'https://cdn.example/a.jpg' } as Request;
  const run = (cachedResponse: Response | null) =>
    preparedImageFallback.cachedResponseWillBeUsed({ request, cachedResponse });

  it('laisse passer ce que le cache des images vues a trouvé', async () => {
    const match = vi.fn();
    vi.stubGlobal('caches', { match });
    const found = new Response('x');
    expect(await run(found)).toBe(found);
    expect(match).not.toHaveBeenCalled();
  });

  it('sinon, sert l’image préparée, cherchée dans le bon cache', async () => {
    const prepared = new Response('y');
    const match = vi.fn(async () => prepared);
    vi.stubGlobal('caches', { match });
    expect(await run(null)).toBe(prepared);
    expect(match).toHaveBeenCalledWith(request, { cacheName: PREPARED_IMAGE_CACHE_NAME });
  });

  it('rend null quand aucun des deux caches ne l’a', async () => {
    vi.stubGlobal('caches', { match: vi.fn(async () => undefined) });
    expect(await run(null)).toBeNull();
  });

  // workbox-build recopie le code de la fonction dans sw.js : une référence à
  // une constante importée y deviendrait une variable inconnue.
  it('porte le nom du cache en littéral, sans dépendance extérieure', () => {
    const src = preparedImageFallback.cachedResponseWillBeUsed.toString();
    expect(src).toMatch(new RegExp(`["']${PREPARED_IMAGE_CACHE_NAME}["']`));
    expect(src).not.toMatch(/PREPARED_IMAGE_CACHE_NAME|import/);
  });
});
