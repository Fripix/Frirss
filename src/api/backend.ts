import axios from 'axios';
import { useAuthStore } from '../stores/authStore';
import type { AiLanguage } from '../lib/aiLanguages';
import { endsCurrentSession } from '../lib/loginErrors';
import { TIMEOUT_DEFAULT_MS, TIMEOUT_AI_MS, TIMEOUT_BACKUP_MS } from '../lib/requestTimeouts';
import type {
  User,
  ServerConnection,
  AuthStatus,
  AuthSession,
  BackupEnvelope,
  RestoreSummary,
} from '../types';

// Client for the FriRSS backend API (/api/*)
// Tout appel est borné (`src/lib/requestTimeouts.ts`) ; l'IA et la sauvegarde
// passent un délai plus long, appel par appel.
const backend = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: TIMEOUT_DEFAULT_MS,
});

// Attach JWT token to every request
backend.interceptors.request.use((config) => {
  const { backendToken } = useAuthStore.getState();
  if (backendToken) {
    config.headers.Authorization = `Bearer ${backendToken}`;
  }
  return config;
});

// Ne fermer la session FriRSS que sur NOTRE 401 de session invalide — même
// critère que `src/api/client.ts`. Un 401 de ce client n'est pas toujours une
// session morte : changer son mot de passe avec un mauvais mot de passe actuel
// (« Current password is incorrect ») ou des identifiants refusés répondent
// aussi 401, et éjectaient l'utilisateur pour une simple faute de frappe.
// `isBackendAuthFailure` ne reconnaît que les messages de
// `server/middleware/auth.ts` ; tout autre 401 est rejeté sans toucher à la
// session. Et seulement pour la session en place : un 401 reçu pour un jeton
// remplacé depuis ne ferme pas la suivante (`endsCurrentSession`).
backend.interceptors.response.use(
  (r) => r,
  (error) => {
    const auth = useAuthStore.getState();
    if (endsCurrentSession(error, auth.backendToken)) {
      auth.logoutBackend();
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


/**
 * Changer son propre mot de passe (compte local). Un mot de passe actuel faux
 * répond 401 « Current password is incorrect » : ce n'est pas une session
 * morte, l'intercepteur ne déconnecte pas (`isBackendAuthFailure`). Le serveur
 * ferme les autres sessions du compte.
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await backend.post('/auth/change-password', { currentPassword, newPassword });
}

/** `timeout` : le retour OIDC lit l'utilisateur avec un délai court (`OIDC_GETME_TIMEOUT_MS`). */
export async function getMe(opts: { timeout?: number } = {}): Promise<User> {
  const { data } = await backend.get<{ user: User }>('/auth/me', opts.timeout ? { timeout: opts.timeout } : undefined);
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

/**
 * Rattacher le compte connecté à une identité SSO. Un appel authentifié (le
 * jeton vit dans le navigateur, pas dans un cookie : une simple navigation ne
 * dirait pas quel compte lier), avec le mot de passe actuel, rend l'URL du
 * fournisseur, où l'on part. Le retour remet un ticket que
 * `completeOidcLink` valide depuis cette même session.
 */
export async function linkOidcAccount(password: string): Promise<void> {
  const { data } = await backend.post<{ url: string }>('/auth/oidc/link', { password });
  window.location.href = data.url;
}

/** Valider le ticket du retour SSO : seule la session qui a lancé la liaison le peut. */
export async function completeOidcLink(ticket: string): Promise<void> {
  await backend.post('/auth/oidc/link/complete', { ticket });
}

/** Délier son propre compte de son identité SSO. */
export async function unlinkOidcAccount(): Promise<void> {
  await backend.delete('/auth/oidc/link');
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

export async function unlinkAdminUserSso(id: number): Promise<void> {
  await backend.delete(`/admin/users/${id}/sso`);
}

export async function getAdminSettings(): Promise<Record<string, unknown>> {
  const { data } = await backend.get<{ settings: Record<string, unknown> }>('/admin/settings');
  return data.settings;
}

export async function updateAdminSettings(settings: Record<string, unknown>): Promise<void> {
  await backend.put('/admin/settings', settings);
}

// ── Résumés IA ──────────────────────────────────────────────────────
export interface AiProviderView { id: number; name: string; type: 'anthropic' | 'openai'; hasAdminKey: boolean; shared: boolean; hasUserKey: boolean; available: boolean }
export interface AiConfig { enabled: boolean; providers: AiProviderView[]; userKeysAllowed: boolean; dailyCap: number; usageToday: number; defaultProvider: number | null }
export interface AiSummaryResult { text: string; lang: string | null; providerId: number; providerName: string; model: string; fromCache: boolean; fellBackFrom?: string }
export interface AiTranslationResult { segments: string[]; lang: string | null; same: boolean; providerId: number; providerName: string; model: string; fromCache: boolean; fellBackFrom?: string }
export interface AiProviderAdmin { id: number; name: string; type: 'anthropic' | 'openai'; baseUrl: string; model: string; hasAdminKey: boolean; shared: boolean; position: number }
export interface AiAdminSettings { enabled: boolean; userKeysAllowed: boolean; dailyCap: number; defaultProvider: number | null }
export interface AiProviderInput { name: string; type: 'anthropic' | 'openai'; baseUrl: string; model: string; adminKey?: string | null; shared?: boolean }

export async function getAiConfig(): Promise<AiConfig> {
  const { data } = await backend.get<AiConfig>('/ai/config');
  return data;
}
/**
 * `ratio` : longueur visée en % de l'article (réglage `aiSummaryRatio`).
 * `provider` force un fournisseur pour cet appel ; `feedProvider`, `categoryProvider`
 * et `preferredProvider` sont les étages de routage de l'utilisateur ; `fallback`
 * autorise le repli sur le fournisseur suivant (voir `lib/aiRouting.ts`).
 */
export async function requestAiSummary(body: {
  articleId: string; title: string; html: string; provider?: number; ratio?: number;
  feedProvider?: number; categoryProvider?: number; preferredProvider?: number; fallback?: boolean;
  /** « Régénérer » : le serveur ignore son cache et le remplace (une unité du plafond). */
  regenerate?: boolean;
}): Promise<AiSummaryResult> {
  const { data } = await backend.post<AiSummaryResult>('/ai/summary', body, { timeout: TIMEOUT_AI_MS });
  return data;
}
/**
 * Traduit un lot de segments (`scope` : le résumé ou l'article entier). Mêmes
 * étages de routage que le résumé, plus `translationProvider` (voir
 * `lib/aiRouting.ts`, `op: 'translate'`).
 */
export async function requestAiTranslation(body: {
  articleId: string; scope: 'summary' | 'article'; targetLang: AiLanguage; segments: string[];
  provider?: number; translationProvider?: number; feedProvider?: number; categoryProvider?: number;
  preferredProvider?: number; fallback?: boolean;
  /** « Retraduire » : le serveur ignore son cache et le remplace (une unité du plafond par lot). */
  regenerate?: boolean;
  /** Rejeu : le cache serveur seulement (404 `not_cached` sans entrée), jamais d'appel ni d'unité de plafond. Incompatible avec `regenerate`. */
  cacheOnly?: boolean;
}): Promise<AiTranslationResult> {
  const { data } = await backend.post<AiTranslationResult>('/ai/translate', body, { timeout: TIMEOUT_AI_MS });
  return data;
}
/** Enregistre (chaîne) ou efface (`null`) la clé personnelle de l'utilisateur pour un fournisseur ; la clé ne revient jamais. */
export async function setAiUserKey(providerId: number, key: string | null): Promise<{ ok: true; hasUserKey: boolean }> {
  const { data } = await backend.put<{ ok: true; hasUserKey: boolean }>(`/ai/keys/${providerId}`, { key });
  return data;
}
export async function getAiProviders(): Promise<{ providers: AiProviderAdmin[]; settings: AiAdminSettings }> {
  const { data } = await backend.get<{ providers: AiProviderAdmin[]; settings: AiAdminSettings }>('/admin/ai/providers');
  return data;
}
export async function createAiProvider(input: AiProviderInput): Promise<AiProviderAdmin> {
  const { data } = await backend.post<{ provider: AiProviderAdmin }>('/admin/ai/providers', input);
  return data.provider;
}
export async function updateAiProvider(id: number, input: Partial<AiProviderInput>): Promise<AiProviderAdmin> {
  const { data } = await backend.put<{ provider: AiProviderAdmin }>(`/admin/ai/providers/${id}`, input);
  return data.provider;
}
export async function deleteAiProvider(id: number): Promise<void> {
  await backend.delete(`/admin/ai/providers/${id}`);
}
export async function reorderAiProviders(ids: number[]): Promise<void> {
  await backend.put('/admin/ai/providers/order', { ids });
}
export async function testAiProvider(id: number): Promise<{ ok: boolean; model?: string; durationMs?: number; kind?: string; message?: string }> {
  const { data } = await backend.post<{ ok: boolean; model?: string; durationMs?: number; kind?: string; message?: string }>(`/admin/ai/providers/${id}/test`, undefined, { timeout: TIMEOUT_AI_MS });
  return data;
}
export interface AiModelsResult { ok: boolean; models?: string[]; kind?: string; message?: string }
/**
 * Les modèles disponibles pour un fournisseur, enregistré ou non. Sans clé
 * saisie, le serveur reprend celle de `providerId` si l'URL et le type n'ont pas changé.
 */
export async function listAiModels(target: { type: 'anthropic' | 'openai'; baseUrl: string; adminKey?: string; providerId?: number }): Promise<AiModelsResult> {
  const { data } = await backend.post<AiModelsResult>('/admin/ai/models', target, { timeout: TIMEOUT_AI_MS });
  return data;
}
export async function updateAiSettings(settings: Partial<AiAdminSettings>): Promise<void> {
  await backend.put('/admin/ai/settings', settings);
}

// ── Sauvegarde & restauration ────────────────────────────────────────

/**
 * Produit l'enveloppe chiffrée. En POST, et non en GET : la phrase de passe ne
 * doit apparaître ni dans une URL, ni dans un journal d'accès.
 */
export async function createBackup(passphrase: string): Promise<BackupEnvelope> {
  const { data } = await backend.post<{ backup: BackupEnvelope }>('/admin/backup', { passphrase }, { timeout: TIMEOUT_BACKUP_MS });
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
    { timeout: TIMEOUT_BACKUP_MS },
  );
  return data;
}

export async function applyRestore(backup: unknown, passphrase: string, setup: boolean): Promise<void> {
  await backend.post(`${setup ? '/setup' : '/admin'}/restore`, { backup, passphrase }, { timeout: TIMEOUT_BACKUP_MS });
}

export default backend;
