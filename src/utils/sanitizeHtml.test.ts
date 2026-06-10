// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from './sanitizeHtml';

describe('sanitizeHtml', () => {
  it('removes <script> tags', () => {
    expect(sanitizeHtml('<p>ok</p><script>alert(1)</script>')).not.toContain('<script');
  });

  it('strips inline event handlers', () => {
    const out = sanitizeHtml('<img src="x" onerror="alert(1)">');
    expect(out).not.toMatch(/onerror/i);
  });

  it('drops javascript: URLs', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toMatch(/javascript:/i);
  });

  it('keeps safe markup and links', () => {
    const out = sanitizeHtml('<a href="https://example.com">link</a><strong>b</strong>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('<strong>');
  });

  it('hardens target=_blank links with rel', () => {
    const out = sanitizeHtml('<a href="https://example.com" target="_blank">x</a>');
    expect(out).toMatch(/rel="noopener noreferrer"/);
  });

  it('returns empty string for falsy input', () => {
    expect(sanitizeHtml('')).toBe('');
    expect(sanitizeHtml(null)).toBe('');
  });
});
