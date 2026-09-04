import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

// ── La résolution de la garde anti-SSRF, vue de près ──────────────────
// Deux mécanismes vivent dans `assertTargetSafe` et n'étaient tenus par aucun
// test, faute d'un poste d'où les observer : les routes HTTP ne montrent que
// le verdict final (403 ou non), jamais le TYPE de l'erreur ni le temps qu'il
// a fallu pour l'obtenir. D'où ce fichier, qui appelle la fonction
// directement.
//
// Le module `dns` est remplacé : c'est lui qu'on pilote pour fabriquer chaque
// échec (un code de résolution donné, ou aucune réponse du tout).
const { dnsLookup } = vi.hoisted(() => ({ dnsLookup: vi.fn() }));

vi.mock('dns', () => {
  const promises = { lookup: dnsLookup };
  const lookup = vi.fn();
  return { default: { lookup, promises }, lookup, promises };
});

// Le routeur est monté plus bas pour observer le VERDICT HTTP, pas seulement
// le type d'erreur : l'authentification n'est pas le sujet ici.
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: { id: number } }).user = { id: 1 };
    next();
  },
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { default: proxyRouter, assertTargetSafe, BlockedTargetError, UnresolvedTargetError, LOOKUP_TIMEOUT_MS } =
  await import('../routes/proxy.js');

const TARGET = 'https://news.example.com/a';

const failWith = (code: string | undefined) =>
  dnsLookup.mockRejectedValue(Object.assign(new Error(`getaddrinfo ${code ?? 'sans code'}`), { code }));

describe('assertTargetSafe — classement des échecs de résolution', () => {
  beforeEach(() => { dnsLookup.mockReset(); });

  // ── Panne : « réessaie » ────────────────────────────────────────────
  // Ces codes-là disent que le résolveur n'a pas répondu, pas que la cible est
  // mauvaise. `/api/extract` s'en sert pour servir quand même son cache — voir
  // `extractCache.test.ts` pour le comportement de bout en bout.
  //
  // Ce sont les trois seuls que ce chemin puisse recevoir pour une absence de
  // réponse : `EAI_AGAIN` (SERVFAIL, ou délai total épuisé), `EAI_FAIL` (les
  // autres rcodes d'échec — FORMERR, NOTIMP, et surtout REFUSED, celui du
  // résolveur filtrant qui redémarre) et le rejet du minuteur, `ETIMEDOUT`.
  for (const code of ['EAI_AGAIN', 'EAI_FAIL', 'ETIMEDOUT']) {
    it(`classe ${code} en panne de résolution`, async () => {
      failWith(code);
      await expect(assertTargetSafe(TARGET)).rejects.toBeInstanceOf(UnresolvedTargetError);
    });
  }

  // ── Refus : le résolveur a parlé ────────────────────────────────────
  // `UnresolvedTargetError` étant une SOUS-CLASSE de `BlockedTargetError`,
  // vérifier `instanceof BlockedTargetError` ne prouve rien ici : c'est
  // l'absence du sous-type qui distingue le refus de la panne, et c'est elle
  // qui garde le cache d'extraction fermé.
  //
  // Le code inconnu est dans la même liste, et c'est le sens du tri : la liste
  // des paniques est POSITIVE, tout ce qui n'y figure pas est un refus.
  //
  // Les trois derniers cas ne sont pas des doublons du code inconnu : ce sont
  // des chaînes que ce chemin ne reçoit JAMAIS, et les lister prouve que la
  // liste positive ne les rattrape pas si quelqu'un les y remet.
  // `EAI_NONAME` et `EAI_NODATA` sont relabellisés en `ENOTFOUND` par Node
  // avant tout appelant ; `ESERVFAIL` appartient à c-ares (`dns.resolve*`),
  // jamais appelé ici ; `EAI_SYSTEM` est remplacé par l'`errno` du moment dans
  // la traduction de libuv. Quoi qu'il arrive, le défaut reste le refus.
  const refusals: [string, string | undefined][] = [
    ['un nom inexistant (ENOTFOUND)', 'ENOTFOUND'],
    ['la forme brute que Node ne délivre jamais (EAI_NONAME)', 'EAI_NONAME'],
    ['un code de c-ares, hors de ce chemin (ESERVFAIL)', 'ESERVFAIL'],
    ["l'échec d'envoi de musl, tel que musl le nomme (EAI_SYSTEM)", 'EAI_SYSTEM'],
    ['un code inconnu', 'EQUELQUECHOSE'],
    ['une erreur sans code', undefined],
  ];
  for (const [label, code] of refusals) {
    it(`refuse ${label}`, async () => {
      failWith(code);
      const err = await assertTargetSafe(TARGET).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BlockedTargetError);
      expect(err).not.toBeInstanceOf(UnresolvedTargetError);
    });
  }
});

