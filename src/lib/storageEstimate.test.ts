import { describe, it, expect } from 'vitest';
import { formatBytes } from './storageEstimate';

describe('formatBytes', () => {
  it('renders megabytes below a gigabyte', () => {
    expect(formatBytes(340 * 1024 * 1024)).toBe('340 Mo');
  });
  it('renders gigabytes with one decimal', () => {
    expect(formatBytes(1.25 * 1024 * 1024 * 1024)).toBe('1,3 Go');
  });
  it('renders small sizes as 0 Mo rather than a fraction', () => {
    expect(formatBytes(1024)).toBe('0 Mo');
  });
  it('handles zero', () => {
    expect(formatBytes(0)).toBe('0 Mo');
  });
});
