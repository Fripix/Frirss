// server/routes/ai.ts
import { Router, type Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { proxyRateLimiter } from './proxy.js';
import {
  listProviders, getProvider, setUserKey, adminKeyFor, userKeyFor, hasUserKey, usageToday, dailyCap, nextUsageReset, isAiEnabled, userKeysAllowed, defaultProviderId,
} from '../ai/store.js';
import { availableFor } from '../ai/resolve.js';
import { summarize } from '../ai/summarize.js';
import { translate } from '../ai/translate.js';
import { isAiLanguage } from '../ai/languages.js';
import { AiError } from '../ai/errors.js';
import { DEFAULT_SUMMARY_RATIO } from '../ai/prompts.js';

const router = Router();
router.use(requireAuth);
// Même seau que /api/proxy et /api/extract : un appel IA est une sortie du backend.
if (proxyRateLimiter) router.use(proxyRateLimiter);

const MAX_HTML_BYTES = 200 * 1024;
const MAX_ID_CHARS = 512;
const MAX_TITLE_CHARS = 500;
/** Total des segments d'un lot (spec §17.3) ; le client coupe sous la borne et dit « traduit en partie ». */
const MAX_SEGMENTS_BYTES = 200_000;
/**
 * Segments d'un lot. Le client en envoie au plus 120 ; sans borne, 5 Mo de
 * corps JSON portaient des centaines de milliers de segments d'un octet, chacun
 * enveloppé dans `<seg n="…">` : un prompt plusieurs fois plus lourd pour une
 * seule unité du plafond.
 */
const MAX_SEGMENTS = 1_000;

function availability(user: { id: number; role: string }) {
  return availableFor(
    listProviders(),
    // Clés personnelles ignorées (pas effacées) tant que l'admin ne les permet pas.
    { user: (id) => (userKeysAllowed() ? userKeyFor(user.id, id) : null), admin: (id) => adminKeyFor(id) },
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
    hasUserKey: userKeysAllowed() && hasUserKey(req.user.id, p.id), available: avail.has(p.id),
  }));
  const def = defaultProviderId();
  res.json({
    enabled: true, providers, userKeysAllowed: userKeysAllowed(), dailyCap: dailyCap(), usageToday: usageToday(req.user.id),
    defaultProvider: def && providers.some((p) => p.id === def) ? def : null,
  });
});

const MAX_KEY_CHARS = 4096;

router.put('/keys/:providerId', (req, res) => {
  if (!isAiEnabled()) return res.status(404).json({ error: 'ai_disabled' });
  if (!userKeysAllowed()) return res.status(403).json({ error: 'user_keys_disabled' });
  const providerId = Number(req.params.providerId);
  if (!Number.isInteger(providerId) || providerId <= 0 || !getProvider(providerId)) return res.status(404).json({ error: 'not_found' });
  const { key } = req.body ?? {};
  if (key !== null && typeof key !== 'string') return res.status(400).json({ error: 'invalid_key' });
  const clean = key === null ? '' : key.trim();
  if (clean.length > MAX_KEY_CHARS) return res.status(400).json({ error: 'invalid_key' });
  setUserKey(req.user.id, providerId, clean || null);
  res.json({ ok: true, hasUserKey: !!clean });
});

const asId = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);
/** `regenerate` : absent ou booléen strict ; autre chose est un corps invalide. */
const badFlag = (v: unknown): boolean => v !== undefined && typeof v !== 'boolean';
/** Réglage de confort, jamais une raison de refuser : hors bornes, c'est le défaut. */
const asRatio = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 5 && v <= 50 ? v : DEFAULT_SUMMARY_RATIO);

