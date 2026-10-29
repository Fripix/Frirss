interface LoginModeInput {
  oidcEnabled: boolean;
  ssoOnly: boolean;
  hasUsers: boolean;
  /** Escape hatch (?local=1 / "Local login" link) so an admin can always get in. */
  forceLocal: boolean;
  /** The SSO return said a local account holds this address: it must sign in
   *  with its password to link itself, so the form must be there. */
  linkRequired?: boolean;
}

// Whether to hide the local username/password form on the login screen.
// Guards against lockout: only hides when SSO is truly enabled AND set to
// SSO-only AND at least one user exists AND the escape hatch isn't engaged.
export function shouldHideLocalLogin({ oidcEnabled, ssoOnly, hasUsers, forceLocal, linkRequired = false }: LoginModeInput): boolean {
  return oidcEnabled && ssoOnly && hasUsers && !forceLocal && !linkRequired;
}

// Break-glass fallback URL: the local login form is reachable — without any
// visible link — via a single fixed query, ?local=1. Kept simple and memorable
// on purpose (an emergency entry point must be reliably reachable, and hiding
// the form is not a security boundary — local accounts still need a password).
export function isLocalFallbackUrl(loc: { search: string }): boolean {
  return new URLSearchParams(loc.search).has('local');
}
