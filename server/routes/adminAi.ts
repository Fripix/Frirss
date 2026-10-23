// server/routes/adminAi.ts
import { Router } from 'express';
import { setSetting } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  listProviders, getProvider, createProvider, updateProvider, deleteProvider, reorderProviders, adminKeyFor,
  isAiEnabled, userKeysAllowed, dailyCap, defaultProviderId, normalizeBaseUrl, type ProviderInput,
} from '../ai/store.js';
import { callProvider, listModels } from '../ai/providers.js';
import { AiError } from '../ai/errors.js';

const router = Router();
router.use(requireAuth, requireAdmin);

const TYPES = ['anthropic', 'openai'];
/** Une URL analysable, http ou https, avec un hôte : `http://` seul ne l'est pas. */
function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
  } catch {
    return false;
  }
}
function parseInput(body: unknown, partial: boolean): ProviderInput | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof b[k] === 'string' ? (b[k] as string).trim() : undefined);
  const name = str('name'), type = str('type'), baseUrl = str('baseUrl'), model = str('model');
  if (!partial && (!name || !type || !baseUrl || !model)) return null;
  // Un champ fourni mais vide (ou d'un autre type) est une erreur, jamais un effacement silencieux.
  for (const k of ['name', 'type', 'baseUrl', 'model']) {
    if (b[k] !== undefined && !str(k)) return null;
  }
  if (type !== undefined && !TYPES.includes(type)) return null;
  if (baseUrl !== undefined && !isHttpUrl(baseUrl)) return null;
  // `null` efface la clé, volontairement ; tout autre type que chaîne est refusé.
  if (b.adminKey !== undefined && b.adminKey !== null && typeof b.adminKey !== 'string') return null;
  const out: Partial<ProviderInput> = {};
  if (name !== undefined) out.name = name;
  if (type !== undefined) out.type = type as ProviderInput['type'];
  if (baseUrl !== undefined) out.baseUrl = baseUrl;
  if (model !== undefined) out.model = model;
  // Une clé collée garde parfois un espace ou un retour : retirés. Des espaces
  // seuls ne remplacent pas la clé enregistrée ; `''` (et `null`) l'effacent.
  if (typeof b.adminKey === 'string') {
    const key = b.adminKey.trim();
    if (key || b.adminKey === '') out.adminKey = key;
  } else if (b.adminKey === null) out.adminKey = null;
  if (b.shared !== undefined) out.shared = b.shared === true;
  return out as ProviderInput;
}
const settingsView = () => ({ enabled: isAiEnabled(), userKeysAllowed: userKeysAllowed(), dailyCap: dailyCap(), defaultProvider: defaultProviderId() });

router.get('/ai/providers', (_req, res) => res.json({ providers: listProviders(), settings: settingsView() }));

router.post('/ai/providers', (req, res) => {
  const input = parseInput(req.body, false);
  if (!input) return res.status(400).json({ error: 'invalid_provider' });
  res.status(201).json({ provider: createProvider(input) });
});

router.put('/ai/providers/order', (req, res) => {
  const ids: unknown = req.body?.ids;
  const existing = listProviders().map((p) => p.id).sort((a, b) => a - b);
  const given = Array.isArray(ids) && ids.every((n) => typeof n === 'number' && Number.isInteger(n))
    ? [...(ids as number[])].sort((a, b) => a - b) : null;
  // Exactement l'ensemble des fournisseurs existants : ni doublon, ni inconnu, ni oubli.
  if (!given || given.length !== existing.length || given.some((n, i) => n !== existing[i])) {
    return res.status(400).json({ error: 'invalid_order' });
  }
  reorderProviders(ids as number[]);
  res.json({ ok: true });
});

router.put('/ai/providers/:id', (req, res) => {
  const input = parseInput(req.body, true);
  if (!input) return res.status(400).json({ error: 'invalid_provider' });
  const p = updateProvider(Number(req.params.id), input);
  if (!p) return res.status(404).json({ error: 'not_found' });
  res.json({ provider: p });
});

router.delete('/ai/providers/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!deleteProvider(id)) return res.status(404).json({ error: 'not_found' });
  if (defaultProviderId() === id) setSetting('ai_default_provider', '');
  res.json({ ok: true });
});

router.post('/ai/providers/:id/test', async (req, res) => {
  const p = getProvider(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'not_found' });
  try {
    const r = await callProvider(p, adminKeyFor(p.id), { system: 'Reply with the single word OK.', user: 'ping', maxTokens: 16 });
    res.json({ ok: true, model: r.model, durationMs: r.durationMs });
  } catch (err) {
    const e = err instanceof AiError ? err : new AiError('technical', (err as Error).message);
    res.json({ ok: false, kind: e.kind, message: e.message.slice(0, 200) });
  }
});

/**
 * Les modèles qu'une clé permet d'utiliser, pour le formulaire — enregistré ou
 * non. La clé saisie prime ; sans elle, la clé enregistrée du fournisseur
 * `providerId` sert, mais seulement vers son URL et son type enregistrés : une
 * URL modifiée dans le formulaire ne reçoit jamais la clé d'une autre.
 */
router.post('/ai/models', async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const type = typeof b.type === 'string' ? b.type : '';
  const rawUrl = typeof b.baseUrl === 'string' ? b.baseUrl.trim() : '';
  if (!TYPES.includes(type) || !isHttpUrl(rawUrl)) return res.status(400).json({ error: 'invalid_target' });
  const baseUrl = normalizeBaseUrl(rawUrl);
  let key: string | null = typeof b.adminKey === 'string' && b.adminKey.trim() ? b.adminKey.trim() : null;
  if (!key && typeof b.providerId === 'number') {
    const saved = getProvider(b.providerId);
    if (saved && saved.type === type && saved.baseUrl === baseUrl) key = adminKeyFor(saved.id);
  }
  try {
    const models = await listModels({ type: type as ProviderInput['type'], baseUrl }, key);
    res.json({ ok: true, models: models.slice(0, 1000) });
  } catch (err) {
    const e = err instanceof AiError ? err : new AiError('technical', (err as Error).message);
    res.json({ ok: false, kind: e.kind, message: e.message.slice(0, 200) });
  }
});

router.put('/ai/settings', (req, res) => {
  const { enabled, userKeysAllowed: uk, dailyCap: cap, defaultProvider } = req.body ?? {};
  // Tout valider d'abord, écrire ensuite : un 400 ne doit laisser aucune écriture partielle.
  if (cap !== undefined && (typeof cap !== 'number' || !Number.isInteger(cap) || cap < 0)) {
    return res.status(400).json({ error: 'invalid_cap' });
  }
  if (defaultProvider !== undefined && defaultProvider !== null
    && (typeof defaultProvider !== 'number' || !Number.isInteger(defaultProvider) || !getProvider(defaultProvider))) {
    return res.status(400).json({ error: 'unknown_provider' });
  }
  if (enabled !== undefined) setSetting('ai_enabled', enabled === true ? 'true' : 'false');
  if (uk !== undefined) setSetting('ai_user_keys_allowed', uk === true ? 'true' : 'false');
  if (cap !== undefined) setSetting('ai_daily_cap', String(cap));
  if (defaultProvider !== undefined) setSetting('ai_default_provider', defaultProvider === null ? '' : String(defaultProvider));
  res.json({ ok: true, settings: settingsView() });
});

export default router;
