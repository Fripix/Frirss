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
});
