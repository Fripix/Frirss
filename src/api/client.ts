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
/** Build a safe top-level Access login URL when an XHR was redirected
 * to Cloudflare's hosted login page. Cross-origin redirects can otherwise
 * appear to Axios as an unhelpful "Network Error". */
export function getCloudflareAccessLoginUrl(
  responseUrl: string | undefined,
  returnTo: string,
): string | null {
  if (!responseUrl) return null;
  try {
    const url = new URL(responseUrl);
    if (
      !url.hostname.endsWith('.cloudflareaccess.com') ||
      !url.pathname.startsWith('/cdn-cgi/access/login/')
    ) {
      return null;
    }
    url.searchParams.set('redirect_url', returnTo || '/');
    return url.toString();
  } catch {
    return null;
  }
}

type ResponseUrlCarrier = {
  request?: { responseURL?: string };
  response?: { request?: { responseURL?: string } };
  config?: { url?: string };
};

function redirectToCloudflareAccess(value: unknown): boolean {
  if (typeof window === 'undefined') return false;
  const error = value as ResponseUrlCarrier | null;
  const responseUrl =
    error?.request?.responseURL ??
    error?.response?.request?.responseURL ??
    error?.config?.url;
  const returnTo = window.location.pathname + window.location.search + window.location.hash;
  const loginUrl = getCloudflareAccessLoginUrl(responseUrl, returnTo);
  if (!loginUrl) return false;
  window.location.assign(loginUrl);
  return true;
}

const ACCESS_RELOAD_STORAGE_KEY = 'frirss:cloudflare-access-reload-at';
const ACCESS_LOGIN_REDIRECT_STORAGE_KEY = 'frirss:cloudflare-access-login-redirect-at';
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

function getAccessMetadataUrl(value: unknown): string | null {
  const response = (value as HeaderCarrier | null)?.response;
  const headers = response?.headers;
  const rawHeader =
    typeof headers?.get === 'function'
      ? headers.get('www-authenticate')
      : headers?.['www-authenticate'] ?? headers?.['WWW-Authenticate'];
  if (typeof rawHeader !== 'string') return null;
  const match = rawHeader.match(/resource_metadata="([^"]+)"/i);
  if (!match || typeof window === 'undefined') return null;
  try {
    const metadataUrl = new URL(match[1]);
    // Only fetch metadata from this app's own origin; never follow an arbitrary
    // URL supplied in an authentication header.
    if (metadataUrl.origin !== window.location.origin || metadataUrl.protocol !== 'https:') {
      return null;
    }
    return metadataUrl.toString();
  } catch {
    return null;
  }
}

export function getCloudflareAccessLoginUrlForAppOrigin(
  appOrigin: string,
  appHost: string,
  returnTo: string,
): string | null {
  try {
    const origin = new URL(appOrigin);
    if (origin.protocol !== 'https:' || origin.host !== appHost) return null;
    const loginUrl = new URL(
      `/cdn-cgi/access/login/${encodeURIComponent(appHost)}`,
      origin.origin,
    );
    loginUrl.searchParams.set('redirect_url', returnTo || '/');
    return loginUrl.toString();
  } catch {
    return null;
  }
}

async function getMetadataBasedLoginUrl(value: unknown, returnTo: string): Promise<string | null> {
  // The metadata header is the Access 401 fingerprint. Keep the login flow on
  // the protected app origin so wildcard Access applications resolve exactly
  // as they did before; the team-domain endpoint can reject wildcard hosts.
  if (!getAccessMetadataUrl(value)) return null;
  return getCloudflareAccessLoginUrlForAppOrigin(
    window.location.origin,
    window.location.host,
    returnTo,
  );
}

export async function reloadForCloudflareAccess(value: unknown): Promise<boolean> {
  if (typeof window === 'undefined' || !isCloudflareAccessUnauthorized(value)) {
    return false;
  }
  if (accessReloadStarted) return true;

  const now = Date.now();
  try {
    const previous = Number(window.sessionStorage.getItem(ACCESS_RELOAD_STORAGE_KEY));
    if (Number.isFinite(previous) && previous > 0 && now - previous < ACCESS_RELOAD_COOLDOWN_MS) {
      // A reload did not restore Access. Retry through the app-origin login endpoint
      // so Cloudflare can resolve the existing wildcard Access application.
      const loginRedirectAt = Number(
        window.sessionStorage.getItem(ACCESS_LOGIN_REDIRECT_STORAGE_KEY),
      );
      if (
        Number.isFinite(loginRedirectAt) &&
        loginRedirectAt > 0 &&
        now - loginRedirectAt < ACCESS_RELOAD_COOLDOWN_MS
      ) {
        return false;
      }

      // Set the circuit breaker before the asynchronous metadata request. If
      // discovery fails, repeated 401s still cannot restart the flicker loop.
      window.sessionStorage.setItem(ACCESS_LOGIN_REDIRECT_STORAGE_KEY, String(now));
      const returnTo = window.location.pathname + window.location.search + window.location.hash;
      const loginUrl = await getMetadataBasedLoginUrl(value, returnTo || '/');
      if (!loginUrl) return false;
      window.location.assign(loginUrl);
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
  (response) => response,
  async (error) => {
    if (redirectToCloudflareAccess(error)) {
      return Promise.reject(new Error('Cloudflare Access authentication required'));
    }
    if (await reloadForCloudflareAccess(error)) {
      return Promise.reject(new Error('Cloudflare Access authentication required'));
    }
    if (isBackendAuthFailure(error)) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  }
);

export default client;
