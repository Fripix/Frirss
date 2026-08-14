import { describe, it, expect } from 'vitest';
import { resolveVersionLabel } from './version';

describe('resolveVersionLabel', () => {
  it('shows the dev/beta label as-is when a dev version is set', () => {
    expect(resolveVersionLabel('v1.3.4b3', '1.3.4')).toBe('v1.3.4b3');
  });

  it('falls back to "v<appVersion>" when there is no dev version', () => {
    expect(resolveVersionLabel('', '1.3.3')).toBe('v1.3.3');
    expect(resolveVersionLabel(undefined, '1.3.3')).toBe('v1.3.3');
  });
});
