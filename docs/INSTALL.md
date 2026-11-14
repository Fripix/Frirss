# Installing FriRSS

The [README](../README.md#installation) has the short version. This page has every way to install FriRSS, what to do behind a reverse proxy, how to update and how to back up. Every environment variable is in [CONFIGURATION.md](CONFIGURATION.md).


FriRSS needs two things:

- **A working FreshRSS.** FriRSS shows the feeds FreshRSS fetches; it does not fetch them itself, does not replace it, and does nothing without it. No FreshRSS yet? It is a separate app, installed first — with Docker too, on the same machine if you like: see [freshrss.org](https://freshrss.org).
- **A machine with Docker** — a NAS, a home server, a Raspberry Pi (64-bit OS), a small cloud server, or simply your own computer with Docker Desktop to try it. No Docker yet? [Install it first](https://docs.docker.com/get-docker/).

Just want to see what it looks like? The [live demo](../README.md#live-demo) needs no installation.

> **Install with an AI assistant.** Paste this into ChatGPT, Claude or the assistant you use. It reads [a guide written for it](INSTALL-WITH-AI.md) and walks you through, one step at a time:
>
> ```
> Read https://raw.githubusercontent.com/Fripix/Frirss/main/docs/INSTALL-WITH-AI.md and help me install FriRSS step by step.
> ```

## 0. Before you start: prepare FreshRSS

In FreshRSS, signed in as the user whose feeds you want to read:

1. Turn on the Google Reader API: *Settings → Authentication → Allow API access*.
2. Set an **API password**: *Settings → Profile*. It is set separately from your FreshRSS login password — so apps like FriRSS never hold your login — and it is the one FriRSS will ask for.
3. Note FreshRSS's address (for example `https://rss.example.com` or `http://192.168.1.20:8080`) and your FreshRSS username.

## 1. Start FriRSS

Pick one of the three ways below: **Unraid** if you use Unraid, **Docker Compose** if you want a file you can edit later, **Docker** for a single command. The commands go in a terminal on the machine that will run FriRSS. Each keeps FriRSS's data in a folder (`frirss-data`, or Unraid's appdata folder): that folder *is* your instance, keep it.

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

- Replace `Europe/Zurich` with your [time zone](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones).
- `8080` is the port on your machine: change it if something already uses it.
- **FreshRSS on your home network?** Add `-e PROXY_INTERNAL_HOSTS=<its host or IP only>` (e.g. `192.168.1.20`) before the image name — see step 3.
- The same image is on Docker Hub as `fripix/frirss:latest`.

### Docker Compose

In an empty folder, download the ready-to-edit [`docker-compose.yml`](../docker-compose.yml):

```bash
curl -O https://raw.githubusercontent.com/Fripix/Frirss/main/docker-compose.yml
mkdir -p frirss-data
```

Set your time zone in it (the `TZ=` line), then start it:

```bash
docker compose up -d
```

The optional settings are already in the file, commented out: remove the `# ` in front of a `# - NAME=value` line to turn it on.

### Unraid

In the *Apps* tab (Community Applications), search for **FriRSS** and install its template. It uses port `8787` and keeps its data in Unraid's appdata folder.

### Check that it runs

```bash
curl http://localhost:8080/api/health
```

It answers with `"status":"ok"` and FriRSS's version (on Unraid, use port `8787`). Give it about 15 seconds after the first start. No `curl`? Open the same address in a browser. No answer at all: `docker logs frirss` says why.

## 2. Create your account

Open `http://localhost:8080` on that machine — or `http://<the machine's address>:8080` from another device — and create the first account. It becomes the administrator — on a server open to the internet, create it right away. Registration then closes: new instances refuse sign-ups by default, and you open them again from *Preferences → Administration* when you want to invite someone.

## 3. Connect FreshRSS

FriRSS then asks for your FreshRSS server. These are your **FreshRSS** details, not the FriRSS account you just created:

- **Server URL** — the address you noted in step 0.
- **FreshRSS username** — your FreshRSS user.
- **API password** — the one set in *FreshRSS → Settings → Profile*.

> **FreshRSS on your home network?** (an address like `http://192.168.1.20:8080`, or `http://freshrss` on a Docker network) FriRSS refuses private addresses by default, so no logged-in user can aim it at the rest of your network. Allow your FreshRSS host — the host or IP only:
>
> ```bash
> -e PROXY_INTERNAL_HOSTS=192.168.1.20
> ```
>
> Without it, connecting fails and `docker logs frirss` shows `POST /api/proxy 403`. Public FreshRSS URLs need nothing — unless your network resolves them to a private address (split DNS, Tailscale): then allow that host name the same way.
>
> **Never type `localhost`** (or `127.0.0.1`) as FreshRSS's address, nor add it here: inside the container, it is FriRSS itself. Use the machine's network address.

That's it: your feeds are there.

## 4. Going further (optional)

- **Reach FriRSS from outside your home** through a reverse proxy with HTTPS, and set `FRIRSS_BASE_URL` to its public address — details below.
- **Make it faster** with Redis: lists open instantly and work is shared between your devices (see [Cache (Redis)](CONFIGURATION.md#cache-redis)).
- **Keep a backup** — see [Backups](#backups).

<details>
<summary>Reverse proxy and local AI: the details</summary>

If the proxy is installed directly on the same machine, publish the port on loopback only (`-p 127.0.0.1:8080:80`): Docker opens published ports past most host firewalls. If the proxy runs in a container, put both on one Docker network and point the proxy at `http://frirss:80` instead.

> **Reach FriRSS through your reverse proxy**, not by publishing its port straight to the internet: the login limit relies on the client address the proxy passes on (see [SECURITY.md](../SECURITY.md)).

> **Behind a reverse proxy** (Nginx Proxy Manager, nginx…), give FriRSS at
> least 120 s: an AI translation batch can take up to 110 s, and the usual
> default is 60 s. In Nginx Proxy Manager, paste these two lines under
> *Advanced → Custom Nginx Configuration*; in a plain nginx, put them in the
> `location` that proxies FriRSS:
>
> ```
> proxy_read_timeout 120s;
> proxy_send_timeout 120s;
> ```
>
> Without them, a long translation batch cut by the proxy is first asked again
> as a whole (the server kept working, so it comes back from its cache at no
> extra cost), then split in two if it is cut again; if that is not enough,
> the app says the intermediate server cut the response.
>
> **With a local Ollama**, start it with `OLLAMA_CONTEXT_LENGTH=16384`: a
> translation batch of about 1 200 words needs some 3 300 input tokens, and
> the default 4 096-token context truncates the answer (FriRSS then retries
> it in two halves rather than sending it to another, possibly paid,
> provider).

</details>

## Updating

Read the [release notes](https://github.com/Fripix/Frirss/releases), back up, then fetch the new image and recreate the container — your data folder stays:

```bash
docker compose pull && docker compose up -d
```

With `docker run`: `docker pull ghcr.io/fripix/frirss:latest`, then `docker rm -f frirss` and run the same `docker run` command again, **from the same folder** (from another one, Docker starts an empty instance). On Unraid: *Check for updates* on the Docker tab.

## Backups

Two things are worth backing up, and they are not the same thing.

### The encrypted export

*Preferences → Administration → Backup* produces a single file holding
everything FriRSS knows about itself: accounts and their password hashes, the
configured FreshRSS servers, their tokens **and the key that decrypts them**,
preferences, and instance settings. It does not hold your articles — those live
in FreshRSS. A backup made by 1.9.0 or later cannot be restored on an older
FriRSS (upgrade first); older backups still restore.

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
