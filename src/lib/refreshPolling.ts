// State machine for the client side of a real feed refresh.
// Pure on purpose: the polling loop lives in the store, the decisions live here.

export type RefreshPhase = 'idle' | 'running' | 'done' | 'failed' | 'timeout';

export const POLL_INTERVAL_MS = 3_000;

/** Aligned on the backend's outgoing timeout: never give up before the job resolves. */
export const POLL_CAP_MS = 10 * 60 * 1000;

/**
 * Next phase from the job status reported by the backend.
 *
 * Past the cap we return 'timeout', never 'done': claiming a refresh finished
 * when we simply stopped watching is exactly the dishonesty this feature exists
 * to remove.
 */
export function nextPhase(
  job: 'running' | 'done' | 'failed' | undefined,
  startedAt: number,
  now: number,
): RefreshPhase {
  if (job === 'done') return 'done';
  if (job === 'failed') return 'failed';
  if (now - startedAt >= POLL_CAP_MS) return 'timeout';
  return 'running';
}

/**
 * Whether a refresh should go the real (server-side) route rather than the
 * read-only sync. Extracted so the branching is testable without mocking the
 * whole API layer.
 */
export function shouldTriggerRealRefresh(
  hasRefreshToken: boolean,
  activeServerId: string | number | null | undefined,
): boolean {
  return hasRefreshToken && activeServerId != null;
}
