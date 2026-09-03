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
  (error) => {
    if (isBackendAuthFailure(error)) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  }
);

export default client;
