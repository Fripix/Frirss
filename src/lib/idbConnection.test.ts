import { describe, it, expect, vi } from 'vitest';
import { cachedConnection, transactionOn } from './idbConnection';

/*
 * Les deux stores IndexedDB gardaient leur connexion pour toujours. Quand le
 * navigateur efface le stockage du site (manque de place sur le disque,
 * données effacées par l'utilisateur), il FERME cette connexion : chaque
 * lecture et chaque écriture suivante échouait alors en silence jusqu'au
 * rechargement — extraits non gardés, et file des actions hors ligne perdue.
 * Vu sur Android pendant une préparation hors ligne de 6 600 articles.
 */
class FakeDb extends EventTarget {
  closed = false;
  close() { this.closed = true; }
  transaction() {
    if (this.closed) throw new DOMException('The database connection is closing.', 'InvalidStateError');
    return { objectStore: () => ({}) };
  }
}
const asDb = (d: FakeDb) => d as unknown as IDBDatabase;

describe('cachedConnection', () => {
  it('ouvre une fois et réutilise la connexion', async () => {
    const open = vi.fn(async () => asDb(new FakeDb()));
    const conn = cachedConnection(open);
    const a = await conn.get();
    expect(await conn.get()).toBe(a);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('rouvre après une fermeture par le navigateur (stockage effacé)', async () => {
    const dbs = [new FakeDb(), new FakeDb()];
    const open = vi.fn(async () => asDb(dbs[open.mock.calls.length - 1]));
    const conn = cachedConnection(open);
    expect(await conn.get()).toBe(asDb(dbs[0]));
    dbs[0].closed = true;
    dbs[0].dispatchEvent(new Event('close'));
    expect(await conn.get()).toBe(asDb(dbs[1]));
  });

  it('cède la place à une nouvelle version, puis rouvre', async () => {
    const dbs = [new FakeDb(), new FakeDb()];
    const open = vi.fn(async () => asDb(dbs[open.mock.calls.length - 1]));
    const conn = cachedConnection(open);
    await conn.get();
    dbs[0].dispatchEvent(new Event('versionchange'));
    expect(dbs[0].closed).toBe(true);
    expect(await conn.get()).toBe(asDb(dbs[1]));
  });

  it('retente une ouverture qui a échoué, au lieu de garder l’échec', async () => {
    const ok = new FakeDb();
    const open = vi.fn()
      .mockRejectedValueOnce(new Error('QuotaExceededError'))
      .mockResolvedValueOnce(asDb(ok));
    const conn = cachedConnection(open);
    await expect(conn.get()).rejects.toThrow();
    expect(await conn.get()).toBe(asDb(ok));
  });
});

describe('transactionOn', () => {
  it('oublie une connexion fermée sans événement, pour que l’appel suivant rouvre', async () => {
    const dbs = [new FakeDb(), new FakeDb()];
    const open = vi.fn(async () => asDb(dbs[open.mock.calls.length - 1]));
    const conn = cachedConnection(open);
    const first = await conn.get();
    dbs[0].closed = true; // fermée, mais l'événement n'est pas (encore) arrivé
    expect(() => transactionOn(conn, first, 'store', 'readonly')).toThrow();
    expect(await conn.get()).toBe(asDb(dbs[1]));
  });

  // Safari signale la perte de la connexion (« Connection to Indexed Database
  // server lost ») en `UnknownError`, sans événement `close`.
  it('oublie aussi une connexion perdue sous iOS (UnknownError)', async () => {
    const dbs = [new FakeDb(), new FakeDb()];
    const open = vi.fn(async () => asDb(dbs[open.mock.calls.length - 1]));
    const conn = cachedConnection(open);
    const first = await conn.get();
    (dbs[0] as unknown as { transaction: () => never }).transaction = () => { throw new DOMException('Connection to Indexed Database server lost.', 'UnknownError'); };
    expect(() => transactionOn(conn, first, 'store', 'readonly')).toThrow();
    expect(await conn.get()).toBe(asDb(dbs[1]));
  });

  // Une transaction lancée sur l'ancienne connexion peut échouer APRÈS la
  // réouverture : elle ne doit pas jeter la neuve, restée saine.
  it('n’oublie pas une connexion neuve à cause de l’ancienne', async () => {
    const dbs = [new FakeDb(), new FakeDb()];
    const open = vi.fn(async () => asDb(dbs[open.mock.calls.length - 1]));
    const conn = cachedConnection(open);
    const old = await conn.get();
    dbs[0].closed = true;
    dbs[0].dispatchEvent(new Event('close'));
    const fresh = await conn.get();
    expect(() => transactionOn(conn, old, 'store', 'readonly')).toThrow();
    expect(await conn.get()).toBe(fresh);
    expect(open).toHaveBeenCalledTimes(2);
  });

  // L'ancienne connexion fermée, une réouverture en cours : une transaction
  // qui échoue alors sur l'ancienne ne doit pas jeter la réouverture.
  it('ne jette pas une réouverture en cours à cause de l’ancienne connexion', async () => {
    const dbs = [new FakeDb(), new FakeDb(), new FakeDb()];
    const open = vi.fn(async () => asDb(dbs[open.mock.calls.length - 1]));
    const conn = cachedConnection(open);
    const old = await conn.get();
    dbs[0].closed = true;
    dbs[0].dispatchEvent(new Event('close'));
    const reopening = conn.get();
    expect(() => transactionOn(conn, old, 'store', 'readonly')).toThrow();
    expect(await conn.get()).toBe(await reopening);
    expect(open).toHaveBeenCalledTimes(2);
  });
});

