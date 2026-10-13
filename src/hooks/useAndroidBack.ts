import { useEffect, useRef } from 'react';
import { HistoryLayers, isAndroid, type Layer } from '../lib/historyLayers';

/**
 * Lets Android's back gesture close the surface on top — article, feed
 * drawer, preferences — instead of leaving the app. See
 * `src/lib/historyLayers.ts` for the rules; this hook only wires them to
 * `window.history`, `popstate` and the three close actions. A no-op off
 * Android, so iOS and desktops behave exactly as before.
 */
export function useAndroidBack(
  open: Record<Layer, boolean>,
  close: Record<Layer, () => void>,
): void {
  const enabled = typeof navigator !== 'undefined' && isAndroid(navigator.userAgent);
  const closeRef = useRef(close);
  closeRef.current = close;
  const layersRef = useRef<HistoryLayers | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const layers = new HistoryLayers({
      push: (layer) => window.history.pushState({ frirssLayer: layer }, ''),
      back: () => window.history.back(),
      close: (layer) => closeRef.current[layer](),
    });
    layersRef.current = layers;
    const onPop = () => layers.onPop();
    window.addEventListener('popstate', onPop);
    return () => { window.removeEventListener('popstate', onPop); layersRef.current = null; };
  }, [enabled]);

  useEffect(() => {
    layersRef.current?.sync(open);
  }, [open.article, open.drawer, open.prefs]); // eslint-disable-line react-hooks/exhaustive-deps
}
