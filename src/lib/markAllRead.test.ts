import { describe, it, expect } from 'vitest';
import { markAllReadAction } from './markAllRead';

describe('markAllReadAction', () => {
  it('marks immediately when confirmation is disabled', () => {
    expect(markAllReadAction(false, false)).toBe('mark');
    expect(markAllReadAction(false, true)).toBe('mark');
  });

  it('asks first, then marks, when confirmation is enabled', () => {
    expect(markAllReadAction(true, false)).toBe('ask');
    expect(markAllReadAction(true, true)).toBe('mark');
  });
});
