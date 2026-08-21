import axios from 'axios';
import { useAuthStore } from '../stores/authStore';
import type {
  User,
  ServerConnection,
  AuthStatus,
  AuthSession,
} from '../types';

// Client for the FriRSS backend API (/api/*)
const backend = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token to every request
backend.interceptors.request.use((config) => {
  const { backendToken } = useAuthStore.getState();
  if (backendToken) {
    config.headers.Authorization = `Bearer ${backendToken}`;
  }
  return config;
});

// On 401, clear backend auth
backend.interceptors.response.use(
  (r) => r,
  (error) => {
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

/** Trigger a real feed refresh. Returns null when no master token is configured. */
export async function startActualize(id: number, maxFeeds?: number): Promise<ActualizeJob | null> {
  try {
    const { data } = await backend.post<{ job: ActualizeJob }>(
      `/servers/${id}/actualize`,
      maxFeeds === undefined ? {} : { maxFeeds },
    );
    return data.job;
  } catch (err) {
    if ((err as { response?: { status?: number } }).response?.status === 409) return null;
    throw err;
  }
}

export async function getActualizeStatus(id: number): Promise<ActualizeJob | null> {
  const { data } = await backend.get<{ job: ActualizeJob | null }>(`/servers/${id}/actualize`);
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

export default backend;
