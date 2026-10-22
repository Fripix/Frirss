import axios from 'axios';
import { useAuthStore } from '../stores/authStore';
import { reloadForCloudflareAccess } from './client';
import type {
  User,
  ServerConnection,
  AuthStatus,
  AuthSession,
  BackupEnvelope,
  RestoreSummary,
} from '../types';

// Client for the FriRSS backend API (/api/*)
const backend = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token to every request
backend.interceptors.request.use((config) => {
  // Cloudflare Access uses this header to return a recognizable 401 for
  // unauthenticated XHR requests instead of a 302 redirect to its login page.
  // Without it, an expired Access session surfaces as an opaque CORS network
  // error (the browser follows the 302 cross-origin) and no recovery can run.
  config.headers['X-Requested-With'] = 'XMLHttpRequest';
  const { backendToken } = useAuthStore.getState();
  if (backendToken) {
    config.headers.Authorization = `Bearer ${backendToken}`;
  }
  return config;
});

// On 401, clear backend auth
backend.interceptors.response.use(
  (r) => r,
  async (error) => {
    // Two unrelated authentication layers pass through this client: the FriRSS
    // JWT (/api/*) and Cloudflare Access in front of the whole origin. Access
    // failures recover through a reload and must never end the FriRSS session.
    if (await reloadForCloudflareAccess(error)) {
      return Promise.reject(new Error('Cloudflare Access authentication required'));
    }
    if (error.response?.status === 401) {
      useAuthStore.getState().logoutBackend();
    }
    return Promise.reject(error);
  }
);

// ── Auth ────────────────────────────────────────────────────────────
export async function getAuthStatus(): Promise<AuthStatus> {
  const { data } = await backend.get<AuthStatus>('/auth/status');
  return data;
}

export async function registerUser(
  username: string,
  password: string,
  displayName: string | undefined,
  email: string
): Promise<AuthSession> {
  const { data } = await backend.post<AuthSession>('/auth/register', { username, password, displayName, email });
  return data;
}

export async function loginUser(username: string, password: string): Promise<AuthSession> {
  const { data } = await backend.post<AuthSession>('/auth/login', { username, password });
  return data;
}


export async function getMe(): Promise<User> {
  const { data } = await backend.get<{ user: User }>('/auth/me');
  return data.user;
}


// ── SSO / OIDC ──────────────────────────────────────────────────────
export interface OidcConfig {
  enabled: boolean;
  buttonLabel?: string;
  // SSO-only mode: hide the local username/password form (only when enabled).
  ssoOnly?: boolean;
}

export async function getOidcConfig(): Promise<OidcConfig> {
  const { data } = await backend.get<OidcConfig>('/auth/oidc/config');
  return data;
}

// Full-page redirect to start the SSO flow (not an XHR)
export function startOidcLogin(): void {
  window.location.href = '/api/auth/oidc/login';
}

// ── Servers (FreshRSS connections) ──────────────────────────────────
export async function getServers(): Promise<ServerConnection[]> {
  const { data } = await backend.get<{ servers: ServerConnection[] }>('/servers');
  return data.servers;
}

export async function addServer(server: Partial<ServerConnection> & Record<string, unknown>): Promise<ServerConnection> {
  const { data } = await backend.post<{ server: ServerConnection }>('/servers', server);
  return data.server;
}

export async function updateServer(
  id: number,
  updates: Record<string, unknown>
): Promise<ServerConnection> {
  const { data } = await backend.put<{ server: ServerConnection }>(`/servers/${id}`, updates);
  return data.server;
}

export async function deleteServer(id: number): Promise<void> {
  await backend.delete(`/servers/${id}`);
}

export async function setDefaultServer(id: number): Promise<void> {
  await backend.put(`/servers/${id}/default`);
}

