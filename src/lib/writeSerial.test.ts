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

describe('createWriteSerial — écriture groupée sur plusieurs clés (R2-3)', () => {
  it('un lot attend que les écritures en vol de ses clés soient réglées', async () => {
    const serial = createWriteSerial();
    const calls: string[] = [];
    const first = deferred();
    const p1 = serial('a', async () => { calls.push('a'); await first.promise; calls.push('a ✓'); });
    const lot = serial.many(['a', 'b', 'c'], async () => { calls.push('lot'); });
    await flush();
    expect(calls).toEqual(['a']);
    first.resolve();
    await p1; await lot;
    expect(calls).toEqual(['a', 'a ✓', 'lot']);
  });

  it('un lot dont aucune clé n’est en vol part tout de suite, dans le même tour', () => {
    const serial = createWriteSerial();
    const calls: string[] = [];
    const hang = deferred();
    void serial('z', async () => { await hang.promise; });
    void serial.many(['a', 'b'], async () => { calls.push('lot'); });
    expect(calls).toEqual(['lot']);
    hang.resolve();
  });

  it('une écriture d’une clé du lot attend la fin du lot', async () => {
    const serial = createWriteSerial();
    const calls: string[] = [];
    const lotDone = deferred();
    const lot = serial.many(['a', 'b'], async () => { calls.push('lot'); await lotDone.promise; calls.push('lot ✓'); });
    const p = serial('b', async () => { calls.push('b'); });
    await flush();
    expect(calls).toEqual(['lot']);
    lotDone.resolve();
    await lot; await p;
    expect(calls).toEqual(['lot', 'lot ✓', 'b']);
  });

  it('les clés du lot se libèrent une fois le lot réglé', async () => {
    const serial = createWriteSerial();
    await serial.many(['a', 'b'], async () => {});
    await flush();
    const calls: string[] = [];
    void serial('a', async () => { calls.push('a'); });
    expect(calls).toEqual(['a']);
  });
});

// Écriture à borne (« tout lu », marquage « en dessous ») : elle ne nomme
// aucun article, donc elle attend TOUTES les écritures en vol de son groupe,
// et toute écriture du groupe lancée pendant elle l'attend à son tour.
describe('createWriteSerial — écriture à borne sur tout un groupe', () => {
  const groupOf = (key: string) => (key.endsWith('|read') ? key.split('|')[0] : null);

  it('attend toutes les écritures en vol du groupe, et seulement elles', async () => {
    const serial = createWriteSerial({ groupOf });
    const calls: string[] = [];
    const a = deferred();
    const p1 = serial('s1|a|read', async () => { calls.push('a'); await a.promise; calls.push('a ✓'); });
    void serial('s1|b|star', async () => { await new Promise(() => {}); }); // autre attribut
    void serial('s2|c|read', async () => { await new Promise(() => {}); }); // autre portée
    const borne = serial.barrier('s1', async () => { calls.push('borne'); });
    await flush();
    expect(calls).toEqual(['a']);
    a.resolve();
    await p1; await borne;
    expect(calls).toEqual(['a', 'a ✓', 'borne']);
  });

  it('part dans le même tour quand rien du groupe n’est en vol', () => {
    const serial = createWriteSerial({ groupOf });
    const calls: string[] = [];
    void serial('s2|c|read', async () => { await new Promise(() => {}); });
    void serial.barrier('s1', async () => { calls.push('borne'); });
    expect(calls).toEqual(['borne']);
  });

  it('une écriture du groupe lancée pendant la borne attend son règlement', async () => {
    const serial = createWriteSerial({ groupOf });
    const calls: string[] = [];
    const done = deferred();
    const borne = serial.barrier('s1', async () => { calls.push('borne'); await done.promise; calls.push('borne ✓'); });
    const p = serial('s1|a|read', async () => { calls.push('a'); });
    const lot = serial.many(['s1|b|read', 's1|c|read'], async () => { calls.push('lot'); });
    const ailleurs = serial('s2|a|read', async () => { calls.push('ailleurs'); });
    await flush();
    expect(calls).toEqual(['borne', 'ailleurs']);
    done.resolve();
    await borne; await p; await lot; await ailleurs;
    expect(calls).toEqual(['borne', 'ailleurs', 'borne ✓', 'a', 'lot']);
  });

  it('deux bornes du même groupe se suivent, et le groupe se libère ensuite', async () => {
    const serial = createWriteSerial({ groupOf });
    const calls: string[] = [];
    const first = deferred();
    const b1 = serial.barrier('s1', async () => { calls.push('b1'); await first.promise; });
    const b2 = serial.barrier('s1', async () => { calls.push('b2'); });
    await flush();
    expect(calls).toEqual(['b1']);
    first.resolve();
    await b1; await b2; await flush();
    void serial('s1|a|read', async () => { calls.push('a'); });
    expect(calls).toEqual(['b1', 'b2', 'a']);
  });

  it('un échec de la borne libère quand même la suite', async () => {
    const serial = createWriteSerial({ groupOf });
    const borne = serial.barrier('s1', async () => { throw new Error('refus'); });
    const p = serial('s1|a|read', async () => 'ok');
    await expect(borne).rejects.toThrow('refus');
    await expect(p).resolves.toBe('ok');
  });
});
