interface LoginModeInput {
  oidcEnabled: boolean;
  ssoOnly: boolean;
  hasUsers: boolean;
  /** Escape hatch (?local=1 / "Local login" link) so an admin can always get in. */
  forceLocal: boolean;
}

// Whether to hide the local username/password form on the login screen.
// Guards against lockout: only hides when SSO is truly enabled AND set to
// SSO-only AND at least one user exists AND the escape hatch isn't engaged.
export function shouldHideLocalLogin({ oidcEnabled, ssoOnly, hasUsers, forceLocal }: LoginModeInput): boolean {
  return oidcEnabled && ssoOnly && hasUsers && !forceLocal;
}

// Break-glass fallback URL: the local login form is reachable — without any
// visible link — via ?local=1 or the /local-login path.
export function isLocalFallbackUrl(loc: { search: string; pathname: string }): boolean {
  return new URLSearchParams(loc.search).has('local') || loc.pathname === '/local-login';
}
