import { describe, it, expect, beforeEach } from 'vitest';
import { startJob, getJob, sanitizeError, __resetJobs } from './refreshJobs.js';

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
    expect(calls).toBe(1);
    expect(second).toBe(first);
  });

  it('allows a new job once the previous one finished', async () => {
    let calls = 0;
    startJob(1, 7, async () => { calls++; });
    await tick();
    startJob(1, 7, async () => { calls++; });
    expect(calls).toBe(2);
  });

  it('keeps jobs of different users and servers apart', async () => {
    startJob(1, 7, async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(getJob(2, 7)).toBeUndefined();
    expect(getJob(1, 8)).toBeUndefined();
  });
});
