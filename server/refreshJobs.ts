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

/** Promesses des travaux en vol — uniquement pour `__settleJobs` (tests). */
const inFlight = new Set<Promise<void>>();

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

  const settled = Promise.resolve().then(() => run(ac.signal)).then(
    () => { job.status = 'done'; },
    (err) => { job.status = 'failed'; job.error = sanitizeError(err, secrets); },
  ).finally(() => {
    clearTimeout(timer);
    job.finishedAt = Date.now();
    inFlight.delete(settled);
  });
  // Gardé pour que les TESTS puissent attendre la fin — voir `__settleJobs`.
  // La production ne s'en sert pas : ne pas attendre est ici le comportement
  // voulu, l'appelant répond tout de suite.
  inFlight.add(settled);

  return job;
}

/** Test-only: clear the registry between cases. */
export function __resetJobs(): void {
  jobs.clear();
}

/**
 * Test-only : attend que tout travail encore en vol soit terminé.
 *
 * `startJob` lance `run` **sans l'attendre**, et c'est le bon comportement en
 * production — l'appelant répond immédiatement. En test, cela laissait des
 * appels réseau se poser après coup, dans le `vi.stubGlobal('fetch')` d'un
 * test *ultérieur*, où ils devenaient son `mock.calls[0]`. Un test lisait
 * alors les en-têtes d'une requête qui n'était pas la sienne, par
 * intermittence et selon la charge de la machine.
 *
 * Ne rejette jamais : un travail en échec a déjà été enregistré sur le job,
 * et faire échouer le nettoyage sur ce motif masquerait le vrai test.
 */
export async function __settleJobs(): Promise<void> {
  while (inFlight.size) {
    await Promise.allSettled([...inFlight]);
  }
}
