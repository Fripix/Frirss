// server/routes/ai.ts
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { proxyRateLimiter } from './proxy.js';
import {
  listProviders, adminKeyFor, userKeyFor, hasUserKey, usageToday, dailyCap, nextUsageReset, isAiEnabled, userKeysAllowed, defaultProviderId,
} from '../ai/store.js';
import { availableFor } from '../ai/resolve.js';
import { summarize } from '../ai/summarize.js';
import { AiError } from '../ai/errors.js';

const router = Router();
router.use(requireAuth);
// Même seau que /api/proxy et /api/extract : un appel IA est une sortie du backend.
if (proxyRateLimiter) router.use(proxyRateLimiter);

const MAX_HTML_BYTES = 200 * 1024;
const MAX_ID_CHARS = 512;
const MAX_TITLE_CHARS = 500;

function availability(user: { id: number; role: string }) {
  return availableFor(
    listProviders(),
    { user: (id) => userKeyFor(user.id, id), admin: (id) => adminKeyFor(id) },
    { adminUser: user.role === 'admin' },
  );
}

router.get('/config', (req, res) => {
  if (!isAiEnabled()) {
    return res.json({ enabled: false, providers: [], userKeysAllowed: false, dailyCap: 0, usageToday: 0, defaultProvider: null });
  }
  const avail = new Set(availability(req.user).map((a) => a.provider.id));
  const providers = listProviders().map((p) => ({
    id: p.id, name: p.name, type: p.type, hasAdminKey: p.hasAdminKey, shared: p.shared,
    hasUserKey: hasUserKey(req.user.id, p.id), available: avail.has(p.id),
  }));
  const def = defaultProviderId();
  res.json({
    enabled: true, providers, userKeysAllowed: userKeysAllowed(), dailyCap: dailyCap(), usageToday: usageToday(req.user.id),
    defaultProvider: def && providers.some((p) => p.id === def) ? def : null,
  });
});

const asId = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);

router.post('/summary', async (req, res) => {
  if (!isAiEnabled()) return res.status(404).json({ error: 'ai_disabled' });
  const { articleId, title, html, provider, feedProvider, categoryProvider, preferredProvider, fallback } = req.body ?? {};
  if (typeof articleId !== 'string' || !articleId || articleId.length > MAX_ID_CHARS || typeof html !== 'string' || Buffer.byteLength(html) > MAX_HTML_BYTES) {
    return res.status(400).json({ error: 'invalid_body' });
  }
  try {
    const out = await summarize({
      userId: req.user.id, articleId, title: typeof title === 'string' ? title.slice(0, MAX_TITLE_CHARS) : '', html,
      resolution: { force: asId(provider), feed: asId(feedProvider), category: asId(categoryProvider), preferred: asId(preferredProvider), adminDefault: defaultProviderId() },
      available: availability(req.user),
      fallback: fallback !== false,
    });
    res.json(out);
  } catch (err) {
    if (!(err instanceof AiError)) { console.error('AI summary error:', err); return res.status(500).json({ error: 'ai_failed' }); }
    if (err.message === 'article_too_short') return res.status(400).json({ error: 'article_too_short' });
    if (err.message === 'ai_daily_cap') return res.status(429).json({ error: 'ai_daily_cap', cap: dailyCap(), resetAt: nextUsageReset() });
    if (err.message === 'no_provider') return res.status(409).json({ error: 'no_provider' });
    if (err.kind === 'refused') return res.status(422).json({ error: 'ai_refused' });
    console.error('AI summary failed:', err.kind, err.message);
    res.status(502).json({ error: 'ai_failed', kind: err.kind });
  }
});

export default router;
