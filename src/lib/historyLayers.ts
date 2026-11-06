/**
 * Browser-history layers for Android's back gesture (discussion #19, M-08).
 *
 * Every surface laid over the screen — the article on a phone, the feed
 * drawer, the preferences, and every floating surface (bottom sheet,
 * confirmation, context menu, popover) — owns one history entry; a pop closes
 * the topmost open layer, and nothing else. Before 1.9.0 only the first three
 * did: Back with a sheet open left the app, closed the article under the
 * « More » sheet, or closed the drawer and left a feed's menu on screen.
 *
 * Entries are anonymous: what matters is how many there are. Each pushed
 * entry records its depth in its state, so a `popstate` says how many layers
 * may stay open. A pop the app asked for itself (a layer closed by a finger,
 * Escape or a button) is recognised by the depth it lands on and closes
 * nothing; any other pop closes layers from the top until the rest fit.
 *
 * Changes are reconciled once per microtask: a sheet entry that opens a
 * confirmation, StrictMode's open-close-open, or a sheet closed together
 * with its article cost one history write (or none), never a push racing a
 * back. While a back the app asked for is in flight, pushes wait for its
 * `popstate`.
 *
 * Android only, by platform and not by screen width: iOS paints its own
 * back semantics (edge swipe, no system button) and the owner asked that
 * nothing change there; desktops keep the browser's own Back.
 */
export type Layer = 'article' | 'drawer' | 'prefs';

/** Z-order of the fixed layers: the last one is on top. Floating surfaces
 * sit above all three, the last opened on top. */
const ORDER: readonly Layer[] = ['article', 'drawer', 'prefs'];

export function isAndroid(userAgent: string): boolean {
  return /\bAndroid\b/i.test(userAgent);
}

export interface HistoryLayersIO {
  /** `history.pushState` of an entry recording `depth`. */
  push: (depth: number) => void;
  /** `history.go(delta)`, delta < 0. */
  go: (delta: number) => void;
  /** Closes a fixed layer. */
  close: (layer: Layer) => void;
  /** Runs `fn` once the current render has settled (`queueMicrotask`). */
  schedule: (fn: () => void) => void;
}

/** A floating surface's close; `false` means it refuses (busy) and stays. */
export type OverlayClose = () => boolean | void;

interface Open { rank: number; close: () => boolean | void }

export class HistoryLayers {
  private open = new Map<string, Open>();
  private depth = 0;          // our entries below the current one, as written
  private inFlight: number | null = null; // depth a back we asked for lands on
  private scheduled = false;
  private seq = 0;

  /** `base`: the depth recorded in the current entry at start (a reload on a
   * pushed entry), so new entries go on from it. */
  constructor(private io: HistoryLayersIO, private base = 0) {}

  /** Call on every change of the three booleans. */
  sync(state: Record<Layer, boolean>): void {
    ORDER.forEach((layer, rank) => {
      if (state[layer] && !this.open.has(layer)) {
        this.open.set(layer, { rank, close: () => this.io.close(layer) });
      } else if (!state[layer]) {
        this.open.delete(layer);
      }
    });
    this.reconcile();
  }

  /** A floating surface opens; returns the token that closes it. */
  openOverlay(close: OverlayClose): string {
    const token = `overlay:${++this.seq}`;
    this.open.set(token, { rank: ORDER.length + this.seq, close });
    this.reconcile();
    return token;
  }

  /** A floating surface closed by the app (finger, Escape, button, unmount).
   * A no-op if a pop already closed it. */
  closeOverlay(token: string): void {
    if (this.open.delete(token)) this.reconcile();
  }

  /** Call on `popstate`, with the depth recorded in the entry now current
   * (`event.state?.frirssDepth`, missing = the page's own entry). */
  onPop(stateDepth: number | undefined): void {
    const landed = Math.max(0, (stateDepth ?? 0) - this.base);
    const ours = this.inFlight === landed;
    this.inFlight = null;
    this.depth = landed;
    // Our own back: layers opened meanwhile are not pushed yet, nothing closes.
    if (ours) { this.reconcile(); return; }
    // Close from the top until what is open fits in the entries left.
    while (this.open.size > this.depth) {
      const [key, top] = [...this.open.entries()].reduce((a, b) => (b[1].rank > a[1].rank ? b : a));
      this.open.delete(key);
      if (top.close() === false) {
        // Refused (a confirmation at work): it stays, and gets its entry back.
        this.open.set(key, top);
        break;
      }
    }
    this.reconcile();
  }

  private reconcile(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    this.io.schedule(() => { this.scheduled = false; this.flush(); });
  }

  private flush(): void {
    if (this.inFlight !== null) return; // resumed by the pop
    const want = this.open.size;
    if (want > this.depth) {
      while (this.depth < want) this.io.push(this.base + ++this.depth);
    } else if (want < this.depth) {
      const delta = want - this.depth;
      this.depth = want;
      this.inFlight = want;
      this.io.go(delta);
    }
  }
}
