# ── Stage 1: Build frontend + compile native deps ───────────────────
FROM node:24-alpine AS builder
WORKDIR /app

# Build tools for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
# Builds the frontend (Vite → dist/) AND compiles the TypeScript server
# (tsc → server-dist/, runnable Node ESM).
RUN npm run build
# Drop dev dependencies — keeps the compiled better-sqlite3 binary
RUN npm prune --omit=dev

# ── Stage 2: Production (nginx + Express) ───────────────────────────
FROM node:24-alpine
WORKDIR /app

# nginx (static + /api proxy), tzdata (so TZ works on Alpine), and the runtime
# lib for better-sqlite3
RUN apk add --no-cache nginx libstdc++ tzdata

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

# nginx config
COPY nginx.conf /etc/nginx/http.d/default.conf

# SQLite database on a volume so it survives container rebuilds
RUN mkdir -p /app/data
VOLUME /app/data

# Startup script: nginx (background) + Express (foreground)
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 80

# Use 127.0.0.1 (not localhost): inside the container localhost resolves to
# IPv6 ::1, where nginx doesn't listen → the check would always fail.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:80/api/health >/dev/null 2>&1 || exit 1

CMD ["/docker-entrypoint.sh"]