describe('assertTargetSafe — plafond de temps de la résolution', () => {
  afterEach(() => { vi.useRealTimers(); });

  // `dns.promises.lookup` n'accepte aucun délai : sans la course de
  // `lookupWithTimeout`, une requête reste immobile le temps que le résolveur
  // du système abandonne (sous musl, une dizaine de secondes) — et la garde
  // étant passée devant CHAQUE extraction, cela vaut aussi pour celles que
  // Redis aurait servies sans réseau.
  //
  // Le verdict n'est pas attendu par un `await` : une course supprimée ne
  // réglerait jamais la promesse, et le test resterait suspendu au lieu
  // d'échouer. C'est l'espion qui est interrogé, donc l'échec est immédiat.
  it('abandonne la résolution qui ne répond pas, et la classe en panne', async () => {
    vi.useFakeTimers();
    dnsLookup.mockReturnValue(new Promise(() => {}));   // ne se règle jamais

    const settled = vi.fn();
    void assertTargetSafe(TARGET).then(settled, settled);

    await vi.advanceTimersByTimeAsync(LOOKUP_TIMEOUT_MS - 1);
    expect(settled).not.toHaveBeenCalled();            // pas avant l'heure

    await vi.advanceTimersByTimeAsync(2);
    expect(settled).toHaveBeenCalledTimes(1);
    // Un délai dépassé est une panne, pas une cible refusée : le rejet du
    // minuteur porte un `code` pour tomber du bon côté du tri.
    expect(settled.mock.calls[0][0]).toBeInstanceOf(UnresolvedTargetError);
  });
});

// ── Le verdict rendu par `/api/proxy` lui-même ───────────────────────
// Le tri panne/refus n'était vérifié de bout en bout que par `/api/extract`.
// `/api/proxy` est pourtant la route que frappe l'écran de rattachement d'un
// serveur — celui dont le message accusait la cible d'un défaut de résolveur —
// et son 503 ne tenait que par déduction, les deux routes partageant
// `finishError`. Une déduction n'est pas un test.
describe('/api/proxy — une résolution sans réponse répond 503', () => {
  const app = express();
  app.use('/api/proxy', proxyRouter);

  // Une cible signée, comme celles du préchargement d'images hors ligne : la
  // ligne de journal de cette branche doit réduire le secret comme les autres.
  const SIGNED = 'https://news.example.com/a?token=s3cr3t-cdn&w=1200';

  beforeEach(() => { dnsLookup.mockReset(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('rend 503 « Target host unresolved », sans nommer la cible', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    dnsLookup.mockRejectedValue(Object.assign(new Error('getaddrinfo EAI_AGAIN'), { code: 'EAI_AGAIN' }));

    const res = await request(app).get('/api/proxy').set('X-Proxy-Target', SIGNED);

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Target host unresolved');
    expect(JSON.stringify(res.body)).not.toContain('news.example.com');
    const logged = warn.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('news.example.com');
    expect(logged).not.toContain('s3cr3t-cdn');
  });

  it('garde 403 pour un nom dont le résolveur dit qu\'il n\'existe pas', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    dnsLookup.mockRejectedValue(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }));

    const res = await request(app).get('/api/proxy').set('X-Proxy-Target', 'https://news.example.com/a');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Target host not allowed');
  });
});
