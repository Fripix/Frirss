import { describe, it, expect, vi } from 'vitest';
import { copyLink } from './copyLink';

describe('copyLink', () => {
  it('writes the URL and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(copyLink('https://example.com/a', { writeText })).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith('https://example.com/a');
  });

  it('fails without a clipboard (non-secure context)', async () => {
    await expect(copyLink('https://example.com/a', null)).resolves.toBe('failed');
  });

  it('fails when the browser refuses the write', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    await expect(copyLink('https://example.com/a', { writeText })).resolves.toBe('failed');
  });

  it('fails on an empty URL without touching the clipboard', async () => {
    const writeText = vi.fn();
    await expect(copyLink('   ', { writeText })).resolves.toBe('failed');
    expect(writeText).not.toHaveBeenCalled();
  });
});
