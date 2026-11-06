import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

/*
 * Un VRAI cycle du worker : `syncUser` y était appelé par `.map(syncUser)`, qui
 * lui passait l'INDEX du compte comme échéance (0, 1, 2 ms). Tout était coupé
 * avant la réponse, rien n'entrait dans le cache, et le journal annonçait quand
 * même « pre-cached N active user(s) ». `workerBounds.test.ts` appelle
 * `syncUser` directement avec une échéance explicite : il ne pouvait pas le
 * voir, d'où ce fichier, qui passe par `runCycle`.
 */
const fetchUpstream = vi.fn();
vi.mock('../routes/proxy.js', async () => {
  const actual = await vi.importActual<typeof import('../routes/proxy.js')>('../routes/proxy.js');
  return { ...actual, fetchUpstream: (...a: unknown[]) => fetchUpstream(...a) };
});
const cacheSet = vi.fn(async () => {});
vi.mock('../cache.js', () => ({
  cacheEnabled: true, cacheSet: (...a: unknown[]) => cacheSet(...(a as [])), cacheKey: (u: unknown, sv: unknown, id: string, t: string) => `k:${String(u)}:${String(sv)}:${id}:${t}`,
  serverCacheIdentity: (url: string, user: string) => `${url}|${user}`,
  trimStreamJson: (s: string) => s, cacheableEntry: (s: string) => (s.startsWith('<') ? null : s), cacheGet: vi.fn(async () => null),
}));

const { runCycle } = await import('../worker.js');
const { encrypt } = await import('../crypto.js');
const { default: db } = await import('../db.js');

/** Un amont qui répond en 20 ms, et qui écoute l'échéance comme un vrai `fetch`. */
const slowUpstream = async (_url: string, opts: { signal: AbortSignal }): Promise<Response> => {
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, 20);
    opts.signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('aborted', 'AbortError'));
    }, { once: true });
  });
  return new Response('{"items":[]}', { status: 200 });
};

const accounts = new Map<string, { user: number; server: number }>();
beforeAll(() => {
  for (const name of ['alice', 'bob', 'carol']) {
    const u = db.prepare(
      "INSERT INTO users (username, email, password_hash, display_name, role, auth_provider, last_active_at) VALUES (?, ?, 'x', ?, 'user', 'local', datetime('now'))",
    ).run(name, `${name}@example.com`, name);
    // Un serveur non synchronisé d'abord : l'id du serveur ne suit pas celui du compte.
    db.prepare('INSERT INTO servers (user_id, name, url, freshrss_user, freshrss_token, is_default) VALUES (?, ?, ?, ?, ?, 0)')
      .run(u.lastInsertRowid, `${name}-bis`, `https://${name}.example.com`, `${name}-bis`, encrypt('jeton'));
    const sv = db.prepare('INSERT INTO servers (user_id, name, url, freshrss_user, freshrss_token, is_default) VALUES (?, ?, ?, ?, ?, 1)')
      .run(u.lastInsertRowid, name, `https://${name}.example.com`, name, encrypt('jeton'));
    accounts.set(name, { user: Number(u.lastInsertRowid), server: Number(sv.lastInsertRowid) });
  }
});
beforeEach(() => { cacheSet.mockClear(); fetchUpstream.mockReset(); });

describe('cycle de synchronisation', () => {
  it('met en cache les cinq flux de chaque compte actif', async () => {
    fetchUpstream.mockImplementation(slowUpstream);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await runCycle();
    } finally { log.mockRestore(); }
    expect(fetchUpstream).toHaveBeenCalledTimes(15);
    expect(cacheSet).toHaveBeenCalledTimes(15);
    const keys = (cacheSet.mock.calls as unknown as [string, string][]).map(([k]) => k);
    expect(keys.some((k) => k.includes('alice.example.com'))).toBe(true);
    expect(keys.some((k) => k.includes('carol.example.com'))).toBe(true);
  });

  // M-09 : le worker écrivait sous `cacheKey(compte, cible)`. La clé porte
  // désormais le serveur ; sans lui, le pré-remplissage du serveur par défaut
  // se peignait sous un autre serveur du compte à la même adresse.
  it('écrit sous la clé du serveur synchronisé, celle que relit le proxy', async () => {
    fetchUpstream.mockImplementation(slowUpstream);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await runCycle();
    } finally { log.mockRestore(); }
    const keys = (cacheSet.mock.calls as unknown as [string, string][]).map(([k]) => k);
    const alice = accounts.get('alice')!;
    const ofAlice = keys.filter((k) => k.includes('alice.example.com'));
    expect(ofAlice).toHaveLength(5);
    // Et l'identité de la ligne lue au départ (adresse, utilisateur FreshRSS),
    // comme le proxy : une lecture partie avant un changement d'utilisateur
    // tombe sous une clé que personne ne relit (relecture 1.9.0).
    for (const k of ofAlice) expect(k.startsWith(`k:${alice.user}:${alice.server}:https://alice.example.com|alice:https://alice.example.com/`)).toBe(true);
  });
});
