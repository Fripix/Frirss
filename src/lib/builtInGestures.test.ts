import { describe, it, expect, afterEach, vi } from 'vitest';
import { builtInGestures } from './builtInGestures';

const t = (k: string) => k;
afterEach(() => { vi.unstubAllGlobals(); });

describe('builtInGestures — la palette nomme la touche du clavier', () => {
  it('⌘K sur un clavier Apple', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: '' });
    expect(builtInGestures(t).find((g) => g.label === 'palette.title')?.key).toBe('⌘K');
  });
  it('Ctrl+K ailleurs', () => {
    vi.stubGlobal('navigator', { platform: 'Linux x86_64', userAgent: '' });
    expect(builtInGestures(t).find((g) => g.label === 'palette.title')?.key).toBe('Ctrl+K');
  });
});
