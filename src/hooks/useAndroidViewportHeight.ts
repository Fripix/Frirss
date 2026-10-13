import { useEffect } from 'react';
import { isAndroid } from '../lib/historyLayers';

/** The CSS variable the app shell reads before falling back to `100vh`. */
export const APP_HEIGHT_VAR = '--app-height';

/**
 * Publishes `window.innerHeight` as `--app-height` on Android, and keeps it
 * current on resize.
 *
 * Measured on Chrome 145, installed app, Android 17: the stylesheet's
 * `.app-shell { height: 100vh }` resolved to 946 px for an 890 px viewport,
 * and kept that value after the viewport settled — a fresh `100vh` rule
 * injected later gave 890. The column therefore ended 56 px below the screen
 * and the bottom of every list was unreachable (issue #19, point 5 made it
 * visible: the end-of-list button was cut off). A pixel value tracked from
 * `innerHeight` sidesteps whatever Chrome froze. Off Android nothing is
 * set, so iOS keeps its `100vh` (see the comment in `index.css`).
 */
export function useAndroidViewportHeight(userAgent: string): void {
  const enabled = isAndroid(userAgent);
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const apply = () => root.style.setProperty(APP_HEIGHT_VAR, `${window.innerHeight}px`);
    apply();
    window.addEventListener('resize', apply);
    return () => {
      window.removeEventListener('resize', apply);
      root.style.removeProperty(APP_HEIGHT_VAR);
    };
  }, [enabled]);
}
