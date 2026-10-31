import type { FeedSetting } from '../stores/uiStore';
import { feedOverride } from './feedOverride';

/**
 * Panel layout in effect for the current view: a per-feed override wins over
 * the global (device-local) layout. An empty/absent override means "default".
 */
export function effectiveLayout(
  globalLayout: string,
  feedSettings: Record<string, FeedSetting>,
  feedId: string | undefined,
  serverId?: string | number | null,
): string {
  if (!feedId) return globalLayout;
  return feedOverride(feedSettings, serverId, feedId).layout || globalLayout;
}
