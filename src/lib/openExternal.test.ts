// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { openExternal } from './openExternal';

describe('openExternal', () => {
  afterEach(() => vi.restoreAllMocks());

  it('ouvre dans un nouvel onglet AVEC noopener', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openExternal('https://example.com/article');
    // `noopener` est la raison d'être de cette fonction : sans lui, la page
    // ouverte garde `window.opener` et peut rediriger FriRSS.
    expect(open).toHaveBeenCalledWith('https://example.com/article', '_blank', 'noopener');
  });

  it("n'ouvre rien quand il n'y a pas d'URL", () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openExternal('');
    openExternal(null);
    openExternal(undefined);
    openExternal('   ');
    expect(open).not.toHaveBeenCalled();
  });

  it("n'ouvre jamais un schéma autre que http(s), et le dit par son retour", () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openExternal('javascript:alert(1)')).toBe(false);
    expect(openExternal(' JavaScript:alert(1)')).toBe(false);
    expect(openExternal('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(openExternal('file:///etc/passwd')).toBe(false);
    expect(openExternal('')).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(openExternal('https://example.com/a')).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
  });
});
