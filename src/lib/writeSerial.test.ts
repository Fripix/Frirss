import { describe, it, expect } from 'vitest';
import { createWriteSerial } from './writeSerial';

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe('createWriteSerial (M-12)', () => {
  it('la première écriture d’une clé part tout de suite, sans attendre un tour', () => {
    const serial = createWriteSerial();
    const calls: string[] = [];
    void serial('a', async () => { calls.push('lu'); });
    expect(calls).toEqual(['lu']);
  });

  it('la seconde écriture sur la même clé attend la fin de la première', async () => {
    const serial = createWriteSerial();
    const calls: string[] = [];
    const first = deferred();
    const p1 = serial('a', async () => { calls.push('lu'); await first.promise; calls.push('lu ✓'); });
    const p2 = serial('a', async () => { calls.push('non lu'); });
    await flush();
    expect(calls).toEqual(['lu']);
    first.resolve();
    await p1; await p2;
    expect(calls).toEqual(['lu', 'lu ✓', 'non lu']);
  });

  it('un échec n’arrête pas la suite, et chacun reçoit son propre résultat', async () => {
    const serial = createWriteSerial();
    const p1 = serial('a', async () => { throw new Error('refus'); });
    const p2 = serial('a', async () => 'ok');
    await expect(p1).rejects.toThrow('refus');
    await expect(p2).resolves.toBe('ok');
  });

  it('deux clés différentes ne s’attendent pas', async () => {
    const serial = createWriteSerial();
    const calls: string[] = [];
    const hang = deferred();
    void serial('a', async () => { await hang.promise; });
    void serial('b', async () => { calls.push('b'); });
    expect(calls).toEqual(['b']);
    hang.resolve();
  });

  it('une clé dont la file s’est vidée repart sans attente', async () => {
    const serial = createWriteSerial();
    await serial('a', async () => {});
    await flush();
    const calls: string[] = [];
    void serial('a', async () => { calls.push('x'); });
    expect(calls).toEqual(['x']);
  });
});
