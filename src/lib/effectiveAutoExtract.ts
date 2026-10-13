import type { FeedSetting } from '../stores/uiStore';

/**
 * Whether an article from `feedId` opens as its extracted full text: the
 * feed's own choice when it made one (on or off), else the global default.
 * Sibling of `effectiveLayout()` and `effectiveOrder()`, and the only reader
 * of `FeedSetting.autoExtract` — seven call sites once read the flag directly,
 * and a global default would have been invisible to every one of them.
 */
export function effectiveAutoExtract(
  globalDefault: boolean,
  feedSettings: Record<string, FeedSetting>,
  feedId: string | undefined,
): boolean {
  if (!feedId) return globalDefault;
  const own = feedSettings[feedId]?.autoExtract;
  return own === undefined ? globalDefault : own;
}
