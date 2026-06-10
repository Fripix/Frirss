import { create } from 'zustand';
import { clearWriteToken } from '../api/feeds';
import type { User, ServerConnection } from '../types';

/**
 * Auth store — two layers:
 *
 * 1. Backend auth (FriRSS): backendToken, backendUser
 *    → JWT from /api/auth/login or /api/auth/register
 *
 * 2. FreshRSS server selection: serverUrl + activeServerId
 *    → The FreshRSS token itself never reaches the client: it's stored
 *      encrypted in the backend DB and injected server-side by the proxy
 *      (routes/proxy.js) based on the X-Server-Id header. The client only
 *      tracks which server is active.
 *
 * Flow: Login to FriRSS backend → pick/add a FreshRSS server → use the app
 */
export interface AuthState {
  backendToken: string | null;
  backendUser: User | null;
  setBackendAuth: (token: string, user: User | null) => void;
  logoutBackend: () => void;
  isAdmin: () => boolean;
  serverUrl: string;
  activeServerId: string | number | null;
  servers: ServerConnection[];
  setServers: (servers: ServerConnection[]) => void;
  switchServer: (server: { id?: string | number; url: string } | null | undefined) => boolean;
  isAuthenticated: boolean;
  setFreshrssAuth: (serverId: string | number, serverUrl: string) => void;
  logout: () => void;
  readonly isBackendOnly: boolean;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  // ── Backend (FriRSS) ────────────────────────────────────────────
  backendToken: localStorage.getItem('frirss_backendToken') || null,
  backendUser: JSON.parse(localStorage.getItem('frirss_backendUser') || 'null'),

  setBackendAuth: (token, user) => {
    localStorage.setItem('frirss_backendToken', token);
    localStorage.setItem('frirss_backendUser', JSON.stringify(user));
    set({ backendToken: token, backendUser: user });
  },

  logoutBackend: () => {
    // Drop the cached per-server CSRF write-token on logout
    clearWriteToken();
    localStorage.removeItem('frirss_backendToken');
    localStorage.removeItem('frirss_backendUser');
    localStorage.removeItem('frirss_serverUrl');
    localStorage.removeItem('frirss_token'); // legacy cleanup (token no longer stored)
    localStorage.removeItem('frirss_activeServerId');
    set({
      backendToken: null,
      backendUser: null,
      serverUrl: '',
      isAuthenticated: false,
      activeServerId: null,
    });
  },

  isAdmin: () => get().backendUser?.role === 'admin',

  // ── FreshRSS (active server) ────────────────────────────────────
  serverUrl: localStorage.getItem('frirss_serverUrl') || '',
  activeServerId: localStorage.getItem('frirss_activeServerId') || null,

  // List of the user's FreshRSS servers (loaded from the backend)
  servers: [],
  setServers: (servers) => set({ servers }),

  // Switch the active FreshRSS server. The token is resolved server-side from
  // the server id, so we only need id + url here.
  switchServer: (server) => {
    if (!server?.id) return false;
    get().setFreshrssAuth(server.id, server.url);
    return true;
  },

  // isAuthenticated = backend JWT present AND a FreshRSS server is selected
  isAuthenticated:
    !!localStorage.getItem('frirss_backendToken') &&
    !!localStorage.getItem('frirss_activeServerId'),

  setFreshrssAuth: (serverId, serverUrl) => {
    localStorage.setItem('frirss_serverUrl', serverUrl);
    localStorage.setItem('frirss_activeServerId', String(serverId));
    set({ serverUrl, activeServerId: serverId, isAuthenticated: true });
  },

  logout: () => {
    // Full logout (both layers)
    get().logoutBackend();
  },

  // Logged into the backend but no FreshRSS server selected yet
  get isBackendOnly() {
    return !!get().backendToken && !get().activeServerId;
  },
}));
