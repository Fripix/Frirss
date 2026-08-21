// In-memory registry of in-flight feed refreshes, keyed by user + server + kind.
// Deliberately not persisted: a job that outlived a restart would be
// meaningless — the HTTP request it tracks died with the process.

export type RefreshStatus = 'running' | 'done' | 'failed';

/**
 * A refresh and a preferences "Test" are different operations that happen to
 * hit the same upstream action: the sweep asks for every feed, the test asks
 * for exactly one. They must never share a registry slot — a test folded into
 * a running sweep would time out and report a perfectly good token as rejected,
 * and a sweep folded into a running test would report a one-feed job as a
 * complete sweep. The kind is part of the job identity, not a parameter of it.
 *
 * Closed set on purpose: the kind reaches a registry key, so a client must
 * never be able to mint an arbitrary one.
 */
export const REFRESH_KINDS = ['refresh', 'test'] as const;
export type RefreshKind = (typeof REFRESH_KINDS)[number];

export function isRefreshKind(v: unknown): v is RefreshKind {
  return typeof v === 'string' && (REFRESH_KINDS as readonly string[]).includes(v);
}

export interface RefreshJob {
  status: RefreshStatus;
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

/** Outgoing request budget. The client polling cap is aligned on this. */
export const REFRESH_TIMEOUT_MS = 10 * 60 * 1000;

const jobs = new Map<string, RefreshJob>();

const keyOf = (userId: number, serverId: string | number, kind: RefreshKind) =>
  `${userId}:${serverId}:${kind}`;

/** Error message with every known secret removed, capped for storage. */
export function sanitizeError(err: unknown, secrets: string[]): string {
  let msg = err instanceof Error ? err.message : String(err);
  for (const s of secrets) {
    if (s) msg = msg.split(s).join('«redacted»');
  }
  return msg.slice(0, 200);
}

// `kind` is last and defaults to 'refresh' so the common call site stays terse;
// it is nonetheless part of the identity, see REFRESH_KINDS above.
export function getJob(
  userId: number,
  serverId: string | number,
  kind: RefreshKind = 'refresh',
): RefreshJob | undefined {
  return jobs.get(keyOf(userId, serverId, kind));
}

/**
 * Start a refresh unless one is already running for this (user, server, kind).
 * `run` is fired and NOT awaited — the caller answers immediately.
 */
export function startJob(
  userId: number,
  serverId: string | number,
  run: (signal: AbortSignal) => Promise<void>,
  secrets: string[] = [],
  kind: RefreshKind = 'refresh',
): RefreshJob {
  const key = keyOf(userId, serverId, kind);
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
