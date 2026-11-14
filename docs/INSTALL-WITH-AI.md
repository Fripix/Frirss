# Installing FriRSS — a guide for AI assistants

You are helping someone install FriRSS. They may be new to self-hosting and to Docker. This guide is written for you, the assistant; the person you help pasted a link to it.

## How to use this guide

- Go **one step at a time**. Give one step, wait for the person to say it worked (or paste what they see), then go on.
- Answer **in the person's language**. Commands, file names and variable names stay as written here.
- **Ask before assuming.** The questions in [Ask first](#ask-first) decide which commands apply.
- **Check each step** before the next one: a command's output, the health check, what the screen shows.
- Only the variables in [Environment variables](#environment-variables) exist. Do not invent others, or options that are not listed here.
- If this guide and the [installation guide](https://github.com/Fripix/Frirss/blob/main/docs/INSTALL.md) or the [configuration page](https://github.com/Fripix/Frirss/blob/main/docs/CONFIGURATION.md) ever disagree, those are right.

## What FriRSS is

- FriRSS is a web interface for **FreshRSS**. FreshRSS fetches and stores the feeds; FriRSS is where they are read.
- It does **not** replace FreshRSS and cannot work without it. If the person has no FreshRSS yet, they install that first ([freshrss.org](https://freshrss.org)), then come back.
- It ships as one Docker image, `ghcr.io/fripix/frirss:latest` (also `fripix/frirss:latest` on Docker Hub), for amd64 and arm64. Its data — a SQLite database and its keys — lives in `/app/data` inside the container.

## Ask first

Ask these, one or two at a time, before giving any command:

1. **Is FreshRSS installed, and at what address?** A public URL (`https://rss.example.com`), a local network address (`http://192.168.1.20:8080`), or a container name on a Docker network (`http://freshrss`)?
2. **In FreshRSS, is API access on, and is an API password set?** If not, walk them through it:
   - *Settings → Authentication → Allow API access*;
   - *Settings → Profile* → set an **API password**. It is separate from their FreshRSS login password, and it is the one FriRSS asks for.
3. **How will they run FriRSS?** `docker run`, Docker Compose, or Unraid. If they do not know: Compose if `docker compose version` answers, `docker run` otherwise. No Docker at all → [install Docker](https://docs.docker.com/get-docker/) first (Docker Desktop on a laptop is enough to try).
4. **On what machine?** On a Raspberry Pi, the OS must be **64-bit**: `dpkg --print-architecture` must print `arm64` (or `amd64` on a PC); `armhf` means a 32-bit OS, which cannot run the image — even when the kernel itself reports 64-bit. Elsewhere, `docker info --format '{{.Architecture}}'` tells the same.
5. **Will they open FriRSS from outside their home?** Then they need a reverse proxy with HTTPS (see [Going further](#going-further)).

## Install

Pick the one way that matches answer 3.

### Docker

```bash
mkdir -p frirss-data
docker run -d --name frirss \
  --restart unless-stopped \
  -p 8080:80 \
  -v "$PWD/frirss-data:/app/data" \
  -e TZ=Europe/Zurich \
  ghcr.io/fripix/frirss:latest
```

- Replace `Europe/Zurich` with their time zone.
- `8080` is the port on their machine; if it is taken, use another (`-p 8081:80`) and use that port everywhere below.
- If FreshRSS is on a private address or a Docker name (answer 1), add `-e PROXY_INTERNAL_HOSTS=<host>` before the image name — see [Connect FreshRSS](#connect-freshrss).
- If a reverse proxy is **installed directly on the same machine** (not in Docker), publish the port on loopback only: `-p 127.0.0.1:8080:80`. Docker opens published ports past most host firewalls (ufw included), so a plain `-p 8080:80` is reachable from the internet on a server. If the proxy **runs in a container** (Nginx Proxy Manager, Traefik, Caddy in Docker), loopback is out of its reach: put FriRSS on the proxy's Docker network (`--network <name>`) and point the proxy at `http://frirss:80`.
- **Run every later `docker run` from the same folder.** `$PWD/frirss-data` is relative to it: from another folder, Docker creates an empty data folder and FriRSS starts as a brand-new instance.

### Docker Compose

Use the compose file from the repository, unchanged except for the lines they need:

```bash
mkdir frirss && cd frirss
curl -O https://raw.githubusercontent.com/Fripix/Frirss/main/docker-compose.yml
mkdir -p frirss-data
docker compose up -d
```

What is in it: `container_name: frirss` (so `docker logs frirss` works), the port mapping `"8080:80"`, the data folder `./frirss-data:/app/data`, `TZ=Europe/Zurich` already active (change it), and optional lines commented out — `PUID`, `PGID`, `FRIRSS_BASE_URL`, `PROXY_INTERNAL_HOSTS`, `REDIS_URL`, `CACHE_SYNC_INTERVAL`, `PROXY_REWRITES`. Removing `# ` (hash and space) in front of a `# - NAME=value` line turns it on — leave the explanation comments as they are; `NODE_ENV` and `FRIRSS_DATA_DIR` are already active, leave them; a variable that is not in the file is added as a new `- NAME=value` line under `environment:`. If 8080 is taken, change the left side (`"8081:80"`); with a reverse proxy installed directly on the host, `"127.0.0.1:8080:80"`; with a proxy in a container, the shared Docker network instead (see above).

### Unraid

In the *Apps* tab (Community Applications), search for **FriRSS** and install its template. Its defaults: host port **8787**, data in `/mnt/user/appdata/frirss`, `PUID` 99 and `PGID` 100. The *FreshRSS Internal Host* field is `PROXY_INTERNAL_HOSTS`. A copy installed before September 2026 (FriRSS 1.4.6) lacks that field, and may lack `PUID` / `PGID` too: add the variables by hand if they are needed.

- To set a variable the template does not show, use *Add another Path, Port, Variable* → *Variable*, with the variable name as *Key*.
- To reach FreshRSS or Redis by container name, set FriRSS's *Network Type* to the same custom Docker network as them; on the default `bridge`, use the server's LAN address instead.
- The container is named `FriRSS` there: use `docker logs FriRSS`, `docker exec FriRSS …` in the commands below.

On Unraid, use port **8787** instead of 8080 in every step below. More generally, **use the host port they chose** wherever this guide says 8080.

## After it starts

### Health check

Wait about 15 seconds after the first start, then:

```bash
curl http://localhost:8080/api/health
```

Expected: JSON with `"status":"ok"` and a `"version"`. Without `curl` (Windows, Unraid web UI), opening `http://<the machine's address>:8080/api/health` in a browser shows the same thing. No answer at all means the container is not running: check `docker ps -a` and `docker logs frirss` before anything else.

### Create the account

They open `http://localhost:8080` on that machine, or `http://<the machine's address>:8080` from another device (`hostname -I` prints it on Linux; Unraid shows it on its dashboard; on a Mac or PC, the network settings), and create the first account. **It becomes the administrator.** Registration then closes; it is reopened in *Preferences → Administration* to invite someone.

On a server reachable from the internet, **create this account before** the public address works, or right away: whoever opens the page first becomes administrator. On a headless server, an SSH tunnel opens it privately: `ssh -L 8080:localhost:8080 <server>`, then `http://localhost:8080` on their own computer.

### Connect FreshRSS

FriRSS asks for three fields. They are the **FreshRSS** details, not the FriRSS account:

- **Server URL** — the FreshRSS address from answer 1: its base address, the one that opens its web page (not the `…/api/` link FreshRSS shows in its profile).
- **FreshRSS username** — their FreshRSS user.
- **API password** — the one set in *FreshRSS → Settings → Profile*.

They type these into FriRSS themselves. Do not ask for them in the conversation. If they already pasted one, tell them to change it where it belongs (FreshRSS for the API password, FriRSS for their FriRSS password).

FreshRSS menu names are given here in English; in a translated FreshRSS, look for the same items at the same place.

Which address and which variable:

- **Public FreshRSS URL** (`https://rss.example.com`) → usually nothing to add. But if their network resolves that name to a private address (split DNS, a home router that loops back, Tailscale `100.x` addresses), the guard blocks it like a private one: trust that host name with `PROXY_INTERNAL_HOSTS=rss.example.com`.
- **Private address or Docker name** (`http://192.168.1.20:8080`, `http://freshrss`) → the backend refuses private targets by default (anti-SSRF guard). Trust that one host with `PROXY_INTERNAL_HOSTS`: the **host name or IP only**, no scheme, no port, comma-separated if several — for example `PROXY_INTERNAL_HOSTS=192.168.1.20` or `PROXY_INTERNAL_HOSTS=freshrss`. The host must be **exactly** the one typed in *Server URL* (`192.168.1.20`, not `nas.local` if they typed the IP). Then **recreate** the container (`docker restart` keeps the old environment), and check it took: `docker exec frirss printenv PROXY_INTERNAL_HOSTS`.
- **A Docker name like `http://freshrss`** only works if both containers share a Docker network. With Compose, put FriRSS on FreshRSS's network; otherwise use the machine's LAN address.
- **Optional, when FreshRSS has a public URL but runs next to FriRSS:** on the same Docker network, they can keep the public URL in FriRSS and let the backend take the short internal path with `PROXY_REWRITES=https://rss.example.com=http://freshrss:80`. The right side uses FreshRSS's port **inside its container** (80 for the common images), not the host port they open it with. Rewrite targets are trusted automatically; no `PROXY_INTERNAL_HOSTS` needed for them.
- **Never `localhost`** (nor `127.0.0.1`) as the FreshRSS address: inside the container, it is FriRSS itself. FriRSS then shows "This address points inside your network, so FriRSS blocked it" and suggests `PROXY_INTERNAL_HOSTS`: **do not** add `localhost` there, it would still not reach FreshRSS. Use the machine's LAN address instead (with Docker Desktop: `host.docker.internal`, which then goes in `PROXY_INTERNAL_HOSTS`).

## Going further

Only if they want it:

- **Access from outside** — a reverse proxy with HTTPS (Nginx Proxy Manager, Caddy, Traefik, nginx), never the container port published straight to the internet: the login limit relies on the client address the proxy passes on. Set `FRIRSS_BASE_URL` to the public address. Give the proxy at least **120 s** of read and send timeout (`proxy_read_timeout 120s;` and `proxy_send_timeout 120s;` in nginx or in Nginx Proxy Manager's *Advanced* tab): an AI translation batch can take up to 110 s. For another proxy, set its equivalent read / response timeout to at least 120 s. A proxy installed on the host forwards to FriRSS's published port (`http://127.0.0.1:8080`); a proxy running in Docker forwards to `http://frirss:80` over a shared Docker network — `127.0.0.1` inside the proxy's container is the proxy itself.
- **Speed** — a Redis server and `REDIS_URL=redis://<host>:6379`, reachable from the FriRSS container (same Docker network, or its LAN address). Optional; everything works without it. `CACHE_SYNC_INTERVAL` (minutes) adds a background pre-fetch and needs `REDIS_URL`.
- **AI summaries and translations** — configured inside the app, in *Preferences → AI*, by the administrator. No variable. With a local Ollama, Ollama itself must run with `OLLAMA_CONTEXT_LENGTH=16384`.
- **Single sign-on (OIDC)** — configured inside the app, in *Preferences → Administration*. Set `FRIRSS_BASE_URL` first.
- **Backups** — *Preferences → Administration → Backup* (an encrypted file with a mandatory passphrase), or a snapshot of the data folder: `docker exec frirss node scripts/backup-db.js /app/data/backups`. Either way, copy the result off that machine.
- **Updating** — read the [release notes](https://github.com/Fripix/Frirss/releases), back up, then `docker compose pull && docker compose up -d`; with `docker run`, `docker pull ghcr.io/fripix/frirss:latest`, `docker rm -f frirss`, and the same `docker run` again. The data folder stays, as long as `docker run` is started from the same folder as the first time.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Connecting FreshRSS fails; the container log (`docker logs frirss`) shows `POST /api/proxy 403` | FreshRSS is on a private address or Docker name, blocked by the anti-SSRF guard | `PROXY_INTERNAL_HOSTS=<that host>`, then recreate the container |
| Still `403` with the variable set | The variable is missing from the running container, or its host differs from the one in *Server URL* | `docker exec frirss printenv PROXY_INTERNAL_HOSTS`; make both hosts identical |
| After recreating, FriRSS asks to create a first account again | `docker run` started from another folder: new, empty data folder | Run it from the original folder; the old data is still there |
| FriRSS shows "This address points inside your network, so FriRSS blocked it" | Same as the `403` above | `PROXY_INTERNAL_HOSTS=<that host>` (never `localhost`), then recreate the container |
| "FreshRSS refused these credentials" | Wrong API password, or none set yet | Set it again in *FreshRSS → Settings → Profile*, and type that one (not the login password) |
| "Failed to connect to FreshRSS server." | API access off, a wrong *Server URL*, or FreshRSS unreachable | *Settings → Authentication → Allow API access*; type FreshRSS's base address (what opens its web page), **not** the `…/api/` link shown in its profile |
| `403` with a **public** FreshRSS URL | The name resolves to a private address on their network | `PROXY_INTERNAL_HOSTS=<that host name>` |
| The FreshRSS address was `http://localhost:…` | `localhost` is the FriRSS container | Use the machine's LAN address, or the Docker name on a shared network |
| `docker run` says the port is already allocated | Another service uses 8080 | `-p 8081:80` (or any free port) |
| `no matching manifest for linux/arm/v7` when pulling | 32-bit OS (Raspberry Pi) | A 64-bit OS (`dpkg --print-architecture` → `arm64`) |
| Health check gives no answer | The container is not running, or started less than 15 s ago | `docker ps -a`, `docker logs frirss` |
| Files in the data folder owned by an unexpected user | The NAS expects a given user | `PUID` / `PGID` (`id -u`, `id -g`; Unraid: 99 / 100) |
| A second person cannot sign up | Registration closes after the first account | The admin reopens it in *Preferences → Administration* |
| Every admin password lost | — | `docker exec -it frirss node scripts/reset-password.js` |
| Sign-in through SSO comes back to a wrong address | No public base URL | `FRIRSS_BASE_URL=https://frirss.example.com` |
| A long AI translation is cut behind the reverse proxy | Proxy timeout (often 60 s) | 120 s read and send timeouts on the proxy |
| An Ollama translation comes back truncated | Ollama's default 4 096-token context | Start Ollama with `OLLAMA_CONTEXT_LENGTH=16384` |

## Never do this

- **Never ask for a password, an API password, a token or a key in the conversation.** The person types them into FriRSS, or into their own files, themselves.
- Never tell them to publish the container port straight to the internet; remote access goes through an HTTPS reverse proxy.
- Never weaken the anti-SSRF guard beyond the exact FreshRSS host: no IP ranges, no list of every machine "just in case". Never put `localhost`, `127.0.0.1` or `::1` in `PROXY_INTERNAL_HOSTS`: it opens the container's own internal services and still does not reach FreshRSS.
- Never invent a variable, an option or a version tag. The image is `:latest` unless they ask for a specific release listed on the [releases page](https://github.com/Fripix/Frirss/releases).
- Never present a copy of `frirss.db` alone as a backup: recent writes live in the `-wal` file beside it. Use the snapshot script or the encrypted export.
- Never delete the data folder to "start fresh" without saying it erases accounts, settings and keys.

## Environment variables

All optional. `docker run`: `-e NAME=value` before the image name. Compose: under `environment:`. Recreate the container after any change.

| Variable | What it does | Default |
|---|---|---|
| `TZ` | Container time zone, for dates and logs (e.g. `Europe/Paris`) | `UTC` |
| `PUID` | User id the Node process runs as (the data directory is adopted on start) | `1000` |
| `PGID` | Group id for the same process | `1000` |
| `FRIRSS_BASE_URL` | Public base URL; recommended behind a reverse proxy, needed for SSO redirects | derived from the `Host` header |
| `PROXY_INTERNAL_HOSTS` | Private hosts the backend may reach, comma-separated, host only. Needed when FreshRSS is on a LAN or Docker address | — |
| `PROXY_REWRITES` | Public→internal URL rewrites (`from=to`, comma-separated), e.g. `https://rss.example.com=http://freshrss:80` | — |
| `CORS_ORIGIN` | Allowed CORS origin(s); only for split front/back deployments, almost never needed | — |
| `REDIS_URL` | Enables the Redis cache, e.g. `redis://redis:6379`; empty disables it | — |
| `CACHE_ARTICLES_PER_FEED` | Articles kept per feed in the cache | `50` |
| `CACHE_TTL` | Cache key expiry, in seconds | `86400` |
| `CACHE_SYNC_INTERVAL` | Background pre-fetch every N minutes (`0` disables; needs `REDIS_URL`) | `0` |
| `CACHE_SYNC_ACTIVE_DAYS` | Only pre-fetch for users seen in the last N days | `7` |
| `CACHE_SYNC_PARALLEL_USERS` | Users pre-fetched in parallel | `3` |
| `FRIRSS_REFRESH_MAX_FEEDS` | Feeds refreshed per press of the refresh button | `1000` |
| `FRIRSS_PROXY_RATE_LIMIT` | Proxied, extraction and AI requests per user per minute (`0` disables) | `600` |
| `FRIRSS_DATA_DIR` | SQLite database directory inside the container; leave it at `/app/data` | `/app/data` |
