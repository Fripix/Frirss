/**
 * Types partagés du domaine FriRSS.
 *
 * Source de vérité unique pour la forme des données qui circulent entre
 * l'API greader/backend, les stores et les composants. Importés au fur et à
 * mesure de la migration TypeScript.
 */

// ── Filtres de vue ───────────────────────────────────────────────────
export type Filter = 'all' | 'unread' | 'starred' | 'readlater';

// ── Article normalisé (sortie de normalizeArticle) ───────────────────
export interface Article {
  id: string;
  title: string;
  summary: string;
  content: string;
  author: string;
  url: string;
  /** Titre de la source (origin.title) */
  source: string;
  /** streamId de la source (origin.streamId) — clé des compteurs non-lus */
  sourceId: string;
  /** Timestamp en millisecondes */
  published: number;
  read: boolean;
  starred: boolean;
  /** IDs de labels (user/-/label/…) portés par l'article */
  labels: string[];
  /** Catégories hors état/label */
  tags: string[];
}

// ── Abonnements / flux ───────────────────────────────────────────────
export interface FeedCategory {
  id: string;
  label?: string;
}

export interface Subscription {
  id: string;
  title: string;
  url?: string;
  htmlUrl?: string;
  iconUrl?: string;
  categories?: FeedCategory[];
}

export interface UnreadCount {
  id: string;
  count: number;
  newestItemTimestampUsec?: string;
}

export interface Tag {
  id: string;
  type?: string;
}

// ── Réponses brutes de l'API Google Reader ───────────────────────────
export interface GReaderItem {
  id: string;
  title?: string;
  summary?: { content?: string };
  content?: { content?: string };
  author?: string;
  canonical?: { href: string }[];
  alternate?: { href: string }[];
  origin?: { title?: string; streamId?: string };
  published?: number;
  categories?: string[];
}

export interface GReaderStream {
  items: GReaderItem[];
  continuation: string | null;
}

// ── Thèmes ───────────────────────────────────────────────────────────
export interface Theme {
  name: string;
  colors: Record<string, string>;
  fontSizes: Record<string, string>;
}

/** Couleur d'un label (Préférences > couleurs de labels). */
export interface LabelColor {
  color: string;
  inherit?: boolean;
}

// ── Backend (FriRSS) ─────────────────────────────────────────────────
export type Role = 'admin' | 'user';
export type AuthProvider = 'local' | 'oidc';

export interface User {
  id: number;
  username: string;
  email?: string | null;
  display_name?: string;
  role: Role;
  active?: number | boolean;
  auth_provider?: AuthProvider;
}

/** Connexion FreshRSS configurée (le token n'est jamais exposé au client). */
export interface ServerConnection {
  id: number;
  name?: string;
  url: string;
  freshrss_user: string;
  is_default?: number | boolean;
  has_token?: boolean;
  has_refresh_token?: boolean;
}

export interface AuthStatus {
  hasUsers: boolean;
  registrationEnabled: boolean;
  loginAnimation?: string;
}

export interface AuthSession {
  token: string;
  expiresAt: string;
  user: User;
  isFirstUser?: boolean;
}
