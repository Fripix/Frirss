<div align="center">
  <img src="public/logo_frirss.png" alt="" width="96" />
  <h1>FriRSS</h1>
  <p><em>Your FriRSS, your rules.</em></p>
  <p>A self-hosted, customizable web frontend for <a href="https://freshrss.org">FreshRSS</a>.</p>

  <p>
    <img src="https://flagcdn.com/24x18/fr.png" alt="Français" />&nbsp;
    <img src="https://flagcdn.com/24x18/gb.png" alt="English" />&nbsp;
    <img src="https://flagcdn.com/24x18/de.png" alt="Deutsch" />&nbsp;
    <img src="https://flagcdn.com/24x18/es.png" alt="Español" />&nbsp;
    <img src="https://flagcdn.com/24x18/it.png" alt="Italiano" />&nbsp;
    <img src="https://flagcdn.com/24x18/pt.png" alt="Português" />&nbsp;
    <img src="https://flagcdn.com/24x18/nl.png" alt="Nederlands" />&nbsp;
    <img src="https://flagcdn.com/24x18/pl.png" alt="Polski" />&nbsp;
    <img src="https://flagcdn.com/24x18/ua.png" alt="Українська" />
  </p>

  <p>
    <a href="https://github.com/Fripix/Frirss/releases"><img src="https://img.shields.io/github/v/release/Fripix/Frirss?label=release&style=flat-square" alt="Release" /></a>
    <a href="https://github.com/Fripix/Frirss/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Fripix/Frirss/ci.yml?branch=main&label=CI&style=flat-square" alt="CI" /></a>
    <a href="https://github.com/Fripix/Frirss/actions/workflows/security.yml"><img src="https://img.shields.io/github/actions/workflow/status/Fripix/Frirss/security.yml?branch=main&label=security&style=flat-square" alt="Security" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/Fripix/Frirss?style=flat-square" alt="License" /></a>
  </p>

  <p>
    <a href="https://github.com/Fripix/Frirss/pkgs/container/frirss"><img src="https://img.shields.io/badge/GHCR-frirss-2496ED?logo=github&style=flat-square" alt="GHCR" /></a>
    <a href="https://hub.docker.com/r/fripix/frirss"><img src="https://img.shields.io/docker/pulls/fripix/frirss?label=Docker%20pulls&logo=docker&style=flat-square" alt="Docker pulls" /></a>
    <a href="https://ca.unraid.net/apps"><img src="https://img.shields.io/badge/Unraid-Community%20Apps-F15A2C?logo=unraid&logoColor=white&style=flat-square" alt="Unraid Community Apps" /></a>
    <img src="https://img.shields.io/badge/arch-amd64%20%7C%20arm64-555555?style=flat-square" alt="amd64 and arm64" />
  </p>
</div>

## Preview

<div align="center">
  <img src="docs/screenshots/desktop.png" alt="FriRSS on desktop" width="92%" />
</div>

<div align="center">
  <img src="docs/screenshots/mobile-pwa.png" alt="FriRSS as a PWA on a phone" height="400" />
  &nbsp;&nbsp;
  <img src="docs/screenshots/tablet.png" alt="FriRSS on a tablet" height="400" />
</div>

## About

