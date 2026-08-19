/** Article-level actions that survive being made offline. */
export type QueuedActionType = 'read' | 'star' | 'readLater' | 'label';

export interface QueuedAction {
  /** articleId + type (+ label), so repeats collapse onto one another. */
  key: string;
  articleId: string;
  type: QueuedActionType;
  /** Target state, e.g. read = true. */
  value: boolean;
  labelId?: string;
  at: number;
  attempts: number;
}

export const MAX_ATTEMPTS = 3;

export function actionKey(articleId: string, type: QueuedActionType, labelId?: string): string {
  return labelId ? `${articleId}|${type}|${labelId}` : `${articleId}|${type}`;
}

/**
 * Add an action, collapsing it onto any pending one for the same article and
 * type: only the final state matters. Without this a long offline session would
 * replay hundreds of calls that cancel each other out.
 */
export function mergeAction(queue: QueuedAction[], action: QueuedAction): QueuedAction[] {
  const i = queue.findIndex((a) => a.key === action.key);
  if (i === -1) return [...queue, action];
  const next = [...queue];
  // Superseded: the previous attempts counted against a state we no longer want.
  next[i] = { ...action, attempts: 0 };
  return next;
}

/**
 * Did this fail for lack of network (→ queue it) or because the server refused
 * it (→ roll back)? A 4xx is a real refusal and must never be replayed; a 5xx
 * is the server having a bad moment, worth retrying.
 */
export function isNetworkFailure(error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  if (typeof status !== 'number') return true; // no response at all = no network
  return status >= 500;
}

export function shouldRetry(attempts: number): boolean {
  return attempts < MAX_ATTEMPTS;
}
