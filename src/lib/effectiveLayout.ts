import type { FeedSetting } from '../stores/uiStore';

/**
 * Panel layout in effect for the current view: a per-feed override wins over
 * the global (device-local) layout. An empty/absent override means "default".
 */
export function effectiveLayout(
  globalLayout: string,
  feedSettings: Record<string, FeedSetting>,
  feedId: string | undefined,
): string {
  if (!feedId) return globalLayout;
  return feedSettings[feedId]?.layout || globalLayout;
}
