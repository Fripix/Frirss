import { describe, it, expect, beforeEach } from 'vitest';
import { startJob, getJob, sanitizeError, __resetJobs, __settleJobs } from './refreshJobs.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { __resetJobs(); });

describe('sanitizeError', () => {
  it('redacts every secret it is given', () => {
    const msg = sanitizeError(new Error('failed for token=s3cr3t-token'), ['s3cr3t-token']);
    expect(msg).not.toContain('s3cr3t-token');
    expect(msg).toContain('«redacted»');
  });

  it('handles non-Error throws and ignores empty secrets', () => {
    expect(sanitizeError('boom', [''])).toBe('boom');
  });

  it('caps the length', () => {
    expect(sanitizeError(new Error('x'.repeat(500)), []).length).toBe(200);
  });
});

describe('startJob', () => {
  it('marks the job running, then done', async () => {
    startJob(1, 7, async () => {});
    expect(getJob(1, 7)?.status).toBe('running');
    await tick();
    expect(getJob(1, 7)?.status).toBe('done');
    expect(getJob(1, 7)?.finishedAt).toBeTypeOf('number');
  });

  it('records a failure with a redacted message', async () => {
    startJob(1, 7, async () => { throw new Error('upstream said token=s3cr3t-token'); }, ['s3cr3t-token']);
    await tick();
    const job = getJob(1, 7);
    expect(job?.status).toBe('failed');
    expect(job?.error).not.toContain('s3cr3t-token');
  });

  it('does not start a second job while one is running', async () => {
    let calls = 0;
    const slow = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); };
    const first = startJob(1, 7, slow);
    const second = startJob(1, 7, slow);
    await tick();
    expect(calls).toBe(1);
    expect(second).toBe(first);
  });

  it('allows a new job once the previous one finished', async () => {
    let calls = 0;
    startJob(1, 7, async () => { calls++; });
    await tick();
    startJob(1, 7, async () => { calls++; });
    await tick();
    expect(calls).toBe(2);
  });

  it('keeps jobs of different users and servers apart', async () => {
    startJob(1, 7, async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(getJob(2, 7)).toBeUndefined();
    expect(getJob(1, 8)).toBeUndefined();
  });

  it('marks the job failed when run throws synchronously', async () => {
    startJob(1, 7, (() => { throw new Error('sync boom'); }) as unknown as (s: AbortSignal) => Promise<void>);
    expect(getJob(1, 7)?.status).toBe('running');
    await tick();
    expect(getJob(1, 7)?.status).toBe('failed');
    expect(getJob(1, 7)?.error).toContain('sync boom');
  });
});

describe('__settleJobs', () => {
  // Pourquoi cette API existe : `startJob` lance `run` SANS l'attendre, ce qui
  // est le bon comportement en production — l'appelant répond tout de suite.
  // En test, cela laisse des appels réseau en vol qui atterrissent dans le
  // `vi.stubGlobal('fetch')` d'un test ULTÉRIEUR, et deviennent son
  // `mock.calls[0]`. C'est la cause de l'échec intermittent de
  // « attaches the token to the server's own API URL » dans `api.test.ts` :
  // le test lisait les en-têtes d'une requête qui n'était pas la sienne.
  it('waits for a job still in flight', async () => {
    let done = false;
    startJob(1, 'srv', async () => {
      await new Promise((r) => setTimeout(r, 20));
      done = true;
    });
    expect(done).toBe(false);
    await __settleJobs();
    expect(done).toBe(true);
    expect(getJob(1, 'srv')?.status).toBe('done');
  });

  it('waits for a job that fails, without throwing', async () => {
    startJob(1, 'srv', async () => {
      await new Promise((r) => setTimeout(r, 10));
      throw new Error('boom');
    });
    await expect(__settleJobs()).resolves.toBeUndefined();
    expect(getJob(1, 'srv')?.status).toBe('failed');
  });

  it('returns immediately when nothing is running', async () => {
    await expect(__settleJobs()).resolves.toBeUndefined();
  });
});
