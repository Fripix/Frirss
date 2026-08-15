import { describe, it, expect } from 'vitest';
import { shouldHideLocalLogin } from './shouldHideLocalLogin';

const base = { oidcEnabled: true, ssoOnly: true, hasUsers: true, forceLocal: false };

describe('shouldHideLocalLogin', () => {
  it('hides the local form when SSO-only is active and users exist', () => {
    expect(shouldHideLocalLogin(base)).toBe(true);
  });

  it('keeps the local form when SSO-only is off', () => {
    expect(shouldHideLocalLogin({ ...base, ssoOnly: false })).toBe(false);
  });

  it('keeps the local form when OIDC is disabled (lockout guard)', () => {
    expect(shouldHideLocalLogin({ ...base, oidcEnabled: false })).toBe(false);
  });

  it('keeps the local form for the first user (no users yet)', () => {
    expect(shouldHideLocalLogin({ ...base, hasUsers: false })).toBe(false);
  });

  it('keeps the local form when the ?local escape hatch is set', () => {
    expect(shouldHideLocalLogin({ ...base, forceLocal: true })).toBe(false);
  });
});
