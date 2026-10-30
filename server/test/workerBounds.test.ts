import { describe, it, expect, vi } from 'vitest';

/*
 * Synchronisation en arrière-plan (`CACHE_SYNC_INTERVAL`) : le corps de chaque
 * réponse était lu par `resp.text()`, sans échéance ni plafond — le délai de
 * `fetchUpstream` s'arrête aux en-têtes. Un serveur FreshRSS (ou un hôte
 * qu'un utilisateur y a mis) qui ne finit jamais sa réponse bloquait la
 * synchronisation de TOUS les comptes jusqu'au redémarrage ; une réponse sans
 * fin remplissait la mémoire du processus.
 */
const fetchUpstream = vi.fn();
vi.mock('../routes/proxy.js', async () => {
  const actual = await vi.importActual<typeof import('../routes/proxy.js')>('../routes/proxy.js');
  return { ...actual, fetchUpstream: (...a: unknown[]) => fetchUpstream(...a) };
});
const cacheSet = vi.fn(async () => {});
vi.mock('../cache.js', () => ({
  cacheEnabled: true, cacheSet: (...a: unknown[]) => cacheSet(...(a as [])), cacheKey: (u: unknown, t: string) => `k:${String(u)}:${t}`,
  trimStreamJson: (s: string) => s, cacheableEntry: (s: string) => (s.startsWith('<') ? null : s), cacheGet: vi.fn(async () => null),
}));

const { syncUser } = await import('../worker.js');
const { encrypt } = await import('../crypto.js');

const row = () => ({ user_id: 1, url: 'https://rss.example.com', freshrss_token: encrypt('jeton') });

describe('syncUser — corps bornés', () => {
  it('abandonne une réponse qui ne finit jamais, et passe à la suite', async () => {
    let cancelled = 0;
    fetchUpstream.mockImplementation(async () => new Response(new ReadableStream({ pull() { /* jamais rien */ }, cancel() { cancelled++; } }), { status: 200 }));
    const started = Date.now();
    await syncUser(row(), 50);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(cacheSet).not.toHaveBeenCalled();
    expect(cancelled).toBeGreaterThan(0);
  });

  it('coupe une réponse sans fin au plafond', async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(0x61);
    let pulled = 0;
    fetchUpstream.mockImplementation(async () => new Response(new ReadableStream({ pull(c) { pulled += chunk.length; c.enqueue(chunk); } }), { status: 200 }));
    await syncUser({ ...row() }, 30_000);
    expect(cacheSet).not.toHaveBeenCalled();
    expect(pulled).toBeLessThan(5 * 40 * 1024 * 1024);
  }, 60_000);

  // Un proxy d'authentification répond 200 en HTML : écrit, il devenait une
  // liste vide à la peinture depuis le cache.
  it('n’écrit pas un corps qui n’est pas du JSON', async () => {
    fetchUpstream.mockImplementation(async () => new Response('<html>Sign in</html>', { status: 200 }));
    await syncUser(row(), 1000);
    expect(cacheSet).not.toHaveBeenCalled();
  });

  it('libère le corps d’une réponse en erreur', async () => {
    let cancelled = 0;
    fetchUpstream.mockImplementation(async () => new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(10)); }, cancel() { cancelled++; } }), { status: 500 }));
    await syncUser(row(), 1_000);
    expect(cancelled).toBe(5);
  });
});
