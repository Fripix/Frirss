import { useEffect, useRef } from 'react';
import { HistoryLayers, isAndroid, type Layer, type OverlayClose } from '../lib/historyLayers';

/**
 * Lets Android's back gesture close the surface on top instead of leaving
 * the app. See `src/lib/historyLayers.ts` for the rules; this file only wires
 * them to `window.history` and `popstate`, through ONE registry shared by the
 * three fixed layers (`useAndroidBack`, in `App.tsx`) and every floating
 * surface (`useBackLayer`). A no-op off Android, so iOS and desktops behave
 * exactly as before.
 */

let layers: HistoryLayers | null = null;
let onPop: ((e: PopStateEvent) => void) | null = null;
let closeFixed: Record<Layer, () => void> | null = null;

function depthOf(state: unknown): number | undefined {
  const d = (state as { frirssDepth?: unknown } | null)?.frirssDepth;
  return typeof d === 'number' ? d : undefined;
}

function registry(): HistoryLayers | null {
  if (typeof navigator === 'undefined' || !isAndroid(navigator.userAgent)) return null;
  if (layers) return layers;
  const created = new HistoryLayers({
    push: (depth) => window.history.pushState({ frirssDepth: depth }, ''),
    go: (delta) => window.history.go(delta),
    close: (layer) => closeFixed?.[layer](),
    schedule: (fn) => queueMicrotask(fn),
  }, depthOf(window.history.state) ?? 0);
  onPop = (e) => created.onPop(depthOf(e.state));
  window.addEventListener('popstate', onPop);
  layers = created;
  return created;
}

/** Tests only: forget the registry and its listener. */
export function resetBackLayers(): void {
  if (onPop) window.removeEventListener('popstate', onPop);
  layers = null; onPop = null; closeFixed = null;
}

/** The three fixed layers: article on a phone, feed drawer, preferences. */
export function useAndroidBack(
  open: Record<Layer, boolean>,
  close: Record<Layer, () => void>,
): void {
  useEffect(() => { closeFixed = close; });
  useEffect(() => {
    registry()?.sync(open);
  }, [open.article, open.drawer, open.prefs]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * A floating surface (bottom sheet, confirmation, context menu, popover,
 * dialog): while `open`, it owns one history entry and Android's back closes
 * it — it alone. Closed any other way (finger, Escape, button, unmount), its
 * entry is taken back without closing anything else. `onClose` may return
 * `false` to refuse (a confirmation at work): it then keeps its entry.
 */
export function useBackLayer(open: boolean, onClose: OverlayClose): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const reg = registry();
    if (!reg) return;
    const token = reg.openOverlay(() => closeRef.current());
    return () => reg.closeOverlay(token);
  }, [open]);
}
