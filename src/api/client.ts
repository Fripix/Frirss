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
 * Cloudflare Access redirects unauthenticated XHR/fetch requests to its hosted
 * login page. Because that redirect crosses origins, the browser often exposes
 * it to Axios as a generic Network Error rather than a normal 302/401. Detect
 * the final response URL and send the TOP-LEVEL browser through the Access
 * login flow, returning to the current FriRSS page (not the API endpoint).
 */
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

let accessRedirectStarted = false;

type ResponseUrlCarrier = {
  request?: { responseURL?: string };
  response?: { request?: { responseURL?: string } };
  config?: { url?: string };
};

function redirectToCloudflareAccess(value: unknown): boolean {
  if (typeof window === 'undefined' || accessRedirectStarted) return false;
  const errorOrResponse = value as ResponseUrlCarrier;
  const responseUrl =
    errorOrResponse?.request?.responseURL ??
    errorOrResponse?.response?.request?.responseURL ??
    errorOrResponse?.config?.url;
  const returnTo = window.location.pathname + window.location.search + window.location.hash;
  const loginUrl = getCloudflareAccessLoginUrl(responseUrl, returnTo);
  if (!loginUrl) return false;

  // Parallel API calls may all fail at once. Redirect only once per page load;
  // the module guard resets naturally after the full-page Access login roundtrip.
  accessRedirectStarted = true;
  window.location.assign(loginUrl);
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
  (response) => {
    // A redirected login HTML document must never be treated as a successful
    // FreshRSS API response, even if the browser exposes it as HTTP 200.
    if (redirectToCloudflareAccess(response)) {
      return Promise.reject(new Error('Cloudflare Access authentication required'));
    }
    return response;
  },
  (error) => {
    if (redirectToCloudflareAccess(error)) {
      return Promise.reject(new Error('Cloudflare Access authentication required'));
    }
    if (isBackendAuthFailure(error)) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  }
);

export default client;
