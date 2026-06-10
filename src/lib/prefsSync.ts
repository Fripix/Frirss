// ═══════════════════════════════════════════════════════════════════════
// Preference sync — server-side, per-user (not tied to the browser)
//
// Scope ("tout sauf le géométrique"): logical preferences (theme, feed /
// category / label order, display toggles, shortcuts, title/logo, viewMode,
// topbarVisible) are synced to the backend per user. Screen-dependent prefs
// (panel widths, 2/3-column layout, sidebar visibility) stay local.
//
//   • hydratePrefs() — pull from the server on login and apply to the stores
//   • write-through  — debounced push to the server when a synced field changes
//
// A `hydrating` guard prevents the hydration writes from re-triggering a push.
// ═══════════════════════════════════════════════════════════════════════
import { getPreferences, savePreferences } from '../api/backend';
import { useUiStore, UI_SYNC_KEYS } from '../stores/uiStore';
import { useThemeStore, THEME_SYNC_KEYS } from '../stores/themeStore';

let hydrating = false;
let started = false;
let unsubUi: (() => void) | null = null;
let unsubTheme: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

// Build the full set of synced prefs from the current store state.
function collectPrefs(): Record<string, unknown> {
  const ui = useUiStore.getState() as unknown as Record<string, unknown>;
  const th = useThemeStore.getState() as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of UI_SYNC_KEYS) out[k] = ui[k];
  for (const k of THEME_SYNC_KEYS) out[k] = th[k];
  return out;
}

// Debounced write-through to the server.
function schedulePush(): void {
  if (hydrating) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    timer = null;
    try {
      await savePreferences(collectPrefs());
    } catch {
      // Best-effort: local copy stays in localStorage; retried on next change.
    }
  }, 800);
}

// Subscribe to both stores; push when any synced field changes by reference.
function startSync(): void {
  if (started) return;
  started = true;

  unsubUi = useUiStore.subscribe((state, prev) => {
    if (hydrating) return;
    const s = state as unknown as Record<string, unknown>;
    const p = prev as unknown as Record<string, unknown>;
    for (const k of UI_SYNC_KEYS) {
      if (s[k] !== p[k]) {
        schedulePush();
        return;
      }
    }
  });

  unsubTheme = useThemeStore.subscribe((state, prev) => {
    if (hydrating) return;
    const s = state as unknown as Record<string, unknown>;
    const p = prev as unknown as Record<string, unknown>;
    for (const k of THEME_SYNC_KEYS) {
      if (s[k] !== p[k]) {
        schedulePush();
        return;
      }
    }
  });
}

// Pull preferences from the server and apply them; then start write-through.
// On a brand-new account (nothing stored server-side), seed the server with
// whatever is currently local so future devices inherit it.
export async function hydratePrefs(): Promise<void> {
  let serverPrefs: Record<string, unknown> = {};
  try {
    serverPrefs = await getPreferences();
  } catch {
    serverPrefs = {};
  }

  const syncedKeys = [...UI_SYNC_KEYS, ...THEME_SYNC_KEYS];
  const hasAny =
    serverPrefs &&
    typeof serverPrefs === 'object' &&
    Object.keys(serverPrefs).some((k) => syncedKeys.includes(k));

  hydrating = true;
  try {
    if (hasAny) {
      useUiStore.getState().applyServerPrefs(serverPrefs);
      useThemeStore.getState().applyServerPrefs(serverPrefs);
    }
  } finally {
    hydrating = false;
  }

  startSync();

  if (!hasAny) {
    // Seed the server from local state (migration on first login).
    try {
      await savePreferences(collectPrefs());
    } catch {
      // ignore — will be pushed on the next change
    }
  }
}

// Tear down the write-through subscriptions (on logout).
export function stopSync(): void {
  if (unsubUi) unsubUi();
  if (unsubTheme) unsubTheme();
  unsubUi = null;
  unsubTheme = null;
  started = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
