# ── Stage 1: Build frontend + compile native deps ───────────────────
FROM node:24-alpine AS builder
WORKDIR /app

# Build tools for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
# Optional dev/test build label (e.g. "v1.3.4b3"), injected into the frontend
# via Vite. Empty for production images. Passed as a build-arg by publish.yml.
ARG FRIRSS_DEV_VERSION=""
ENV FRIRSS_DEV_VERSION=$FRIRSS_DEV_VERSION
# Builds the frontend (Vite → dist/) AND compiles the TypeScript server
# (tsc → server-dist/, runnable Node ESM).
RUN npm run build
# Drop dev dependencies — keeps the compiled better-sqlite3 binary
RUN npm prune --omit=dev

# ── Stage 2: Production (nginx + Express) ───────────────────────────
FROM node:24-alpine
WORKDIR /app

# `apk upgrade` first: the base image is rebuilt on its own schedule, so the
# Alpine packages it ships (openssl in particular, which nginx links against)
# are as old as the last node:24-alpine build. Upgrading at build time pulls
# the patched versions from the branch the base image already pins — patch
# level only, never a distro jump. Without it the published image carries
# whatever CVEs the base picked up since its last rebuild.
#
# Then nginx (static + /api proxy), tzdata (so TZ works on Alpine), and the
# runtime lib for better-sqlite3.
RUN apk upgrade --no-cache && apk add --no-cache nginx libstdc++ tzdata su-exec

# ── Unprivileged runtime ────────────────────────────────────────────
# nginx and Node both ran as root: any code execution inside Node owned the
# container, including /app/data — which holds the JWT secret and the
# token-encryption key. docker-entrypoint.sh now drops both to PUID:PGID.
#
# nginx still has to bind :80 without being root, so the capability is granted
# on the binary itself rather than moving the port (the published port is part
# of everyone's reverse-proxy config). libcap is only needed to set it — the
# capability survives on the file, the tool does not need to ship.
#
# The `user` directive is dropped from nginx.conf: it only means something for
# a master running as root, and otherwise emits a warning on every start.
RUN apk add --no-cache --virtual .setcap libcap \
 && setcap 'cap_net_bind_service=+ep' /usr/sbin/nginx \
 && apk del .setcap \
 && sed -i '/^user[[:space:]]/d' /etc/nginx/nginx.conf \
 && mkdir -p /run/nginx /var/lib/nginx /var/log/nginx

# The runtime only ever runs `node` (see docker-entrypoint.sh) — never npm. Drop
# the base image's bundled npm/npx/corepack: they ship their own dependencies
# (tar, brace-expansion, ip-address, undici, …) whose CVEs would be flagged even
# though nothing here executes them.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

ENV NODE_ENV=production
ENV FRIRSS_DATA_DIR=/app/data

# Production node_modules (with the already-compiled native binary) from the builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
# Compiled server (TypeScript → JS) from the builder
COPY --from=builder /app/server-dist ./server-dist
COPY package.json ./
# Operator scripts (backup, password reset). Without these the recovery tools
# documented in the README simply are not in the image — `node
# scripts/backup-db.js` failed with MODULE_NOT_FOUND.
COPY scripts ./scripts

# nginx config
COPY nginx.conf /etc/nginx/http.d/default.conf

# SQLite database on a volume so it survives container rebuilds
RUN mkdir -p /app/data
VOLUME /app/data

# Startup script: chown the data volume, then nginx (background) + Express
# (foreground), both as the unprivileged PUID:PGID.
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 80

# Use 127.0.0.1 (not localhost): inside the container localhost resolves to
# IPv6 ::1, where nginx doesn't listen → the check would always fail.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:80/api/health >/dev/null 2>&1 || exit 1

CMD ["/docker-entrypoint.sh"]
