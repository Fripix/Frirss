import { describe, it, expect } from 'vitest';
import { readableTextOn, DARK_INK, LIGHT_INK } from './readableText';

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
