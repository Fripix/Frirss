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
