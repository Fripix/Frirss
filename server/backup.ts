import db from './db.js';
import { resetKeyCache } from './crypto.js';

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
  // Les lignes sont rendues telles que la base les donne, sans conversion.
  // `server/db.ts` déclare `preferences.user_id` en INTEGER, mais une base
  // créée par une version antérieure du schéma la porte en TEXT — et
  // `CREATE TABLE IF NOT EXISTS` ne modifie jamais une table existante. Les
  // deux coexistent donc dans la nature. Convertir serait juste dans un monde
  // et faux dans l'autre : une sauvegarde n'a pas à avoir d'opinion sur le
  // type de ce qu'elle transporte.
  return {
    users: db.prepare('SELECT * FROM users ORDER BY id').all() as Row[],
    servers: db.prepare('SELECT * FROM servers ORDER BY id').all() as Row[],
    preferences: db.prepare('SELECT * FROM preferences ORDER BY user_id, key').all() as Row[],
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

const TABLES = ['users', 'servers', 'preferences', 'settings'] as const;

function assertPayload(payload: unknown): asserts payload is BackupPayload {
  const p = payload as Partial<BackupPayload> | null;
  if (!p || typeof p !== 'object') throw new Error('Malformed backup payload');
  for (const t of TABLES) {
    if (!Array.isArray(p[t])) throw new Error(`Malformed backup payload: ${t}`);
  }
}

/** Insère un tableau de lignes en nommant les colonnes présentes dans chacune. */
function insertRows(table: string, rows: Row[]): void {
  for (const row of rows) {
    const cols = Object.keys(row);
    if (cols.length === 0) continue;
    const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
    // Les valeurs sont liées telles quelles, sans conversion. Le schéma
    // déclaré et les bases anciennes divergent sur `preferences.user_id`
    // (INTEGER dans db.ts, TEXT dans une base créée avant) : convertir
    // serait juste dans un monde et faux dans l'autre. Réinsérer ce qu'on a
    // lu est le seul comportement correct des deux côtés.
    db.prepare(sql).run(...cols.map((c) => row[c] as never));
  }
}

/**
 * Remplace INTÉGRALEMENT le contenu de l'instance par celui de la sauvegarde.
 *
 * Tout se joue dans une seule transaction : si quoi que ce soit échoue, rien
 * n'a bougé et l'instance reste exactement dans son état d'avant.
 */
export function applyBackup(payload: unknown): void {
  assertPayload(payload);

  const run = db.transaction((p: BackupPayload) => {
    // Purge, enfants d'abord — les clés étrangères sont actives.
    db.prepare('DELETE FROM sessions').run();
    db.prepare('DELETE FROM preferences').run();
    db.prepare('DELETE FROM servers').run();
    db.prepare('DELETE FROM users').run();
    db.prepare('DELETE FROM settings').run();

    // Réinsertion, parents d'abord.
    insertRows('users', p.users);
    insertRows('servers', p.servers);
    insertRows('preferences', p.preferences);
    insertRows('settings', p.settings);
  });

  run(payload);

  // Après le commit seulement : la clé de chiffrement vient peut-être de
  // changer, et le processus garde l'ancienne en mémoire.
  resetKeyCache();
}
