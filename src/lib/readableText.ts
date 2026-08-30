/**
 * Pick a text colour that stays readable on an arbitrary background.
 *
 * Several places wrote `color: '#fff'` over a colour the *user* chooses — a
 * label pill takes the label's own colour, and `text-white` sits on
 * `var(--danger)`. A yellow or pale label made its own name disappear.
 *
 * Method is the WCAG one: relative luminance of the background, then the
 * contrast ratio against each candidate ink, keeping whichever is higher.
 *
 * A colour that cannot be read as hex — a CSS variable, an empty string —
 * returns the light ink, which is exactly what those call sites did before.
 * Falling back to the previous behaviour means this can never make a case
 * worse than it already was.
 */

export const LIGHT_INK = '#ffffff';
/** Not pure black: matches the warm ink already used across the interface. */
export const DARK_INK = '#1c1c1a';

function parseHex(input: string | undefined | null): [number, number, number] | null {
  if (!input) return null;
  const hex = input.trim().replace(/^#/, '');
  if (!/^[0-9a-f]+$/i.test(hex)) return null;

  if (hex.length === 3) {
    return [
      parseInt(hex[0] + hex[0], 16),
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16),
    ];
  }
  // 8 digits = an alpha channel we deliberately ignore: the pill is painted on
  // an opaque surface, so blending it would need that surface's colour too.
  if (hex.length === 6 || hex.length === 8) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  return null;
}

function channelLuminance(value255: number): number {
  const s = value255 / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

function contrastRatio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function readableTextOn(background: string | undefined | null): string {
  const rgb = parseHex(background);
  if (!rgb) return LIGHT_INK;

  const bg = relativeLuminance(rgb);
  const onLight = contrastRatio(bg, relativeLuminance(parseHex(LIGHT_INK)!));
  const onDark = contrastRatio(bg, relativeLuminance(parseHex(DARK_INK)!));

  return onLight >= onDark ? LIGHT_INK : DARK_INK;
}
