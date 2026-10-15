import { describe, it, expect, vi } from 'vitest';

// Chemin Redis : le module de cache est simulé, la valeur lue est illisible.
vi.mock('../cache.js', () => ({
  cacheEnabled: true,
  cacheGet: vi.fn().mockResolvedValue('{not json'),
  cacheSet: vi.fn().mockResolvedValue(undefined),
}));

const { aiCacheGet } = await import('./store.js');

describe('aiCacheGet on Redis', () => {
  it('treats an unreadable value as a miss instead of throwing', async () => {
    await expect(aiCacheGet('frirss:ai:any')).resolves.toBeNull();
  });
});
