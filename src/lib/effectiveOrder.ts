import type { FeedSetting } from '../stores/uiStore';

/** Order in which a view lists its articles. FreshRSS serves `newest` unless asked otherwise. */
export type ArticleOrder = 'newest' | 'oldest';

/** Coerce a stored or synced value to a known order; anything else is the default. */
export function normalizeArticleOrder(v: unknown): ArticleOrder {
  return v === 'oldest' ? 'oldest' : 'newest';
}

/** A position on screen, as the row menu names it. */
export type ScreenDirection = 'above' | 'below';

/**
 * Article order in effect for the current view: a per-feed override wins over
 * the global (synced) order. An absent override means "follow the global".
 * Sibling of `effectiveLayout()`; the only place that reads `FeedSetting.order`.
 */
export function effectiveOrder(
  globalOrder: ArticleOrder,
  feedSettings: Record<string, FeedSetting>,
  feedId: string | undefined,
): ArticleOrder {
  if (!feedId) return globalOrder;
  return feedSettings[feedId]?.order || globalOrder;
}

/**
 * Translate a position on screen into an entry direction for the range
 * mark-read action, whose `'above'` means "entries newer than this one".
 * That holds only while the newest sits on top: with the oldest first, the
 * rows above are the OLDER entries, so the direction flips.
 */
export function entryDirection(screen: ScreenDirection, order: ArticleOrder): ScreenDirection {
  if (order === 'newest') return screen;
  return screen === 'above' ? 'below' : 'above';
}
