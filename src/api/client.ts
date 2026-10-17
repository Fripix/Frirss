import axios, { type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../stores/authStore';
import { isBackendAuthFailure } from '../lib/loginErrors';

const client = axios.create();

// All FreshRSS calls are routed through the same-origin backend proxy
// (/api/proxy) to avoid cross-origin CORS/preflight. The target travels in a
// header; the FreshRSS token is injected server-side from X-Server-Id (it
// never reaches the client). Auth to our backend uses the JWT.
client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const { serverUrl, activeServerId, backendToken } = useAuthStore.getState();
  // Cloudflare Access uses this header to return a recognizable 401 for
  // unauthenticated XHR requests instead of redirecting the request to HTML.
  config.headers['X-Requested-With'] = 'XMLHttpRequest';
  if (serverUrl && config.url) {
    let fullUrl = config.url.startsWith('http')
      ? config.url
      : `${serverUrl}${config.url}`;
    // Fold axios params into the target URL (the proxy is the real request URL)
    if (config.params) {
      const qs = new URLSearchParams(config.params).toString();
      if (qs) fullUrl += (fullUrl.includes('?') ? '&' : '?') + qs;
      config.params = undefined;
    }
    config.headers['X-Proxy-Target'] = fullUrl;
    if (activeServerId) config.headers['X-Server-Id'] = String(activeServerId);
    config.url = '/api/proxy';
    config.baseURL = undefined;
  }
  if (backendToken) {
    config.headers.Authorization = `Bearer ${backendToken}`;
  }
  return config;
});

/**
 * Cloudflare Access can redirect unauthenticated XHR requests to its login
 * page. Cross-origin redirects commonly surface as opaque Axios network
 * errors, so detect the documented Access 401 fingerprint instead.
 */
const ACCESS_RELOAD_STORAGE_KEY = 'frirss:cloudflare-access-reload-at';
const ACCESS_RELOAD_COOLDOWN_MS = 60_000;
let accessReloadStarted = false;

type HeaderCarrier = {
  response?: {
    status?: number;
    headers?: Record<string, unknown> & { get?: (name: string) => unknown };
  };
};

function isCloudflareAccessUnauthorized(value: unknown): boolean {
  const response = (value as HeaderCarrier | null)?.response;
  if (response?.status !== 401) return false;
  const headers = response.headers;
  const rawHeader =
    typeof headers?.get === 'function'
      ? headers.get('www-authenticate')
      : headers?.['www-authenticate'] ?? headers?.['WWW-Authenticate'];
  return typeof rawHeader === 'string' &&
    rawHeader.trim().toLowerCase().startsWith('cloudflare-access');
}

function reloadForCloudflareAccess(value: unknown): boolean {
  if (typeof window === 'undefined' || !isCloudflareAccessUnauthorized(value)) {
    return false;
  }
  if (accessReloadStarted) return true;

  const now = Date.now();
  try {
    const previous = Number(window.sessionStorage.getItem(ACCESS_RELOAD_STORAGE_KEY));
    if (Number.isFinite(previous) && previous > 0 && now - previous < ACCESS_RELOAD_COOLDOWN_MS) {
      // This is still an Access failure: suppress another reload, but do not
      // let it fall through into FriRSS backend-authentication handling.
      return true;
    }
    window.sessionStorage.setItem(ACCESS_RELOAD_STORAGE_KEY, String(now));
  } catch {
    // Storage can be unavailable in privacy modes; the in-memory guard still
    // prevents concurrent failures from starting multiple reloads.
  }

  accessReloadStarted = true;
  window.location.reload();
  return true;
}

function clearAccessReloadGuard(): void {
  // Do not unlock the current page after it has started navigating. A fresh
  // document gets a fresh module flag and can clear the cooldown on success.
  if (accessReloadStarted || typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(ACCESS_RELOAD_STORAGE_KEY);
  } catch {
    // Ignore storage restrictions; successful API traffic still resets memory.
  }
}

// Ne fermer la session FriRSS que sur NOTRE propre 401.
//
// Deux couches d'authentification sans rapport passent par ce client : le
// compte FriRSS (le JWT qui protège `/api/*`) et le serveur FreshRSS rattaché
// (API Google Reader). Le proxy relaie le statut amont TEL QUEL, donc un 401
// de FreshRSS — session expirée là-bas, mot de passe d'API changé ou jamais
// défini — arrivait ici avec le même statut que l'expiration de notre JWT et
// déconnectait l'utilisateur de FriRSS. Une panne d'une couche fermait la
// session de l'autre.
//
// `isBackendAuthFailure` (`src/lib/loginErrors.ts`) reconnaît les 401 de
// `server/middleware/auth.ts` par leurs messages, et un test y relit le
// middleware pour rougir si les deux listes divergent. Tout autre 401 est
// rejeté normalement, sans toucher à la session.
client.interceptors.response.use(
  (response) => {
    clearAccessReloadGuard();
    return response;
  },
  (error) => {
    if (reloadForCloudflareAccess(error)) {
      return Promise.reject(new Error('Cloudflare Access authentication required'));
    }
    if (isBackendAuthFailure(error)) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  }
);

export default client;
