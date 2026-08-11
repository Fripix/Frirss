<div align="center">
  <img src="public/logo_frirss.png" alt="FriRSS" width="96" />
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
  <a href="https://github.com/Fripix/Frirss/stargazers"><img src="https://img.shields.io/github/stars/Fripix/Frirss?label=stars&style=flat-square&color=gold" alt="Stars" /></a>
  <a href="https://github.com/Fripix/Frirss/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Fripix/Frirss/ci.yml?branch=main&label=CI&style=flat-square" alt="CI" /></a>
  <a href="https://github.com/Fripix/Frirss/actions/workflows/security.yml"><img src="https://img.shields.io/github/actions/workflow/status/Fripix/Frirss/security.yml?branch=main&label=security&style=flat-square" alt="Security" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Fripix/Frirss?style=flat-square" alt="License" /></a>
</p>

<p>
  <a href="https://ca.unraid.net/apps"><img src="https://img.shields.io/badge/Unraid-Community%20Apps-F15A2C?logo=unraid&logoColor=white&style=flat-square" alt="Unraid Community Apps" /></a>
  <a href="https://hub.docker.com/r/fripix/frirss"><img src="https://img.shields.io/docker/pulls/fripix/frirss?label=Docker%20pulls&logo=docker&style=flat-square" alt="Docker pulls" /></a>
  <a href="https://github.com/Fripix/Frirss/pkgs/container/frirss"><img src="https://img.shields.io/badge/GHCR-frirss-2496ED?logo=github&style=flat-square" alt="GHCR" /></a>
  <img src="https://img.shields.io/badge/arch-amd64%20%7C%20arm64-555555?style=flat-square" alt="amd64 and arm64" />
  <img src="https://img.shields.io/badge/PWA-installable-8A2BE2?style=flat-square" alt="PWA" />
  <img src="https://img.shields.io/badge/languages-9-orange?style=flat-square" alt="9 languages" />
</p>
</div>

<p align="center">
  <a href="#about">About</a> ·
  <a href="#features">Features</a> ·
  <a href="#installation">Installation</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#security">Security</a> ·
  <a href="#feedback--contributing">Feedback & Contributing</a>
</p>

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
- Three-pane reader on desktop; an installable **PWA** on mobile with swipe navigation, swipe actions and pull-to-refresh.
- **Full-text extraction** (Readability) when a feed only ships a summary, cached so re-reads are instant.
- **Offline reading** (installable PWA): articles — text and images — stay readable without a connection. Favorites and read-later are kept offline automatically, plus a one-tap *Prepare offline* sweep (last 30 days, all feeds) and optional auto-refresh on open.
- Favorites, read-later, mark read/unread, filters (all / unread / favorites) — the **unread-only** filter is remembered per feed — search and infinite scroll.
- **Resume where you left off**: your last feed and filter are restored on reopen, with an unobtrusive **offline / back-online** indicator.

### Make it yours
Almost everything is yours to tweak:

- **Themes** — full control over every color and font; **create, save, export and import** your own themes.
- **Element colors** — recolor the sidebar, accents, panels, links, article text and more, individually.
- **Font sizes** — independent sizes for article titles, summaries, source names and the reading body.
- **Layout** — resizable columns, density and spacing options, date separators, toggles for the source label and top bar, and a desktop/mobile layout switch on tablets. Collapsed sidebar sections (labels and categories) are remembered, and feeds with no unread can be hidden to declutter large lists.
- **Labels & sub-labels** — a nestable tagging system: create, rename, color, drag-and-drop to organize, group under parents, with per-label article counts.
- **Branding** — set your own app name and logo.
- **9 languages** — FR · EN · DE · ES · IT · PT · NL · PL · UK; the interface follows your browser language on first run.

### Accounts, SSO & multi-server
- **Multi-user** with admin/user roles — each person keeps their own feeds and settings.
- **Single sign-on** via OIDC (tested with [Authentik](https://goauthentik.io)); existing accounts are linked by email, and passkeys work through your provider.
- **Multi-server** — connect several FreshRSS instances and switch between them.

### Self-hosting
- Optional **Redis cache** (stale-while-revalidate) and a background pre-fetch worker for instant loads.
- FreshRSS tokens **encrypted at rest**; same-origin proxy (no CORS) with an anti-SSRF guard.
- Ships as a single **Docker** image (nginx + Node) with SQLite storage, built for **amd64 and arm64** (Raspberry Pi, 64-bit OS).

## Installation

FriRSS is a frontend for FreshRSS, so you need a running FreshRSS instance with the Google Reader API enabled (*Settings → Authentication → Allow API access*).

### Docker

Using GHCR:

```bash
mkdir -p frirss-data
docker run -d --name frirss \
  -p 8080:80 \
  -v "$PWD/frirss-data:/app/data" \
  -e TZ=Europe/Zurich \
  ghcr.io/fripix/frirss:latest
```

Or using Docker Hub:

```bash
mkdir -p frirss-data
docker run -d --name frirss \
  -p 8080:80 \
  -v "$PWD/frirss-data:/app/data" \
  -e TZ=Europe/Zurich \
  fripix/frirss:latest
```

(`$PWD` is your current directory, so the database is stored in a `frirss-data` folder right where you run the command — back it up and you back up everything.)

Open `http://localhost:8080`, create the first account (it becomes admin), then connect your FreshRSS server: its URL, your FreshRSS username, and the API password (set in *FreshRSS → Settings → Profile*).

Prefer Compose? A ready-to-edit [`docker-compose.yml`](docker-compose.yml) is included.

The first launch generates the JWT secret and the token-encryption key and stores them in the SQLite database, so backing up the data volume backs up everything.

## Configuration

| Variable | Description | Default |
|---|---|---|
| `FRIRSS_BASE_URL` | Public base URL — recommended behind a reverse proxy; fixes OIDC redirect URIs | derived |
| `FRIRSS_DATA_DIR` | SQLite database directory | `/app/data` |
| `PROXY_REWRITES` | public→internal URL rewrites for the backend proxy (`from=to`, comma-separated) | — |
| `PROXY_INTERNAL_HOSTS` | Anti-SSRF allowlist: internal hosts the proxy may reach directly | — |
| `REDIS_URL` | Enables the read cache (stale-while-revalidate); empty disables it | — |
| `CACHE_ARTICLES_PER_FEED` | Articles kept per feed in the cache | `50` |
| `CACHE_TTL` | Cache key expiry, in seconds | `86400` |
| `CACHE_SYNC_INTERVAL` | Background pre-fetch interval in minutes (`0` disables; needs `REDIS_URL`) | `0` |
| `CORS_ORIGIN` | Allowed CORS origin(s) — only for split front/back deployments | — |

Single sign-on is configured at runtime in *Preferences → Admin → SSO* (issuer, client ID, client secret).

## Security

Security checks are run regularly and can also be launched manually.

If you discover a security issue, please follow the instructions in [`SECURITY.md`](SECURITY.md) instead of opening a public issue.

You can also follow the current security workflow in [GitHub Actions](https://github.com/Fripix/Frirss/actions/workflows/security.yml).

## Feedback & Contributing

FriRSS is a personal project, but feedback, ideas and contributions are welcome.

- Found a bug? [Open an issue](https://github.com/Fripix/Frirss/issues)
- Have an idea or question? [Start a discussion](https://github.com/Fripix/Frirss/discussions)
- Want to contribute code? Pull requests are welcome.

## License

[MIT](LICENSE)
