import db, { getSetting } from '../db.js';
import { encrypt, decrypt } from '../crypto.js';
import { cacheEnabled, cacheGet, cacheSet } from '../cache.js';
import { PROMPT_VERSION } from './prompts.js';

export type ProviderType = 'anthropic' | 'openai';
export interface AiProvider {
  id: number; name: string; type: ProviderType; baseUrl: string; model: string;
  hasAdminKey: boolean; shared: boolean; position: number;
}
export interface ProviderInput {
  name: string; type: ProviderType; baseUrl: string; model: string;
  adminKey?: string | null; shared?: boolean;
}
interface Row { id: number; name: string; type: ProviderType; base_url: string; model: string; admin_key: string | null; shared: number; position: number }

const toProvider = (r: Row): AiProvider => ({
  id: r.id, name: r.name, type: r.type, baseUrl: r.base_url, model: r.model,
  hasAdminKey: !!r.admin_key, shared: r.shared === 1, position: r.position,
});

/**
 * Les adaptateurs ajoutent eux-mêmes `/v1/…` : l'URL saisie s'arrête à l'hôte.
 * Un `/v1` collé depuis une doc (`http://ollama:11434/v1/`) est donc retiré,
 * sinon l'appel partirait vers `/v1/v1/chat/completions`.
 */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '').replace(/\/v1$/i, '').replace(/\/+$/, '');
}

export function listProviders(): AiProvider[] {
  return (db.prepare('SELECT * FROM ai_providers ORDER BY position, id').all() as Row[]).map(toProvider);
}
export function getProvider(id: number): AiProvider | null {
  const r = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as Row | undefined;
  return r ? toProvider(r) : null;
}
export function createProvider(input: ProviderInput): AiProvider {
  const pos = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM ai_providers').get() as { p: number }).p;
  const res = db.prepare(
    'INSERT INTO ai_providers (name, type, base_url, model, admin_key, shared, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(input.name, input.type, normalizeBaseUrl(input.baseUrl), input.model,
    input.adminKey ? encrypt(input.adminKey) : null, input.shared ? 1 : 0, pos);
  return getProvider(Number(res.lastInsertRowid))!;
}
export function updateProvider(id: number, input: Partial<ProviderInput>): AiProvider | null {
  const cur = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as Row | undefined;
  if (!cur) return null;
  const adminKey = input.adminKey === undefined ? cur.admin_key
    : input.adminKey === '' || input.adminKey === null ? null : encrypt(input.adminKey);
  db.prepare('UPDATE ai_providers SET name = ?, type = ?, base_url = ?, model = ?, admin_key = ?, shared = ? WHERE id = ?').run(
    input.name ?? cur.name, input.type ?? cur.type, normalizeBaseUrl(input.baseUrl ?? cur.base_url),
    input.model ?? cur.model, adminKey, input.shared === undefined ? cur.shared : (input.shared ? 1 : 0), id,
  );
  return getProvider(id);
}
export function deleteProvider(id: number): boolean {
  return db.prepare('DELETE FROM ai_providers WHERE id = ?').run(id).changes > 0;
}
export function reorderProviders(ids: number[]): void {
  const upd = db.prepare('UPDATE ai_providers SET position = ? WHERE id = ?');
  db.transaction(() => ids.forEach((id, i) => upd.run(i, id)))();
}

export function adminKeyFor(providerId: number): string | null {
  const r = db.prepare('SELECT admin_key FROM ai_providers WHERE id = ?').get(providerId) as { admin_key: string | null } | undefined;
  return r?.admin_key ? decrypt(r.admin_key) : null;
}
export function userKeyFor(userId: number, providerId: number): string | null {
  const r = db.prepare('SELECT key FROM ai_user_keys WHERE user_id = ? AND provider_id = ?').get(userId, providerId) as { key: string } | undefined;
  return r ? decrypt(r.key) : null;
}
export function hasUserKey(userId: number, providerId: number): boolean {
  return !!db.prepare('SELECT 1 FROM ai_user_keys WHERE user_id = ? AND provider_id = ?').get(userId, providerId);
}
export function setUserKey(userId: number, providerId: number, key: string | null): void {
  if (!key) { db.prepare('DELETE FROM ai_user_keys WHERE user_id = ? AND provider_id = ?').run(userId, providerId); return; }
  db.prepare('INSERT OR REPLACE INTO ai_user_keys (user_id, provider_id, key) VALUES (?, ?, ?)').run(userId, providerId, encrypt(key));
}

/** Jour civil local du serveur, `YYYY-MM-DD`. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function usageToday(userId: number): number {
  const r = db.prepare('SELECT count FROM ai_usage WHERE user_id = ? AND day = ?').get(userId, today()) as { count: number } | undefined;
  return r?.count ?? 0;
}
export function bumpUsage(userId: number): number {
  const r = db.prepare(
    'INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1 RETURNING count',
  ).get(userId, today()) as { count: number };
  return r.count;
}
/** Prochain minuit local du serveur : l'instant où le plafond quotidien se remet à zéro. */
export function nextUsageReset(now = new Date()): string {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d.toISOString();
}

export interface AiCacheValue { text: string; lang: string | null }
const AI_CACHE_MAX_ROWS = 10_000;
const AI_CACHE_TTL = 30 * 24 * 3600;

/** Le modèle fait partie de la clé : changer de modèle ne doit pas resservir le résumé de l'ancien. */
export function aiCacheKey(p: { articleId: string; op: 'summary' | 'translate'; providerId: number; model: string; lang?: string; contentHash?: string }): string {
  return `frirss:ai:v${PROMPT_VERSION}:${p.op}:${p.providerId}:${encodeURIComponent(p.model)}:${p.lang ?? '-'}:${p.articleId}:${p.contentHash ?? '-'}`;
}
export async function aiCacheGet(key: string): Promise<AiCacheValue | null> {
  if (cacheEnabled) {
    const raw = await cacheGet(key);
    if (!raw) return null;
    // Une valeur illisible (écrite par une autre version, tronquée) est une absence, pas une erreur.
    try { return JSON.parse(raw) as AiCacheValue; } catch { return null; }
  }
  const r = db.prepare('SELECT text, lang FROM ai_cache WHERE key = ?').get(key) as AiCacheValue | undefined;
  return r ?? null;
}
export async function aiCacheSet(key: string, value: AiCacheValue): Promise<void> {
  if (cacheEnabled) { await cacheSet(key, JSON.stringify(value), AI_CACHE_TTL); return; }
  db.prepare('INSERT OR REPLACE INTO ai_cache (key, text, lang) VALUES (?, ?, ?)').run(key, value.text, value.lang);
  const n = (db.prepare('SELECT COUNT(*) AS n FROM ai_cache').get() as { n: number }).n;
  if (n > AI_CACHE_MAX_ROWS) {
    db.prepare('DELETE FROM ai_cache WHERE key IN (SELECT key FROM ai_cache ORDER BY created_at, rowid LIMIT ?)').run(n - AI_CACHE_MAX_ROWS);
  }
}

export const isAiEnabled = (): boolean => getSetting('ai_enabled') === 'true';
export const userKeysAllowed = (): boolean => getSetting('ai_user_keys_allowed') === 'true';
export const dailyCap = (): number => Math.max(0, parseInt(getSetting('ai_daily_cap') ?? '50', 10) || 0);
export function defaultProviderId(): number | null {
  const v = parseInt(getSetting('ai_default_provider') ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : null;
}
