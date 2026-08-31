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

function ratioOfLuminance(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Rapport de contraste WCAG entre deux couleurs hexadécimales. */
export function contrastRatio(a: string, b: string): number {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return 1;
  return ratioOfLuminance(relativeLuminance(ca), relativeLuminance(cb));
}

/** Seuil AA pour du texte de taille normale. */
const READABLE = 4.5;

function toHex([r, g, b]: [number, number, number]): string {
  const part = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * La même couleur, éclaircie ou assombrie juste assez pour être lisible sur
 * `background`.
 *
 * Le cas qui l'a rendue nécessaire : dans un thème CLAIR, l'accent est
 * assombri pour tenir sur le panneau blanc — et devient alors illisible sur la
 * barre latérale, qui est sombre. Le compteur de non-lus, qui prend l'accent,
 * disparaissait donc dans tous les thèmes clairs sauf celui par défaut, dont
 * l'accent est clair.
 *
 * On mélange vers le blanc ou vers le noir **par petits pas**, et on s'arrête
 * au premier qui passe : la teinte reste reconnaissable au lieu de s'effondrer
 * sur du blanc ou du noir. Une couleur illisible retournée telle quelle (CSS
 * variable, valeur invalide) est rendue inchangée.
 */
export function readableOn(background: string, color: string): string {
  const bg = parseHex(background);
  const fg = parseHex(color);
  if (!bg || !fg) return color;

  const bgLum = relativeLuminance(bg);
  if (ratioOfLuminance(relativeLuminance(fg), bgLum) >= READABLE) return color;

  // On s'éloigne du fond : vers le blanc s'il est sombre, vers le noir sinon.
  const target: [number, number, number] = bgLum < 0.5 ? [255, 255, 255] : [0, 0, 0];
  for (let step = 1; step <= 20; step++) {
    const candidate = mix(fg, target, step / 20);
    if (ratioOfLuminance(relativeLuminance(candidate), bgLum) >= READABLE) {
      return toHex(candidate);
    }
  }
  return toHex(target);
}

export function readableTextOn(background: string | undefined | null): string {
  const rgb = parseHex(background);
  if (!rgb) return LIGHT_INK;

  const bg = relativeLuminance(rgb);
  const onLight = ratioOfLuminance(bg, relativeLuminance(parseHex(LIGHT_INK)!));
  const onDark = ratioOfLuminance(bg, relativeLuminance(parseHex(DARK_INK)!));

  return onLight >= onDark ? LIGHT_INK : DARK_INK;
}
