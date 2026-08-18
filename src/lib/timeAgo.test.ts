import { describe, it, expect, vi, afterEach } from 'vitest';
import { timeAgo } from './timeAgo';

const t = ((k: string, o?: { count?: number }) => (o ? `${k}:${o.count}` : k)) as unknown as Parameters<typeof timeAgo>[1];

describe('timeAgo', () => {
  afterEach(() => vi.useRealTimers());
  it('shows "now" under a minute', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-08-18T12:00:00Z'));
    expect(timeAgo(Date.now() - 30_000, t)).toBe('time.now');
  });
  it('shows minutes under an hour', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-08-18T12:00:00Z'));
    expect(timeAgo(Date.now() - 5 * 60_000, t)).toBe('time.minutes:5');
  });
  it('shows hours under a day', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-08-18T12:00:00Z'));
    expect(timeAgo(Date.now() - 3 * 3_600_000, t)).toBe('time.hours:3');
  });
  it('shows days beyond a day', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-08-18T12:00:00Z'));
    expect(timeAgo(Date.now() - 2 * 86_400_000, t)).toBe('time.days:2');
  });
});
