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

### The OIDC issuer is trusted by the anti-SSRF guard

Every outgoing call of the OIDC flow — discovery, the code exchange, `userinfo`
— goes through the same guard as the proxy, on every redirect hop. The host of
the **issuer** is exempt from the private-address rule, and only that host:
a redirect from the issuer towards another internal host is still refused.

Why the exemption: the issuer is not a client-supplied target, the
administrator sets it. And inside a home network with split-DNS, the public
name of the identity provider resolves to a private address (the reverse proxy)
from within the container, so the guard refused discovery and every SSO login
failed with `login_failed` and no explanation. Until 1.6.1 the exchange and
`userinfo` calls did not go through the guard at all, for URLs dictated by the
discovery document: the guard covered one hop out of three.

What the exemption costs: an attacker who already holds an **admin** account can
point the issuer at an internal host and learn whether a JSON document is served
at its well-known path — a blind probe, and a trivial one next to what an admin
account already grants (that same attacker can replace the issuer with their own
provider and sign in as anyone through the e-mail link-up). If you would rather
keep the issuer under the rule, nothing is lost: `PROXY_INTERNAL_HOSTS` still
works and the exemption adds no host you did not configure yourself.

### AI providers: admin-set endpoints, encrypted keys

AI summaries and translations (off by default) call a provider the
**administrator** declared. Its host is trusted by the anti-SSRF guard exactly like the OIDC issuer, and
only that host: a model on the LAN (Ollama) works without
`PROXY_INTERNAL_HOSTS`, and a redirect towards any other internal host is still
refused. Redirects are never followed at all (a 3xx is a technical error), so an
API key is never sent to a host the admin did not type. Users never set an
endpoint.

The admin-only model list (`POST /api/admin/ai/models`) queries the URL typed in
the provider form, before it is saved, under the same rules. When the key field
is left empty it reuses a saved provider's key only if the typed URL and type
are exactly the saved ones, so editing the URL never sends the stored key to the
new host.

API keys are encrypted at rest with the instance key and never returned by any
route; the part of a provider's error body that is logged or shown has the key
redacted first and is then cut to 300 characters (the other order could leave a
fragment of the key at the cut), and a transport error message is redacted the
same way. A personal key (`PUT /api/ai/keys/:providerId`) is encrypted the same
way, never returned (the config only says whether one exists), and ignored, not
deleted, while the admin does not allow personal keys.

A personal key is only as private as the administrator is trusted: it is sent to
whatever base URL the admin sets for that provider, and it is kept, not deleted,
when the admin later changes that URL or the provider type, so an admin who
repoints a provider receives a user's key with that user's next summary or
translation through it. An app admin can also decrypt it from an encrypted backup, which carries the
instance key. That is the same trust users already give the admin for their
FreshRSS credentials, stored and backed up the same way.

The article text leaves the instance for the provider the admin chose, which is
the point of the feature and also its privacy cost: leave it off, or point it at
a local model, if articles must not leave the network. Translation follows the
same key, redirect, redaction and fallback rules as summaries, with one
exception: an unusable translation answer never falls back to the next provider
(which may be paid), it is retried in two halves on the same one; for a whole
article, its text leaves the instance in batches, one provider call per batch,
under the same rule as a summary: the title as plain text, and the displayed
text blocks, each block passed through the HTML sanitiser first.

Two limits are deliberate. The cost cap is a guard, not an accounting quota: it
only limits what the admin's shared key pays for and the day follows the
container timezone; summaries and translations share it, one unit per summary
and per translation batch. Each paid call reserves its place before it leaves
(one atomic increment in SQLite), so parallel requests cannot overshoot it; a
call that fails gives its place back. The cache key includes a hash of the text
sent (the article text for a summary, the batch's segments for a translation),
because the article id is client-supplied and would otherwise let one user read
or poison another user's cached result.

What the exemption costs is the same as for the issuer: an attacker holding an
**admin** account can point a provider at an internal host and make the server
send it a JSON POST and read back a short error detail (the test button
returns it). That is a limited probe, and a minor one next to what an admin
account already grants.

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
