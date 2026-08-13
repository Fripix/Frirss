import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';

import db from './db.js';
import authRoutes from './routes/auth.js';
import serversRoutes from './routes/servers.js';
import preferencesRoutes from './routes/preferences.js';
import adminRoutes from './routes/admin.js';
import proxyRoutes from './routes/proxy.js';
import { migrateEncryptTokens } from './crypto.js';
import { startBackgroundSync } from './worker.js';

// Encrypt any FreshRSS tokens still stored in plaintext (one-time, idempotent)
migrateEncryptTokens();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// Behind a reverse proxy (nginx/Traefik) in production → trust the first hop
// so rate-limiting and req.protocol use the real client IP / scheme.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// ── Middleware ───────────────────────────────────────────────────────
// Security headers for the API responses. NOTE: in the shipped image nginx
// serves the HTML/static assets directly (only /api is proxied here), so the
// browser-facing security headers for the *document* — CSP, X-Frame-Options,
// nosniff, Referrer-Policy — are set in nginx.conf. CSP is left off here to
// avoid a second, divergent policy on /api. The remaining helmet headers still
// harden the API (and a direct-to-Express deployment without nginx).
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// The frontend is same-origin (Vite proxy in dev, backend-served in prod), so
// CORS is off by default. Set CORS_ORIGIN to enable it for a split deployment.
if (process.env.CORS_ORIGIN) {
  app.use(cors({ origin: process.env.CORS_ORIGIN.split(','), credentials: true }));
}

app.use(express.json({ limit: '5mb' })); // allow logo uploads

// ── Request logging ──────────────────────────────────────────────────
// Lightweight structured access log: method, path, status, duration.
// Silent during tests; /api/health is skipped to avoid healthcheck noise.
if (process.env.NODE_ENV !== 'test') {
  app.use((req, res, next) => {
    if (req.path === '/api/health') return next();
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`);
    });
    next();
  });
}

// ── API Routes ──────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/servers', serversRoutes);
app.use('/api/preferences', preferencesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/proxy', proxyRoutes);

// ── Health check ────────────────────────────────────────────────────
const startedAt = Date.now();
app.get('/api/health', (req, res) => {
  let dbOk = false;
  try {
    db.prepare('SELECT 1').get();
    dbOk = true;
  } catch { /* db unreachable */ }
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    version: '1.3.3',
    db: dbOk ? 'up' : 'down',
    uptime: Math.floor((Date.now() - startedAt) / 1000),
  });
});

// ── Production: serve static frontend ───────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));

  // SPA fallback — plain middleware (Express 5 / path-to-regexp v8 no longer
  // accepts a bare '*' route pattern, which would crash at startup).
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
      res.sendFile(path.join(distPath, 'index.html'));
    } else {
      next();
    }
  });
}

// ── Start ───────────────────────────────────────────────────────────
// Skip the listener under test — supertest binds its own ephemeral port.
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`FriRSS backend listening on port ${PORT}`);
  });
  startBackgroundSync(); // no-op unless REDIS_URL + CACHE_SYNC_INTERVAL are set
}

export default app;
