/**
 * Browser-history layers for Android's back gesture (discussion #19).
 *
 * Opening an article on a phone, the feed drawer or the preferences lays a
 * surface over the screen without any history entry, so the system Back —
 * the gesture from the left edge — left the app instead of closing that
 * surface. Each such surface now pushes one history entry; a pop closes the
 * topmost open layer. Closing a layer from inside the app takes its entry
 * back with a synthetic `history.back()`, whose pop must close nothing.
 *
 * Android only, by platform and not by screen width: iOS paints its own
 * back semantics (edge swipe, no system button) and the owner asked that
 * nothing change there; desktops keep the browser's own Back.
 */
export type Layer = 'article' | 'drawer' | 'prefs';

/** Z-order: the last one is on top, so it closes first. */
const ORDER: readonly Layer[] = ['article', 'drawer', 'prefs'];

export function isAndroid(userAgent: string): boolean {
  return /\bAndroid\b/i.test(userAgent);
}

export interface HistoryLayersIO {
  push: (layer: Layer) => void;
  back: () => void;
  close: (layer: Layer) => void;
}

export class HistoryLayers {
  private open = new Set<Layer>();
  private depth = 0;          // entries we pushed and have not seen popped
  private syntheticPops = 0;  // backs we asked for, whose pops must be ignored

  constructor(private io: HistoryLayersIO) {}

  /** Call on every change of the three booleans; pushes or pops to match. */
  sync(state: Record<Layer, boolean>): void {
    for (const layer of ORDER) {
      const wasOpen = this.open.has(layer);
      if (state[layer] && !wasOpen) {
        this.open.add(layer);
        this.depth++;
        this.io.push(layer);
      } else if (!state[layer] && wasOpen) {
        this.open.delete(layer);
        // Closed from inside the app (a pop would have removed it from
        // `open` already): take the entry back, and ignore that pop.
        if (this.depth > 0) {
          this.depth--;
          this.syntheticPops++;
          this.io.back();
        }
      }
    }
  }

  /** Call on `popstate`. */
  onPop(): void {
    if (this.syntheticPops > 0) { this.syntheticPops--; return; }
    const top = [...ORDER].reverse().find((l) => this.open.has(l));
    if (!top) return;
    this.open.delete(top);
    if (this.depth > 0) this.depth--;
    this.io.close(top);
  }
}