router.post('/summary', async (req, res) => {
  if (!isAiEnabled()) return res.status(404).json({ error: 'ai_disabled' });
  const { articleId, title, html, provider, feedProvider, categoryProvider, preferredProvider, fallback, ratio, regenerate } = req.body ?? {};
  if (typeof articleId !== 'string' || !articleId || articleId.length > MAX_ID_CHARS || typeof html !== 'string' || Buffer.byteLength(html) > MAX_HTML_BYTES || badFlag(regenerate)) {
    return res.status(400).json({ error: 'invalid_body' });
  }
  try {
    const out = await summarize({
      userId: req.user.id, articleId, title: typeof title === 'string' ? title.slice(0, MAX_TITLE_CHARS) : '', html,
      resolution: { force: asId(provider), feed: asId(feedProvider), category: asId(categoryProvider), preferred: asId(preferredProvider), adminDefault: defaultProviderId() },
      available: availability(req.user),
      fallback: fallback !== false,
      ratio: asRatio(ratio),
      regenerate: regenerate === true,
    });
    res.json(out);
  } catch (err) {
    sendAiError(res, err, 'summary');
  }
});

/** Même traduction des erreurs pour le résumé et la traduction ; le détail reste dans le journal. */
function sendAiError(res: Response, err: unknown, op: 'summary' | 'translate') {
  if (!(err instanceof AiError)) { console.error(`AI ${op} error:`, err); return res.status(500).json({ error: 'ai_failed' }); }
  if (err.message === 'article_too_short') return res.status(400).json({ error: 'article_too_short' });
  if (err.message === 'ai_daily_cap') return res.status(429).json({ error: 'ai_daily_cap', cap: dailyCap(), resetAt: nextUsageReset() });
  if (err.message === 'no_provider') return res.status(409).json({ error: 'no_provider' });
  // Le fournisseur fautif (id + nom donné par l'admin, jamais d'URL ni de clé) : seulement sur les 422 et 502, qui viennent d'un appel.
  const provider = err.provider ? { provider: { id: err.provider.id, name: err.provider.name } } : {};
  if (err.kind === 'refused') return res.status(422).json({ error: 'ai_refused', ...provider });
  console.error(`AI ${op} failed:`, err.kind, err.message);
  res.status(502).json({
    error: 'ai_failed', kind: err.kind, ...provider,
    ...(err.ownKey ? { ownKey: true } : {}),
    ...(err.message === 'segments' ? { detail: 'segments' } : {}),
    // Le temps a manqué (appel abandonné, ou échéance dépensée avant tout
    // appel) : le client rejoue alors un lot de traduction coupé en deux.
    ...(err.timedOut || err.message === 'deadline' ? { detail: 'deadline' } : {}),
  });
}

const isSegments = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length > 0 && v.length <= MAX_SEGMENTS && v.every((s) => typeof s === 'string' && s.length > 0)
  && v.reduce((n: number, s: string) => n + Buffer.byteLength(s), 0) <= MAX_SEGMENTS_BYTES;

router.post('/translate', async (req, res) => {
  if (!isAiEnabled()) return res.status(404).json({ error: 'ai_disabled' });
  const { articleId, scope, targetLang, segments, provider, translationProvider, feedProvider, categoryProvider, preferredProvider, fallback, regenerate, cacheOnly } = req.body ?? {};
  if (typeof articleId !== 'string' || !articleId || articleId.length > MAX_ID_CHARS || (scope !== 'summary' && scope !== 'article') || !isSegments(segments) || badFlag(regenerate) || badFlag(cacheOnly) || (regenerate === true && cacheOnly === true)) {
    return res.status(400).json({ error: 'invalid_body' });
  }
  if (!isAiLanguage(targetLang)) return res.status(400).json({ error: 'invalid_lang' });
  try {
    const out = await translate({
      userId: req.user.id, articleId, scope, targetLang, segments,
      resolution: {
        force: asId(provider), translation: asId(translationProvider), feed: asId(feedProvider), category: asId(categoryProvider),
        preferred: asId(preferredProvider), adminDefault: defaultProviderId(),
      },
      available: availability(req.user),
      fallback: fallback !== false,
      regenerate: regenerate === true,
      cacheOnly: cacheOnly === true,
    });
    res.json(out);
  } catch (err) {
    // Rejeu sans entrée de cache : pas une panne, une absence que le client attend.
    if (err instanceof AiError && err.message === 'not_cached') return res.status(404).json({ error: 'not_cached' });
    sendAiError(res, err, 'translate');
  }
});

export default router;