export interface ActualizeJob {
  status: 'running' | 'done' | 'failed';
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

/**
 * A full sweep and the preferences "Test" are tracked as separate jobs by the
 * backend, so neither can be folded into the other and misreported.
 */
export type RefreshKind = 'refresh' | 'test';

/**
 * Trigger a real feed refresh. Returns null ONLY on 409 (no master token
 * configured); every other failure throws, so a transient error is never
 * mistaken for a missing token.
 *
 * `token`, when given, is a one-shot value tested in place of the server's
 * stored token — the backend honours it only for kind 'test' and never
 * persists it. It lets Preferences' "Test" button verify a token that was
 * just typed but not yet saved.
 */
export async function startActualize(
  id: number,
  kind: RefreshKind = 'refresh',
  maxFeeds?: number,
  token?: string,
): Promise<ActualizeJob | null> {
  try {
    const body: Record<string, unknown> = { kind };
    if (maxFeeds !== undefined) body.maxFeeds = maxFeeds;
    if (token !== undefined) body.token = token;
    const { data } = await backend.post<{ job: ActualizeJob }>(`/servers/${id}/actualize`, body);
    return data.job;
  } catch (err) {
    if ((err as { response?: { status?: number } }).response?.status === 409) return null;
    throw err;
  }
}

export async function getActualizeStatus(
  id: number,
  kind: RefreshKind = 'refresh',
): Promise<ActualizeJob | null> {
  const { data } = await backend.get<{ job: ActualizeJob | null }>(
    `/servers/${id}/actualize`,
    { params: { kind } },
  );
  return data.job;
}

// ── Preferences ─────────────────────────────────────────────────────
export async function getPreferences(): Promise<Record<string, unknown>> {
  const { data } = await backend.get<{ preferences: Record<string, unknown> }>('/preferences');
  return data.preferences;
}

export async function savePreferences(prefs: Record<string, unknown>): Promise<void> {
  await backend.put('/preferences', prefs);
}



// ── Admin ───────────────────────────────────────────────────────────
export async function getAdminUsers(): Promise<User[]> {
  const { data } = await backend.get<{ users: User[] }>('/admin/users');
  return data.users;
}

export async function createAdminUser(payload: Record<string, unknown>): Promise<User> {
  const { data } = await backend.post<{ user: User }>('/admin/users', payload);
  return data.user;
}

export async function updateAdminUser(id: number, updates: Record<string, unknown>): Promise<User> {
  const { data } = await backend.put<{ user: User }>(`/admin/users/${id}`, updates);
  return data.user;
}

export async function setAdminUserPassword(id: number, password: string): Promise<void> {
  await backend.put(`/admin/users/${id}/password`, { password });
}

export async function deleteAdminUser(id: number): Promise<void> {
  await backend.delete(`/admin/users/${id}`);
}

export async function getAdminSettings(): Promise<Record<string, unknown>> {
  const { data } = await backend.get<{ settings: Record<string, unknown> }>('/admin/settings');
  return data.settings;
}

export async function updateAdminSettings(settings: Record<string, unknown>): Promise<void> {
  await backend.put('/admin/settings', settings);
}

// ── Sauvegarde & restauration ────────────────────────────────────────

/**
 * Produit l'enveloppe chiffrée. En POST, et non en GET : la phrase de passe ne
 * doit apparaître ni dans une URL, ni dans un journal d'accès.
 */
export async function createBackup(passphrase: string): Promise<BackupEnvelope> {
  const { data } = await backend.post<{ backup: BackupEnvelope }>('/admin/backup', { passphrase });
  return data.backup;
}

/** `setup` : instance vierge (premier démarrage) plutôt qu'Administration. */
export async function previewRestore(
  backup: unknown,
  passphrase: string,
  setup: boolean,
): Promise<RestoreSummary> {
  const { data } = await backend.post<RestoreSummary>(
    `${setup ? '/setup' : '/admin'}/restore/preview`,
    { backup, passphrase },
  );
  return data;
}

export async function applyRestore(backup: unknown, passphrase: string, setup: boolean): Promise<void> {
  await backend.post(`${setup ? '/setup' : '/admin'}/restore`, { backup, passphrase });
}

export default backend;


// ── Archive.is article lookup ────────────────────────────────────────
export type ArchiveResolveResult =
  | { status: 'ok'; url: string; timestamp: string }
  | { status: 'no_snapshot' | 'no_good_snapshot' | 'soft_block' | 'error' | 'not_allowed' };

export async function resolveArchiveSnapshot(url: string): Promise<ArchiveResolveResult> {
  const { data } = await backend.get<ArchiveResolveResult>('/archive/resolve', { params: { url } });
  return data;
}

// ── AI article summaries ────────────────────────────────────────────
export interface AiSummaryConfig {
  enabled: boolean;
  endpoint: string;
  model: string;
  prompt: string;
  hasApiKey: boolean;
}
export interface AiSummaryConfigInput {
  enabled: boolean;
  endpoint: string;
  model: string;
  prompt: string;
  apiKey?: string;
}
export async function getAiSummaryConfig(): Promise<AiSummaryConfig> {
  const { data } = await backend.get<AiSummaryConfig>('/ai-summary/config');
  return data;
}
export async function saveAiSummaryConfig(config: AiSummaryConfigInput): Promise<AiSummaryConfig> {
  const { data } = await backend.put<AiSummaryConfig>('/ai-summary/config', config);
  return data;
}
export async function clearAiSummaryApiKey(): Promise<AiSummaryConfig> {
  const { data } = await backend.delete<AiSummaryConfig>('/ai-summary/key');
  return data;
}
export async function testAiSummaryConnection(config: { endpoint?: string; model?: string; apiKey?: string }): Promise<void> {
  await backend.post('/ai-summary/test', config);
}
export interface AiSummaryArticlePayload {
  articleKey: string;
  title: string;
  url: string;
  content: string;
}

export async function getCachedAiSummary(payload: AiSummaryArticlePayload): Promise<{ summary: string | null; cached: boolean }> {
  const { data } = await backend.post<{ summary: string | null; cached: boolean }>('/ai-summary/cached', payload);
  return data;
}

export async function summarizeArticle(payload: AiSummaryArticlePayload & { regenerate?: boolean }): Promise<{ summary: string; cached: boolean }> {
  const { data } = await backend.post<{ summary: string; cached: boolean }>('/ai-summary/summarize', payload);
  return data;
}


// Persistent, account-scoped cache for Infrequent sites feed classification.
// Bump this when the classifier changes so older partial/empty cache entries
// cannot suppress a fresh classification run.
const INFREQUENT_CLASSIFIER_VERSION = '4';
export async function getInfrequentFeedCache(subscriptionIds: string[]): Promise<{ cached: boolean; feedIds: string[] }> {
  const { data } = await backend.post<{ cached: boolean; feedIds: string[] }>('/infrequent-cache/lookup', {
    subscriptionIds, algorithmVersion: INFREQUENT_CLASSIFIER_VERSION,
  });
  return data;
}
export async function saveInfrequentFeedCache(subscriptionIds: string[], feedIds: string[]): Promise<void> {
  await backend.put('/infrequent-cache', {
    subscriptionIds, feedIds, algorithmVersion: INFREQUENT_CLASSIFIER_VERSION,
  });
}
