// ═══════════════════════════════════════════════════════════════════════
// Last-view persistence — remember which feed/label + filter the user was
// looking at, so reopening the app (reload / relaunched PWA) lands back on
// it instead of the default home view.
//
// Device-local (not synced): like panel widths and sidebar visibility, the
// resume point belongs to each device. Kept per active FreshRSS server so a
// multi-server user resumes independently on each.
//
// Scope: the view only (feed/label + filter). Scroll position and the open
// article are intentionally not restored.
// ═══════════════════════════════════════════════════════════════════════
import type { Subscription, Filter } from '../types';

export interface LastView {
  feed: Subscription | null;
  filter: Filter;
}

const PREFIX = 'frirss_lastView_';
const VALID_FILTERS: Filter[] = ['all', 'unread', 'starred', 'readlater'];

function keyFor(serverId: string | number | null | undefined): string {
  return PREFIX + (serverId != null ? String(serverId) : 'default');
}

export function saveLastView(
  serverId: string | number | null | undefined,
  view: LastView,
): void {
  try {
    localStorage.setItem(keyFor(serverId), JSON.stringify(view));
  } catch {
    // Storage unavailable/full — resuming is best-effort, never fatal.
  }
}

export function loadLastView(
  serverId: string | number | null | undefined,
): LastView | null {
  try {
    const raw = localStorage.getItem(keyFor(serverId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastView>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.filter || !VALID_FILTERS.includes(parsed.filter)) return null;
    const feed =
      parsed.feed && typeof parsed.feed === 'object'
        ? (parsed.feed as Subscription)
        : null;
    return { feed, filter: parsed.filter };
  } catch {
    return null;
  }
}
