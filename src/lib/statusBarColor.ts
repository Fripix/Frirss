/**
 * Colour of the band the OS draws above the app — on Android, the status bar
 * of an installed web app takes `<meta name="theme-color">`, and Chrome tints
 * the navigation bar to match.
 *
 * One rule: the bar takes the colour of the surface directly beneath it,
 * so it never reads as a dark browser frame over a light app (discussion
 * #19). The server topbar when it is shown, else the list header, else the
 * reading pane. All three are theme colours the user can already adjust;
 * there is no setting of its own. iOS is untouched: its strip is painted by
 * the page (`.safe-area-top`), not by this tag.
 */
export function statusBarColor(
  view: { topbarVisible: boolean; reading: boolean },
  colors: Record<string, string | undefined>,
): string {
  const surface = view.topbarVisible
    ? colors['topbar-bg'] || '#201f1b'
    : view.reading
      ? colors['panel-bg'] || '#ffffff'
      : colors['panel-header-bg'] || '#fafafa';
  return clampForChromeWebapp(surface);
}

/**
 * Chrome's ceiling for an installed web app: a theme colour whose HSL
 * lightness exceeds 0.94 is ignored, and the status bar falls back to the
 * colour recorded at install time — on a light theme, a black bar over a
 * white header. Measured on Chrome Android 17 (2026-10-13): #e8e8e8 is
 * applied, #f0f0f0 is not. A too-light surface is therefore brought down to
 * the ceiling, hue and saturation kept: #fafafa becomes #efefef, a band the
 * eye barely separates from the header beneath it.
 */
export const CHROME_WEBAPP_MAX_LIGHTNESS = 0.94;

export function clampForChromeWebapp(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  if (l <= CHROME_WEBAPP_MAX_LIGHTNESS) return hex.toLowerCase();
  // HSL with the lightness pinned to the ceiling; floor keeps the result
  // strictly under it (0.94 × 255 = 239.7 → 239 = 0xef).
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    const R = r / 255, G = g / 255, B = b / 255;
    h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  const L = CHROME_WEBAPP_MAX_LIGHTNESS;
  const c = (1 - Math.abs(2 * L - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const mm = L - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const toHex = (v: number) => Math.floor((v + mm) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`;
}
