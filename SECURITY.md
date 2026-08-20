# Security Policy

## Reporting a vulnerability

If you find a security issue in FriRSS, please report it **privately** — do not
open a public issue.

Use GitHub's private reporting: go to the repository's **Security** tab →
**Report a vulnerability** (GitHub Security Advisories). This keeps the details
confidential until a fix is available.

Please include:

- a description of the issue and its impact,
- steps to reproduce (or a proof of concept),
- the affected version.

This is a personal, hobby project, so responses are best-effort — but security
reports are taken seriously and addressed as a priority.

## Supported versions

Only the latest released version receives fixes. Always run an up-to-date image.

## Notes for self-hosters

FriRSS is self-hosted software: you are responsible for your deployment. A few
basics that matter:

- Put it behind HTTPS (a reverse proxy) and keep the image updated.
- Back up the `/app/data` volume — it holds the database, the JWT secret and the
  token-encryption key (all generated on first launch).
- The backend proxy blocks internal/private targets by default (anti-SSRF); only
  widen `PROXY_INTERNAL_HOSTS` to hosts you trust.

## Design decisions

These are deliberate trade-offs, not oversights. They are written down so they
do not get "fixed" without weighing what the change costs.

### The session token lives in `localStorage`, not in a cookie

The JWT is stored in `localStorage` and attached to each request by the client.
The alternative — an `HttpOnly` cookie — protects the token from cross-site
scripting, which `localStorage` cannot.

We keep `localStorage` because the trade is symmetrical, not one-sided:

| | `localStorage` (current) | `HttpOnly` cookie |
|---|---|---|
| Stolen by XSS | possible | impossible |
| CSRF | impossible | possible, needs defending |

A cookie is sent automatically by the browser, which is exactly what makes CSRF
work; a token in `localStorage` is never sent unless our own code attaches it.

What tips the balance here:

- The Content-Security-Policy is strict — `script-src 'self'`, no inline scripts,
  no external origins — so injecting a script is already very hard.
- All feed HTML is sanitised with DOMPurify before rendering.
- Switching to cookies means adding CSRF defences, and the OIDC flow returns
  from a different origin, where `SameSite=Strict` needs care.
- Every existing session would be invalidated on the switch.

If the CSP is ever relaxed, or third-party scripts are introduced, this decision
should be revisited — that is what would change the calculation.
