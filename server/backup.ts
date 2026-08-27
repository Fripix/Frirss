import db from './db.js';

type Row = Record<string, unknown>;

export interface BackupPayload {
  users: Row[];
  servers: Row[];
  preferences: Row[];
  settings: Row[];
  environment: Record<string, string>;
}

/**
 * Variables d'environnement emportées dans la sauvegarde, en LISTE BLANCHE.
 *
 * Jamais `process.env` en bloc : le conteneur peut porter des variables sans
 * rapport avec FriRSS, et les aspirer dans un fichier de sauvegarde serait un
 * vol de secrets par accident. Une variable absente de cette liste n'entre pas
 * dans le fichier, même si son nom commence par `FRIRSS_`.
 *
 * Elles sont enregistrées pour MÉMOIRE : la restauration les affiche, elle ne
 * les applique pas — ce sont des variables lues au démarrage du processus.
 */
export const BACKUP_ENV_KEYS = [
  'FRIRSS_BASE_URL',
  'FRIRSS_DATA_DIR',
  'FRIRSS_REFRESH_MAX_FEEDS',
  'PORT',
  'CORS_ORIGIN',
  'PROXY_REWRITES',
  'PROXY_INTERNAL_HOSTS',
  'REDIS_URL',
  'CACHE_ARTICLES_PER_FEED',
  'CACHE_TTL',
  'CACHE_SYNC_INTERVAL',
  'CACHE_SYNC_ACTIVE_DAYS',
  'CACHE_SYNC_PARALLEL_USERS',
] as const;

function collectEnvironment(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of BACKUP_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Tout ce que FriRSS sait de lui-même. `sessions` est la seule table écartée :
 * des jetons porteurs qui expirent, dont le pendant navigateur vit de toute
 * façon dans le localStorage de l'ancienne origine.
 */
export function collectBackup(): BackupPayload {
  const preferences = db.prepare('SELECT * FROM preferences ORDER BY user_id, key').all() as Row[];
  // Preserve the correct type: preferences.user_id should be TEXT to match its role as a
  // foreign key to users.id. Even if the schema incorrectly declares it INTEGER, convert it
  // to TEXT for backup consistency (restoring would lose data if this mismatch exists).
  const preferencesWithCorrectTypes = preferences.map((p) => ({
    ...p,
    user_id: String(p.user_id),
  }));

  return {
    users: db.prepare('SELECT * FROM users ORDER BY id').all() as Row[],
    servers: db.prepare('SELECT * FROM servers ORDER BY id').all() as Row[],
    preferences: preferencesWithCorrectTypes,
    settings: db.prepare('SELECT * FROM settings ORDER BY key').all() as Row[],
    environment: collectEnvironment(),
  };
}

/** Résumé montré avant tout remplacement. Ne touche pas à la base. */
export function summarizeBackup(payload: unknown): {
  users: number;
  servers: number;
  environment: Record<string, string>;
} {
  const p = payload as Partial<BackupPayload> | null;
  return {
    users: Array.isArray(p?.users) ? p.users.length : 0,
    servers: Array.isArray(p?.servers) ? p.servers.length : 0,
    environment: (p?.environment && typeof p.environment === 'object' ? p.environment : {}) as Record<string, string>,
  };
}
