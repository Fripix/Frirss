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
    <img src="https://flagcdn.com/24x18/ua.png" alt="Українська" />&nbsp;
    <img src="https://flagcdn.com/24x18/cn.png" alt="简体中文" />
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

FriRSS is a new interface for your [FreshRSS](https://freshrss.org): FreshRSS keeps fetching and storing your feeds, FriRSS is where you read them.

> [!IMPORTANT]
> **FriRSS needs a working FreshRSS.** It is an interface only: it does not fetch feeds and cannot run on its own. Install [FreshRSS](https://freshrss.org) first, turn its API on, then [install FriRSS](#installation).

## Preview

<picture>
  <source media="(max-width: 600px)" srcset="docs/readme/preview-narrow.png">
  <img src="docs/readme/preview.png" alt="FriRSS on a MacBook with an AI summary open, on an iPad in a grid with the Night theme, and the same article on three iPhones in three more themes" width="880">
</picture>

## Website

<a href="https://frirss-site.fripix.ch">
  <picture>
    <source media="(max-width: 600px)" srcset="docs/readme/website-narrow.png">
    <img src="docs/readme/website.png" alt="Visit the FriRSS website" width="880">
  </picture>
</a>

**[frirss-site.fripix.ch](https://frirss-site.fripix.ch)**

## Live demo

<a href="https://frirss.fripix.ch">
  <picture>
    <source media="(max-width: 600px)" srcset="docs/readme/live-demo-narrow.png">
    <img src="docs/readme/live-demo.png" alt="Open the live demo" width="880">
  </picture>
</a>

**[frirss.fripix.ch](https://frirss.fripix.ch)**

> **Username** `fridemo` &nbsp;·&nbsp; **Password** `6wVQj3Q@2Qz@`

- Runs on a small server.
- Feeds cannot be added or removed, and no FreshRSS server can be connected.
- Preferences reset every 30 minutes, so themes and layout return to their defaults.
- Read state and favorites are shared with everyone else visiting.
- AI features (summaries, translations) are turned off.

The demo is there to try the interface.

## About

[FreshRSS](https://freshrss.org) has an excellent engine: solid, self-hosted, great at fetching and storing feeds. Its built-in interface just wasn't for me, and none of the alternatives fit what I wanted — so I built my own.

FriRSS sits on top of FreshRSS through its Google Reader API and replaces only the interface.

A note in the interest of honesty: this is a personal project and I'm not a developer. FriRSS was built largely by "vibe coding" — describing what I wanted to an AI assistant and iterating. Use it in that spirit.

## Features

- **Three panes on desktop, an app on your phone** — install it as a PWA, with swipe gestures and pull-to-refresh.
- **The full article**, even when a feed only sends a summary.
- **Offline reading**, images included.
- **Search that really filters** the view you are in, read articles included.
- **Mark everything as read — with *Undo*.** Nothing destructive happens in one click, and you can jump straight to the next feed with unread articles.
- **Optional AI summaries and translations** with the provider you choose, a local Ollama or a cloud one. Nothing is sent anywhere by default.
- **Three columns, two or a grid**, oldest first or at random, chosen feed by feed.
- **Keyboard first** — a command palette (<kbd>⌘K</kbd> / <kbd>Ctrl+K</kbd>) and thirteen reassignable shortcuts.
- **Make it yours** — six themes, your own colors, font and thumbnail sizes, a narrower reading column if you want one, your app name and logo.
- **Tags and sub-tags**, categories and feeds, organised from the preferences.
- **Several users, single sign-on (OIDC) and several FreshRSS servers.**
- **10 languages**, and one Docker image for amd64 and arm64.

Every feature in detail: the [website](https://frirss-site.fripix.ch/en/features/), and [`docs/FEATURES.md`](docs/FEATURES.md) (in French).

## Installation

You need:

- **a working [FreshRSS](https://freshrss.org)** — FriRSS does nothing without it — with API access on (*Settings → Authentication*) and an API password (*Settings → Profile*);
- a machine with [Docker](https://docs.docker.com/get-docker/).

FreshRSS on your home network (`192.168.x.x`, a container name)? Add `-e PROXY_INTERNAL_HOSTS=192.168.1.20` — its host or IP only — to the command below, or connecting fails.

```bash
mkdir -p frirss-data
docker run -d --name frirss \
  --restart unless-stopped \
  -p 8080:80 \
  -v "$PWD/frirss-data:/app/data" \
  -e TZ=Europe/Zurich \
  ghcr.io/fripix/frirss:latest
```

1. Open `http://localhost:8080` and create the first account — it becomes the administrator.
2. Connect your FreshRSS: its address, your FreshRSS username and the API password.

> **Install with an AI assistant.** Paste this into ChatGPT, Claude or the assistant you use. It reads [a guide written for it](docs/INSTALL-WITH-AI.md) and walks you through, one step at a time:
>
> ```
> Read https://raw.githubusercontent.com/Fripix/Frirss/main/docs/INSTALL-WITH-AI.md and help me install FriRSS step by step.
> ```

Docker Compose, Unraid, reverse proxy, updating and backups: the **[installation guide](docs/INSTALL.md)**.

## Configuration

Every setting is optional. The environment variables — time zone, user, FreshRSS on a private network, reverse proxy, Redis cache, limits — are listed by need in **[docs/CONFIGURATION.md](docs/CONFIGURATION.md)**.

## Security

FreshRSS credentials are encrypted at rest and never reach the browser; all FreshRSS traffic goes through an authenticated same-origin proxy with an anti-SSRF guard; registration is closed by default. The full list, and how to report an issue: [`SECURITY.md`](SECURITY.md).

## Feedback & Contributing

FriRSS is a personal project, but feedback, ideas and contributions are welcome.

- Found a bug, or have an idea? [Open an issue](https://github.com/Fripix/Frirss/issues/new/choose) — there are guided forms for both.
- A question, or something to talk through? [Start a discussion](https://github.com/Fripix/Frirss/discussions)
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