[FreshRSS](https://freshrss.org) has an excellent engine: solid, self-hosted, great at fetching and storing feeds. Its built-in interface just wasn't for me, and none of the alternatives fit what I wanted — so I built my own.

FriRSS sits on top of FreshRSS through its Google Reader API and replaces only the interface.

A note in the interest of honesty: this is a personal project and I'm not a developer. FriRSS was built largely by "vibe coding" — describing what I wanted to an AI assistant and iterating. Use it in that spirit.

## Features

### Reading
- **Three panes on desktop**, and an installable **PWA** on mobile with swipe navigation, swipe actions and pull-to-refresh.
- **Full-text extraction** (Readability) when a feed only ships a summary — cached, so re-reads are instant.
- **Offline reading.** Articles stay readable without a connection, images included. Favorites and read-later are kept automatically; a one-tap *Prepare offline* sweep covers the last 30 days across every feed.
- **Favorites, read-later, read/unread**, with all / unread / favorites filters. The unread-only choice is remembered per feed.
- **Search and infinite scroll**, scoped to the view you are actually in.
- **Resume where you left off** — your last feed and filter come back on reopen, with an unobtrusive offline / back-online indicator.

### Make it yours
Almost everything is yours to tweak:

- **Themes** — full control over every color and font; **create, save, export and import** your own themes.
- **Element colors** — recolor the sidebar, accents, panels, links, article text and more, individually.
- **Font sizes** — independent sizes for article titles, summaries, source names and the reading body.
- **Layout** — resizable columns, density and spacing, date separators, toggles for the source label and top bar, and a desktop/mobile switch on tablets.
- **A sidebar that remembers** — collapsed sections stay collapsed, and feeds with nothing unread can be hidden to declutter long lists.
- **Labels & sub-labels** — a nestable tagging system: create, rename, color, drag to organize, group under parents, with per-label article counts.
- **Branding** — set your own app name and logo.
- **9 languages** — the interface follows your browser language on first run.

### Accounts, SSO & multi-server
- **Multi-user** with admin/user roles — each person keeps their own feeds and settings.
- **Single sign-on** via OIDC (tested with [Authentik](https://goauthentik.io)); existing accounts are linked by email, and passkeys work through your provider.
- **Multi-server** — connect several FreshRSS instances and switch between them.

### Self-hosting
- Optional **Redis cache** (stale-while-revalidate) and a background pre-fetch worker for instant loads.
- **Encrypted backup and restore** — one passphrase-protected file rebuilds a whole instance, including on a brand-new one.
- FreshRSS tokens **encrypted at rest**; same-origin proxy (no CORS) with an anti-SSRF guard.
- Ships as a single **Docker** image (nginx + Node) with SQLite storage, built for **amd64 and arm64** (Raspberry Pi, 64-bit OS).

## Installation

FriRSS is a frontend for FreshRSS, so you need a running FreshRSS instance with the Google Reader API enabled (*Settings → Authentication → Allow API access*).

```bash
mkdir -p frirss-data
docker run -d --name frirss \
  -p 8080:80 \
  -v "$PWD/frirss-data:/app/data" \
  -e TZ=Europe/Zurich \
  ghcr.io/fripix/frirss:latest
```

The database lands in a `frirss-data` folder right where you ran the command. The same image is on Docker Hub as `fripix/frirss:latest` if you prefer it, and a ready-to-edit [`docker-compose.yml`](docker-compose.yml) is included.

Then open `http://localhost:8080` and create the first account — it becomes the administrator. Registration then closes: new instances refuse sign-ups by default, and you open them again from *Preferences → Administration* when you want to invite someone. Connect your FreshRSS server next: its URL, your FreshRSS username, and the API password from *FreshRSS → Settings → Profile*.

The first launch generates the JWT secret and the token-encryption key and stores them in the database, so backing up the data folder backs up everything — see [Backups](#backups).

## Configuration

| Variable | Description | Default |
|---|---|---|
| `PUID` | User id the Node process runs as (the data directory is adopted on start) | `1000` |
| `PGID` | Group id for the same process | `1000` |
| `FRIRSS_BASE_URL` | Public base URL — recommended behind a reverse proxy; fixes OIDC redirect URIs | derived |
| `FRIRSS_DATA_DIR` | SQLite database directory | `/app/data` |
| `PROXY_REWRITES` | public→internal URL rewrites for the backend proxy (`from=to`, comma-separated) | — |
| `PROXY_INTERNAL_HOSTS` | Anti-SSRF allowlist: internal hosts the proxy may reach directly | — |
| `REDIS_URL` | Enables the read cache (stale-while-revalidate); empty disables it | — |
| `CACHE_ARTICLES_PER_FEED` | Articles kept per feed in the cache | `50` |
| `CACHE_TTL` | Cache key expiry, in seconds | `86400` |
| `CACHE_SYNC_INTERVAL` | Background pre-fetch interval in minutes (`0` disables; needs `REDIS_URL`) | `0` |
| `CACHE_SYNC_ACTIVE_DAYS` | Only pre-fetch for users seen in the last N days | `7` |
| `CACHE_SYNC_PARALLEL_USERS` | Users pre-fetched in parallel | `3` |
| `FRIRSS_REFRESH_MAX_FEEDS` | Number of feeds to refresh per button press (non-integer or < 1 → default) | `1000` |
| `FRIRSS_PROXY_RATE_LIMIT` | Proxied requests allowed per user per minute (`0` disables; non-integer or negative → default) | `600` |
| `CORS_ORIGIN` | Allowed CORS origin(s) — only for split front/back deployments | — |

Single sign-on is configured at runtime in *Preferences → Administration* (issuer, client ID, client secret).

## Backups

Two things are worth backing up, and they are not the same thing.

### The encrypted export

*Preferences → Administration → Backup* produces a single file holding
everything FriRSS knows about itself: accounts and their password hashes, the
configured FreshRSS servers, their tokens **and the key that decrypts them**,
preferences, and instance settings. It does not hold your articles — those live
in FreshRSS.

That file is therefore enough to impersonate every account on the instance, which
is why a passphrase is mandatory (12 characters minimum). **Lose the passphrase
and the file is permanently unusable.** There is no recovery path, by design;
keep it somewhere other than next to the file.

Restore it from the same screen, or from the first-run screen of a fresh
instance — which makes it a migration tool as much as a backup. Either way you
see what the file contains before committing: when it was made, which version
produced it, how many accounts and servers. Restoring replaces the instance's
contents entirely and signs everyone out.

Environment variables are recorded in the file and shown at restore time, but
never applied: they belong to the deployment, not to the backup. Copy them into
your compose file yourself.

### The data directory

`/app/data` holds `frirss.db` and its write-ahead log — the JWT secret and the
token-encryption key included. Backing up that volume backs up the instance.

To take a copy out of a running container, use the snapshot script rather than
`cp`:

```bash
docker exec frirss node scripts/backup-db.js /app/data/backups
```

It goes through SQLite's `.backup()` API: atomic, and safe while the server is
writing. Copying `frirss.db` on its own is **not** a valid backup — the most
recent writes live in the `-wal` file beside it.

Locked out of every admin account? `docker exec -it frirss node
scripts/reset-password.js` sets a new password from the terminal.

## Security

FriRSS holds the credentials to your FreshRSS server, so a few things are not optional:

- FreshRSS passwords and tokens are **encrypted at rest** and never reach the browser — not in a response, not in a URL, not in a log.
- All FreshRSS traffic goes through an authenticated **same-origin proxy** with an anti-SSRF guard: it rejects targets that *resolve* to a private address, and re-checks every redirect hop.
- The app page **and its static assets** carry a **Content-Security-Policy** (`script-src 'self'`) along with `X-Frame-Options`, `X-Content-Type-Options` and `Referrer-Policy`.
- The backend runs **unprivileged** in the container (`PUID`/`PGID`, 1000 by default): code execution inside Node no longer owns the data directory, where the JWT secret and the token-encryption key live. The data directory is adopted on start, so upgrading needs no action.
- **Registration is closed by default.** Only the very first account — the administrator — can be created without someone opening sign-ups in *Preferences → Administration*.
- Proxied requests are **rate-limited per user** (`FRIRSS_PROXY_RATE_LIMIT`), so an account cannot turn the backend into an open relay.
- JWT verification is pinned to HS256, and the runtime image ships neither npm nor its dependency tree — nothing there is executed, and it was the source of most reported CVEs.

Dependency and image scans run on every push and can be launched by hand; the current state is in [GitHub Actions](https://github.com/Fripix/Frirss/actions/workflows/security.yml).

Found a security issue? Please follow [`SECURITY.md`](SECURITY.md) rather than opening a public issue.

## Feedback & Contributing

FriRSS is a personal project, but feedback, ideas and contributions are welcome.

- Found a bug? [Open an issue](https://github.com/Fripix/Frirss/issues)
- Have an idea or question? [Start a discussion](https://github.com/Fripix/Frirss/discussions)
- Want to contribute code? Pull requests are welcome.
- Wondering what changed? [`CHANGELOG.md`](CHANGELOG.md)

<p align="center">
  <a href="https://buymeacoffee.com/fripix">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png"
         alt="Buy Me a Coffee"
         height="36">
  </a>
</p>

## License

[MIT](LICENSE)
