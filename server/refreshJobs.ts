// In-memory registry of in-flight feed refreshes, keyed by user + server.
// Deliberately not persisted: a job that outlived a restart would be
// meaningless — the HTTP request it tracks died with the process.

export type RefreshStatus = 'running' | 'done' | 'failed';

export interface RefreshJob {
  status: RefreshStatus;
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

/** Outgoing request budget. The client polling cap is aligned on this. */
export const REFRESH_TIMEOUT_MS = 10 * 60 * 1000;

const jobs = new Map<string, RefreshJob>();

const keyOf = (userId: number, serverId: string | number) => `${userId}:${serverId}`;

/** Error message with every known secret removed, capped for storage. */
export function sanitizeError(err: unknown, secrets: string[]): string {
  let msg = err instanceof Error ? err.message : String(err);
  for (const s of secrets) {
    if (s) msg = msg.split(s).join('«redacted»');
  }
  return msg.slice(0, 200);
}

export function getJob(userId: number, serverId: string | number): RefreshJob | undefined {
  return jobs.get(keyOf(userId, serverId));
}

/**
 * Start a refresh unless one is already running for this (user, server).
 * `run` is fired and NOT awaited — the caller answers immediately.
 */
export function startJob(
  userId: number,
  serverId: string | number,
  run: (signal: AbortSignal) => Promise<void>,
  secrets: string[] = [],
): RefreshJob {
  const key = keyOf(userId, serverId);
  const existing = jobs.get(key);
  if (existing?.status === 'running') return existing;

  const job: RefreshJob = { status: 'running', startedAt: Date.now() };
  jobs.set(key, job);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REFRESH_TIMEOUT_MS);
  timer.unref?.();

  Promise.resolve().then(() => run(ac.signal)).then(
    () => { job.status = 'done'; },
    (err) => { job.status = 'failed'; job.error = sanitizeError(err, secrets); },
  ).finally(() => {
    clearTimeout(timer);
    job.finishedAt = Date.now();
  });

  return job;
}

/** Test-only: clear the registry between cases. */
export function __resetJobs(): void {
  jobs.clear();
}
