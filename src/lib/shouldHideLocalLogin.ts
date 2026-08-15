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
