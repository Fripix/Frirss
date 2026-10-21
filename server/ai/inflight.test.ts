// server/ai/inflight.test.ts
import { describe, it, expect } from 'vitest';
import { shareInflight, inflightSize } from './inflight.js';

describe('shareInflight', () => {
  it('starts the work once for two identical keys in flight and says who joined', async () => {
    let starts = 0;
    let release!: (v: string) => void;
    const start = () => { starts += 1; return new Promise<string>((r) => { release = r; }); };
    const one = shareInflight('k', start);
    const two = shareInflight('k', start);
    expect(inflightSize()).toBe(1);
    release('done');
    expect(await one).toEqual({ value: 'done', shared: false });
    expect(await two).toEqual({ value: 'done', shared: true });
    expect(starts).toBe(1);
    expect(inflightSize()).toBe(0);
  });
  it('runs two different keys separately', async () => {
    let starts = 0;
    const start = async () => { starts += 1; return starts; };
    await Promise.all([shareInflight('a', start), shareInflight('b', start)]);
    expect(starts).toBe(2);
    expect(inflightSize()).toBe(0);
  });
  it('rejects every caller on failure, empties the table, and starts afresh afterwards', async () => {
    let starts = 0;
    let fail!: (e: Error) => void;
    const start = () => { starts += 1; return new Promise<string>((_r, j) => { fail = j; }); };
    const one = shareInflight('f', start).catch((e: Error) => e.message);
    const two = shareInflight('f', start).catch((e: Error) => e.message);
    fail(new Error('down'));
    expect(await one).toBe('down');
    expect(await two).toBe('down');
    expect(inflightSize()).toBe(0);
    const again = shareInflight('f', async () => { starts += 1; return 'ok'; });
    expect(await again).toEqual({ value: 'ok', shared: false });
    expect(starts).toBe(2);
  });
});
