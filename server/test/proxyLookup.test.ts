import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

const { assertTargetSafe, BlockedTargetError, UnresolvedTargetError, LOOKUP_TIMEOUT_MS } =
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
  for (const code of ['EAI_AGAIN', 'ESERVFAIL', 'ETIMEDOUT']) {
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
  const refusals: [string, string | undefined][] = [
    ['un nom inexistant (ENOTFOUND)', 'ENOTFOUND'],
    ['un nom inexistant (EAI_NONAME, la forme de musl)', 'EAI_NONAME'],
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
