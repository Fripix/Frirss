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
import extractRoutes from './routes/extract.js';
import archiveRoutes from './routes/archive.js';
import aiSummaryRoutes from './routes/aiSummary.js';
import infrequentCacheRoutes from './routes/infrequentCache.js';
import intelligenceRoutes from './routes/intelligence.js';
import readingStatsRoutes from './routes/readingStats.js';
import { adminBackupRouter, setupBackupRouter } from './routes/backup.js';
import { migrateEncryptTokens } from './crypto.js';
import { accessLog } from './accessLog.js';
import { startBackgroundSync } from './worker.js';
import { APP_VERSION } from './version.js';

migrateEncryptTokens();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
if (process.env.CORS_ORIGIN) {
  app.use(cors({ origin: process.env.CORS_ORIGIN.split(','), credentials: true }));
}
app.use(express.json({ limit: '5mb' }));

if (process.env.NODE_ENV !== 'test') app.use(accessLog());

app.use('/api/auth', authRoutes);
app.use('/api/servers', serversRoutes);
app.use('/api/preferences', preferencesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin', adminBackupRouter);
app.use('/api/setup', setupBackupRouter);
app.use('/api/proxy', proxyRoutes);
app.use('/api/extract', extractRoutes);
app.use('/api/archive', archiveRoutes);
app.use('/api/ai-summary', aiSummaryRoutes);
app.use('/api/infrequent-cache', infrequentCacheRoutes);
app.use('/api/intelligence', intelligenceRoutes);
app.use('/api/reading-stats', readingStatsRoutes);

const startedAt = Date.now();
app.get('/api/health', (req, res) => {
  let dbOk = false;
  try { db.prepare('SELECT 1').get(); dbOk = true; } catch { /* db unreachable */ }
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded', version: APP_VERSION,
    db: dbOk ? 'up' : 'down', uptime: Math.floor((Date.now() - startedAt) / 1000),
  });
});

if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) res.sendFile(path.join(distPath, 'index.html'));
    else next();
  });
}

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => console.log(`FriRSS backend listening on port ${PORT}`));
  startBackgroundSync();
}

export default app;
