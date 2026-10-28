import { describe, it, expect } from 'vitest';
import { safeHref } from './safeHref';

describe('safeHref', () => {
  it('garde une URL http ou https', () => {
    expect(safeHref('https://example.com/a?b=1#c')).toBe('https://example.com/a?b=1#c');
    expect(safeHref('http://example.com/')).toBe('http://example.com/');
    expect(safeHref('HTTPS://EXAMPLE.COM/')).toBe('HTTPS://EXAMPLE.COM/');
  });

  it('retire les espaces autour, comme le ferait le navigateur', () => {
    expect(safeHref('  https://example.com/1 \n')).toBe('https://example.com/1');
  });

  it('refuse tout autre schéma, y compris déguisé', () => {
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref('JavaScript:alert(1)')).toBeUndefined();
    expect(safeHref(' javascript:alert(1)')).toBeUndefined();
    expect(safeHref('java\tscript:alert(1)')).toBeUndefined();
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeUndefined();
    expect(safeHref('vbscript:msgbox(1)')).toBeUndefined();
    expect(safeHref('file:///etc/passwd')).toBeUndefined();
  });

  it('refuse une URL absente, vide ou relative', () => {
    expect(safeHref(undefined)).toBeUndefined();
    expect(safeHref('')).toBeUndefined();
    expect(safeHref('   ')).toBeUndefined();
    expect(safeHref('/article/1')).toBeUndefined();
    expect(safeHref('example.com/1')).toBeUndefined();
  });
});
