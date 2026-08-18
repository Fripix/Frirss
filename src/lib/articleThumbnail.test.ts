import { describe, it, expect } from 'vitest';
import { extractImageFromContent, sourceInitial } from './articleThumbnail';

describe('extractImageFromContent', () => {
  it('returns the first <img> src', () => {
    expect(extractImageFromContent('<p>hi</p><img src="https://x/a.jpg">')).toBe('https://x/a.jpg');
  });
  it('handles single quotes', () => {
    expect(extractImageFromContent("<img src='https://x/b.png' alt='x'>")).toBe('https://x/b.png');
  });
  it('returns null when there is no image', () => {
    expect(extractImageFromContent('<p>no image here</p>')).toBeNull();
  });
  it('returns null for empty input', () => {
    expect(extractImageFromContent('')).toBeNull();
  });
});

describe('sourceInitial', () => {
  it('returns the uppercased first letter', () => {
    expect(sourceInitial('MacGeneration')).toBe('M');
  });
  it('trims leading whitespace', () => {
    expect(sourceInitial('  the verge')).toBe('T');
  });
  it('falls back to ? for empty', () => {
    expect(sourceInitial('')).toBe('?');
  });
});
