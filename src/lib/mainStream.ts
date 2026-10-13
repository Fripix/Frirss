import type { Subscription } from '../types';

/** "Everything but hidden": what every FreshRSS serves as the home view. */
export const READING_LIST_STREAM = 'user/-/state/com.google/reading-list';
/**
 * "Everything a feed asked to be shown in the main stream": feeds set to
 * "show in its category only" (or only in their own view) stay out. FreshRSS
 * 1.28+ serves it, and bounds mark-all-as-read and items/ids by it too.
 */
export const MAIN_STREAM = 'user/-/state/org.freshrss/main';

/**
 * Whether a feed belongs in the home view. A feed with no known priority
 * comes from a FreshRSS that predates `frss:priority` — it has no
 * visibility setting to honour, so it stays where it always was.
 */
export function inMainStream(sub: Pick<Subscription, 'priority'>): boolean {
  return sub.priority === undefined || sub.priority === 'main' || sub.priority === 'important';
}

/**
 * The stream behind "All feeds" / "Unread". `org.freshrss/main` exists only
 * on FreshRSS 1.28+, and the only reliable sign of that is a priority on at
 * least one subscription: an older server gets `reading-list`, unchanged.
 */
export function homeStreamId(subscriptions: readonly Pick<Subscription, 'priority'>[]): string {
  return subscriptions.some((s) => s.priority !== undefined) ? MAIN_STREAM : READING_LIST_STREAM;
}

/** Ids of the feeds the home view actually shows — for counters and arrivals. */
export function mainStreamFeedIds(subscriptions: readonly Subscription[]): string[] {
  return subscriptions.filter(inMainStream).map((s) => s.id);
}

/**
 * Unread badge of "All feeds" / "Unread": the per-feed counts of the feeds
 * the home view shows. Summing every subscription promised articles the list
 * would never show. Derived keys (labels, states) are not feeds and are
 * ignored, as before.
 */
export function homeUnreadTotal(
  unreadCounts: Record<string, number>,
  subscriptions: readonly Subscription[],
): number {
  let total = 0;
  for (const sub of subscriptions) {
    if (inMainStream(sub)) total += unreadCounts[sub.id] || 0;
  }
  return total;
}
