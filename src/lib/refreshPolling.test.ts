import { describe, it, expect } from 'vitest';
import { nextPhase, shouldTriggerRealRefresh, POLL_CAP_MS } from './refreshPolling';

const T0 = 1_000_000;

describe('nextPhase', () => {
  it('stays running while the job runs', () => {
    expect(nextPhase('running', T0, T0 + 5_000)).toBe('running');
  });

  it('keeps polling when the job is not visible yet', () => {
    expect(nextPhase(undefined, T0, T0 + 1_000)).toBe('running');
  });

  it('reports the terminal states of the job', () => {
    expect(nextPhase('done', T0, T0 + 1_000)).toBe('done');
    expect(nextPhase('failed', T0, T0 + 1_000)).toBe('failed');
  });

  it('gives up as "timeout" past the cap, never as "done"', () => {
    expect(nextPhase('running', T0, T0 + POLL_CAP_MS)).toBe('timeout');
    expect(nextPhase(undefined, T0, T0 + POLL_CAP_MS + 1)).toBe('timeout');
  });

  it('lets a job that finished on the cap boundary report its real result', () => {
    expect(nextPhase('done', T0, T0 + POLL_CAP_MS + 1)).toBe('done');
  });
});

describe('shouldTriggerRealRefresh', () => {
  it('needs both a token and an active server', () => {
    expect(shouldTriggerRealRefresh(true, 3)).toBe(true);
    expect(shouldTriggerRealRefresh(true, '3')).toBe(true);
  });

  it('refuses without a token', () => {
    expect(shouldTriggerRealRefresh(false, 3)).toBe(false);
  });

  it('refuses without an active server', () => {
    expect(shouldTriggerRealRefresh(true, null)).toBe(false);
    expect(shouldTriggerRealRefresh(true, undefined)).toBe(false);
  });
});
