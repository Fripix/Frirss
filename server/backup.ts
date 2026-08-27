import db from './db.js';
import { resetKeyCache } from './crypto.js';
import { BackupError } from './backupCrypto.js';
import { cachePurgeAll } from './cache.js';

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

/**
 * Réglages sans lesquels l'instance restaurée serait irrécupérable :
 * `encryption_key` déchiffre les jetons FreshRSS des serveurs restaurés, et
 * `jwt_secret` signe les sessions — sans lui, `getJwtSecret()` rend `''` et
 * plus personne ne peut se connecter. Une sauvegarde amputée de l'un des deux
 * « réussirait » à s'appliquer tout en brisant l'instance, et au redémarrage
 * suivant une clé de chiffrement neuve rendrait tous les jetons restaurés
 * illisibles. Peu probable, mais irrécupérable — le mauvais compromis.
 */
const REQUIRED_SETTINGS = ['encryption_key', 'jwt_secret'] as const;

function assertPayload(payload: unknown): asserts payload is BackupPayload {
  const p = payload as Partial<BackupPayload> | null;
  if (!p || typeof p !== 'object') throw new Error('Malformed backup payload');
  for (const t of TABLES) {
    if (!Array.isArray(p[t])) throw new Error(`Malformed backup payload: ${t}`);
  }
  const settingsKeys = new Set((p.settings as Row[]).map((s) => s.key as string));
  for (const key of REQUIRED_SETTINGS) {
    if (!settingsKeys.has(key)) throw new Error(`Malformed backup payload: missing setting ${key}`);
  }
}

/** Colonnes réellement présentes dans `table`, selon le schéma courant. */
function tableColumns(table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

/**
 * Insère un tableau de lignes en nommant les colonnes présentes dans chacune.
 *
 * Le garde de version du format d'enveloppe (`openBackup`) ne couvre pas ce
 * cas : il protège le FORMAT de l'enveloppe, qu'un simple `ALTER TABLE ADD
 * COLUMN` ne fait pas changer. Une sauvegarde produite par un FriRSS plus
 * récent — donc avec une colonne que le schéma courant ne connaît pas
 * encore — est le déclencheur réaliste, et rien d'autre ne le rattrape. Sans
 * ce contrôle, `INSERT` échouerait avec un `SQLITE_ERROR` opaque, journalisé
 * mais rendu au client sous un message générique.
 *
 * On NOMME la colonne fautive plutôt que de la filtrer en silence : un filtre
 * silencieux avaliserait la perte d'une future colonne sensible (par exemple
 * `users.totp_secret`) sans que personne ne le remarque.
 */
function insertRows(table: string, rows: Row[]): void {
  const validColumns = tableColumns(table);
  for (const row of rows) {
    const cols = Object.keys(row);
    if (cols.length === 0) continue;
    for (const c of cols) {
      if (!validColumns.has(c)) {
        throw new BackupError(
          'schema_mismatch',
          `La sauvegarde contient une colonne inconnue « ${table}.${c} » — probablement produite par une version plus récente de FriRSS. Rien n'a été modifié.`,
        );
      }
    }
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

  // Après le commit seulement, et les deux ensemble : c'est le même piège
  // sous deux formes — de l'état vivant hors de la transaction SQL. La clé de
  // chiffrement vient peut-être de changer et le processus garde l'ancienne
  // en mémoire ; le cache Redis (s'il est actif) indexe ses clés par
  // identifiant numérique d'utilisateur, et applyBackup réinstalle un jeu
  // d'utilisateurs différent sur ces mêmes identifiants — sans purge,
  // l'utilisateur 1 restauré verrait le cache de l'ancien utilisateur 1
  // jusqu'à expiration, et c'est ce cache que le client affiche en premier.
  resetKeyCache();
  void cachePurgeAll();
}
