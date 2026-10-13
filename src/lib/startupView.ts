import type { LastView } from './lastView';

/**
 * What FriRSS opens on at launch and on reload. `last` is the historical
 * behaviour — the view left on this server, saved by `lastView.ts` — and
 * stays the default. `all` and `unread` are the two home entries, opened
 * every time regardless of what was left open (discussion #19).
 */
export type StartupView = 'last' | 'all' | 'unread';

export function normalizeStartupView(v: unknown): StartupView {
  return v === 'all' || v === 'unread' ? v : 'last';
}

export type StartupAction =
  | { kind: 'restore'; view: LastView }
  | { kind: 'home-all' }
  | { kind: 'home-unread' }
  | { kind: 'default' };

/** The saved view keeps being written whatever the setting: switching back to `last` costs nothing. */
export function startupAction(setting: StartupView, saved: LastView | null): StartupAction {
  if (setting === 'all') return { kind: 'home-all' };
  if (setting === 'unread') return { kind: 'home-unread' };
  return saved ? { kind: 'restore', view: saved } : { kind: 'default' };
}
