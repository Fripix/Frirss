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
- Give accounts only to people you trust. Registration is closed by default —
  only the very first account can be created without an admin opening it — so
  the safe posture is the one you already have. An account is what unlocks the
  outgoing proxy; see the DNS-rebinding note below before opening sign-ups.

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

### The anti-SSRF guard does not pin the resolved address

Before fetching a client-supplied target, the proxy resolves its hostname and
refuses the request if any answer is a private, loopback, link-local or cloud
metadata address. It repeats that check on every redirect hop.

It does not, however, pin the address it validated: `fetch()` resolves the name
again when it opens the connection. A hostname whose DNS answers a public
address to the first lookup and a private one to the second — classic DNS
rebinding, and cheap to set up with a zero TTL — therefore slips past the check.

Closing it means pinning the validated IP at connect time, which Node's `fetch`
gives no way to do: its HTTP client is internal and takes no custom resolver, an
externally installed `undici` is rejected by it outright, and rewriting the URL
to the IP breaks TLS certificate validation. The remaining route is to rebuild
the outgoing request on `node:http`/`node:https`, which do accept a `lookup`
option — re-implementing transparent decompression, streaming and abort
handling in the single most security-sensitive function of the app.

That rewrite is not worth its regression risk against what the gap actually
costs here. Reaching it requires an account **and** a domain whose DNS the
attacker controls; what comes back is a response from the internal network, to
an authenticated user, on an instance whose accounts the operator chose.

What would change the calculation: opening registration to strangers, or Node
exposing a supported way to supply a resolver to `fetch`. The first is the one
to watch. Registration ships closed, and the moment you open it this note stops
being theoretical — anyone who signs up can aim the proxy.
