import { describe, it, expect } from 'vitest';
import { nextProvider } from './aiRetry';
import type { AiProviderView } from '../api/backend';

const p = (id: number, available = true): AiProviderView =>
  ({ id, name: `P${id}`, type: 'openai', hasAdminKey: true, shared: true, hasUserKey: false, available });

describe('nextProvider', () => {
  it('returns the first available provider after the failed one, in the admin order', () => {
    expect(nextProvider([p(1), p(2), p(3)], 1)?.id).toBe(2);
    expect(nextProvider([p(1), p(2), p(3)], 2)?.id).toBe(3);
  });
  it('skips the unavailable ones', () => {
    expect(nextProvider([p(1), p(2, false), p(3)], 1)?.id).toBe(3);
  });
  it('wraps around to the first available one that is not the failed one', () => {
    expect(nextProvider([p(1), p(2), p(3)], 3)?.id).toBe(1);
    expect(nextProvider([p(1, false), p(2), p(3)], 3)?.id).toBe(2);
  });
  it('is null with a single usable provider, or none', () => {
    expect(nextProvider([p(1)], 1)).toBeNull();
    expect(nextProvider([p(1), p(2, false)], 1)).toBeNull();
    expect(nextProvider([], 1)).toBeNull();
  });
  it('an unknown or missing failed id gives the first available provider', () => {
    expect(nextProvider([p(1, false), p(2), p(3)], 99)?.id).toBe(2);
    expect(nextProvider([p(1), p(2)], undefined)?.id).toBe(1);
    expect(nextProvider([p(1, false)], undefined)).toBeNull();
  });
  it('a failed provider that is no longer available still anchors the order', () => {
    expect(nextProvider([p(1), p(2, false), p(3)], 2)?.id).toBe(3);
  });
});
