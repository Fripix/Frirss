import { describe, it, expect } from 'vitest';
import { readableTextOn, readableOn, contrastRatio, DARK_INK, LIGHT_INK } from './readableText';

describe('readableTextOn', () => {
  it('puts dark text on the star yellow', () => {
    // #f5c542 is a shipped theme colour, and the label pill wrote #fff on it.
    expect(readableTextOn('#f5c542')).toBe(DARK_INK);
  });

  it('puts light text on the read-later violet', () => {
    expect(readableTextOn('#8b5cf6')).toBe(LIGHT_INK);
  });

  it('puts dark text on the mint accent', () => {
    // White on #4cd4a1 is roughly 1.9:1 — the case that made this necessary.
    expect(readableTextOn('#4cd4a1')).toBe(DARK_INK);
  });

  it('puts light text on black and dark text on white', () => {
    expect(readableTextOn('#000000')).toBe(LIGHT_INK);
    expect(readableTextOn('#ffffff')).toBe(DARK_INK);
  });

  it('accepts three-digit hex', () => {
    expect(readableTextOn('#fff')).toBe(DARK_INK);
    expect(readableTextOn('#000')).toBe(LIGHT_INK);
  });

  it('accepts hex without the leading hash, in any case', () => {
    expect(readableTextOn('F5C542')).toBe(DARK_INK);
  });

  it('ignores a trailing alpha channel', () => {
    expect(readableTextOn('#ffffff80')).toBe(DARK_INK);
  });

  it('falls back to light text when the colour cannot be read', () => {
    // Label colours can be a CSS variable rather than a hex value; keeping the
    // previous behaviour (#fff) there means this can never make things worse.
    expect(readableTextOn('var(--accent)')).toBe(LIGHT_INK);
    expect(readableTextOn('')).toBe(LIGHT_INK);
    expect(readableTextOn(undefined)).toBe(LIGHT_INK);
    expect(readableTextOn('#12345')).toBe(LIGHT_INK);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for a colour on itself', () => {
    expect(Math.round(contrastRatio('#000000', '#ffffff'))).toBe(21);
    expect(contrastRatio('#4cd4a1', '#4cd4a1')).toBeCloseTo(1, 5);
  });
});

describe('readableOn', () => {
  it('leaves a colour that already reads well alone', () => {
    // Le menthe par défaut sur la barre latérale sombre : rien à corriger.
    expect(readableOn('#201f1b', '#4cd4a1')).toBe('#4cd4a1');
  });

  it('lightens a dark colour placed on a dark background', () => {
    // Le cas qui a cassé le badge de non-lus : dans un thème CLAIR, l'accent
    // est assombri pour tenir sur le panneau blanc — et devient illisible sur
    // la barre latérale, qui est sombre.
    const out = readableOn('#16233d', '#2a5db0');
    expect(out).not.toBe('#2a5db0');
    expect(contrastRatio(out, '#16233d')).toBeGreaterThanOrEqual(4.5);
  });

  it('darkens a light colour placed on a light background', () => {
    const out = readableOn('#ffffff', '#4cd4a1');
    expect(contrastRatio(out, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the hue recognisable rather than collapsing to black or white', () => {
    const out = readableOn('#16233d', '#2a5db0');
    expect(out).not.toBe('#ffffff');
    expect(out).not.toBe('#000000');
  });

  it('returns the colour untouched when it cannot be parsed', () => {
    expect(readableOn('#16233d', 'var(--accent)')).toBe('var(--accent)');
    expect(readableOn('nope', '#2a5db0')).toBe('#2a5db0');
  });
});
