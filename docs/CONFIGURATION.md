# Configuration


Every variable is optional. With `docker run`, add `-e NAME=value` before the image name; with Compose, uncomment or add the line under `environment:`. Then recreate the container (`docker compose up -d`, or `docker rm -f frirss` and run again).

## Basics

Only if you want local times in logs, or your NAS expects a given user (Unraid uses `99` / `100`).

| Variable | Description | Default |
|---|---|---|
| `TZ` | Container time zone, for dates and logs (e.g. `Europe/Paris`) | `UTC` |
| `PUID` | User id the Node process runs as (the data directory is adopted on start) | `1000` |
| `PGID` | Group id for the same process | `1000` |

## Network

When FreshRSS lives on your local network or in Docker, or when FriRSS sits behind a reverse proxy.

| Variable | Description | Default |
|---|---|---|
| `FRIRSS_BASE_URL` | Public base URL — recommended behind a reverse proxy; fixes OIDC redirect URIs. Without it, the redirect URI is built from the `Host` header alone | derived |
| `PROXY_INTERNAL_HOSTS` | Anti-SSRF allowlist: private hosts the proxy may reach directly, comma-separated. Needed when FreshRSS sits on a LAN or Docker address. The OIDC issuer host is trusted automatically | — |
| `PROXY_REWRITES` | public→internal URL rewrites for the backend proxy (`from=to`, comma-separated) | — |
| `CORS_ORIGIN` | Allowed CORS origin(s) — only for split front/back deployments | — |

## Cache (Redis)

When you want lists to open instantly and the work shared between devices and users. Needs a Redis server; without one, everything still works.

| Variable | Description | Default |
|---|---|---|
| `REDIS_URL` | Enables the read cache (stale-while-revalidate); empty disables it | — |
| `CACHE_ARTICLES_PER_FEED` | Articles kept per feed in the cache | `50` |
| `CACHE_TTL` | Cache key expiry, in seconds | `86400` |
| `CACHE_SYNC_INTERVAL` | Background pre-fetch interval in minutes (`0` disables; needs `REDIS_URL`) | `0` |
| `CACHE_SYNC_ACTIVE_DAYS` | Only pre-fetch for users seen in the last N days | `7` |
| `CACHE_SYNC_PARALLEL_USERS` | Users pre-fetched in parallel | `3` |

## Limits and storage

Rarely needed: the defaults suit a home instance.

| Variable | Description | Default |
|---|---|---|
| `FRIRSS_REFRESH_MAX_FEEDS` | Number of feeds to refresh per button press (non-integer or < 1 → default) | `1000` |
| `FRIRSS_PROXY_RATE_LIMIT` | Proxied, article-extraction and AI requests allowed per user per minute — one shared budget (`0` disables; non-integer or negative → default) | `600` |
| `FRIRSS_DATA_DIR` | SQLite database directory | `/app/data` |

<details>
<summary>How article extraction works</summary>

> Since 1.4.10 the **server** extracts article text: the browser asks
> `GET /api/extract` first, and extracts the page itself only when the server
> could not try — the route is missing (an older backend), or the server cannot
> reach the site. When the server did get the page and turned it down (nothing
> readable, a page too complex to parse, an analysis past its time limit, a
> full queue, a refusal from the site), the browser does not parse it again:
> it would pay the same cost on the phone. Neither side goes past 2 MB of HTML,
> and an address that is not a page (a video, a PDF) is never extracted. With
> `REDIS_URL` set the result is cached by URL rather than by account, so a page
> is extracted once for the whole instance instead of once per device: a
> second device, or another user reading the same feed, gets it instantly.
> Devices asking for the same cold page at the same moment are coalesced onto
> a single extraction, so the origin site sees one request rather than one per
> reader. **Without Redis the route still runs** — it simply keeps nothing, so
> the next device pays for the extraction again. Parsing runs in a worker
> thread, away from the process that serves the instance: each page gets at
> most 10 seconds and 256 MB, a page nested too deeply is refused before it is
> parsed, and at most five extractions run or wait at once — beyond that the
> server answers *busy* and the reader can retry. Budget for it on a small
> host: the largest pages (2 MB, the cap) take up to about a second of CPU
> each.

</details>

Single sign-on is configured at runtime in *Preferences → Administration* (issuer, client ID, client secret).
