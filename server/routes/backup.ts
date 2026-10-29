import express, { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { userCount } from '../db.js';
import { APP_VERSION } from '../version.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { collectBackup, applyBackup, summarizeBackup } from '../backup.js';
import { sealBackup, openBackup, BackupError, MIN_PASSPHRASE_LENGTH, type BackupErrorCode } from '../backupCrypto.js';
import { rateLimitIpKey } from '../validate.js';

// Le déchiffrement d'une enveloppe est un oracle : sans limite de cadence,
// il autorise un essai de phrase de passe par requête, indéfiniment.
const backupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  // Une IPv6 par /56, comme à la connexion (`rateLimitIpKey`).
  keyGenerator: (req) => rateLimitIpKey(req.ip),
  message: { error: 'Too many attempts, please try again later', code: 'rate_limited' },
});

/**
 * Garde des routes `/api/setup/*`. Elles ne peuvent pas exiger d'être
 * administrateur — aucun compte n'existe encore — donc elles doivent refuser
 * dès qu'un seul utilisateur existe. Sans ce garde, n'importe qui remplacerait
 * l'instance par la sienne.
 */
export function requireEmptyInstance(_req: Request, res: Response, next: NextFunction) {
  if (userCount() > 0) {
    // Un code, sans quoi le client retombe sur « Réessayez » — un conseil qui
    // ne peut pas fonctionner, puisque réessayer donnera le même 403.
    return res.status(403).json({ error: 'Instance already configured', code: 'instance_configured' });
  }
  next();
}

/**
 * Correspondance code d'erreur → statut HTTP.
 *
 * Extraite et exportée pour être testée seule : c'est le point unique où une
 * régression réintroduirait le 401 qui déconnectait l'administrateur à
 * chaque phrase de passe erronée — le défaut que cette branche corrige.
 * Jamais 401 ici : l'intercepteur d'axios le lit comme une session expirée et
 * déconnecte, alors que l'utilisateur EST authentifié — c'est la phrase de
 * passe du fichier (ou son contenu) qui pose problème. 422 dit « je ne peux
 * pas traiter ce contenu », ce qui est exactement le cas ; le client
 * distingue les motifs par `code`.
 */
export function backupErrorStatus(code: BackupErrorCode): number {
  return code === 'weak_passphrase' ? 400 : 422;
}

/** Traduit un BackupError en réponse HTTP. Les autres erreurs restent des 500. */
export function fail(res: Response, err: unknown) {
  if (err instanceof BackupError) {
    return res.status(backupErrorStatus(err.code)).json({ error: err.message, code: err.code });
  }
  // Fonctionnalité de reprise après sinistre : le moment où on s'en sert est
  // précisément celui où le diagnostic compte. Le message client reste
  // générique (jamais le corps de la requête ni la phrase de passe côté
  // serveur), mais l'erreur réelle doit survivre quelque part.
  console.error('[backup] operation failed:', err);
  return res.status(500).json({ error: 'Backup operation failed' });
}

/**
 * Taille maximale d'une restauration (`server/index.ts` lit ces deux routes
 * jusque-là, `nginx.conf` aussi). Le lecteur JSON global s'arrête à 5 Mo : une
 * sauvegarde un peu fournie (quatre préférences de 1 Mo suffisent) s'exportait
 * mais ne se restaurait plus — on l'apprenait le jour du sinistre.
 */
export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;

/**
 * Plafond de l'export, sous celui de la restauration : la restauration envoie
 * `{"backup":…,"passphrase":"…"}`, l'export ne mesure que `{"backup":…}`. Sans
 * marge, un export à quelques octets du plafond passait et sa restauration
 * finissait en 413.
 */
export const MAX_EXPORT_BYTES = MAX_BACKUP_BYTES - 4096;

/** Une sauvegarde que la restauration refuserait est refusée dès l'export. */
export function checkBackupSize(json: string, max = MAX_EXPORT_BYTES): void {
  if (Buffer.byteLength(json, 'utf8') > max) {
    throw new BackupError('too_large', 'Backup too large to be restored');
  }
}

function handleBackup(req: Request, res: Response) {
  try {
    const { passphrase } = req.body ?? {};
    if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE_LENGTH) {
      return res.status(400).json({ error: 'Passphrase too short', code: 'weak_passphrase' });
    }
    const body = JSON.stringify({ backup: sealBackup(collectBackup(), passphrase, APP_VERSION) });
    checkBackupSize(body);
    res.type('application/json').send(body);
  } catch (err) {
    fail(res, err);
  }
}

function handlePreview(req: Request, res: Response) {
  try {
    const { backup, passphrase } = req.body ?? {};
    const payload = openBackup(backup, String(passphrase ?? ''));
    const summary = summarizeBackup(payload);
    res.json({
      summary,
      createdAt: (backup as { createdAt?: string })?.createdAt ?? null,
      appVersion: (backup as { appVersion?: string })?.appVersion ?? null,
    });
  } catch (err) {
    fail(res, err);
  }
}

function handleRestore(req: Request, res: Response) {
  try {
    const { backup, passphrase } = req.body ?? {};
    const payload = openBackup(backup, String(passphrase ?? ''));
    applyBackup(payload);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
}

// ── Deux montages, une seule implémentation ─────────────────────────
/**
 * Chemins dont le corps est lu par `restoreJson`, et que le lecteur global
 * (`server/index.ts`) saute. Insensible à la casse et au slash final, comme le
 * routage d'Express.
 */
export const RESTORE_PATH = /^\/api\/(admin|setup)\/restore(\/preview)?\/?$/i;

/**
 * Le lecteur d'une sauvegarde entière, monté dans les routes, APRÈS les gardes.
 * Monté au niveau de l'app (1.8.0 en préparation), il lisait et analysait 64 Mio
 * avant l'authentification et décompressait : 115 octets en brotli devenaient
 * 60 Mio analysés, et quelques dizaines de requêtes anonymes faisaient tomber
 * Node. `inflate: false` : le client n'envoie jamais de corps compressé, et la
 * limite de nginx, elle, porte sur le corps compressé.
 */
const restoreJson = express.json({ limit: MAX_BACKUP_BYTES, inflate: false });

let restoreBusy = false;
/**
 * Une seule sauvegarde lue à la fois : sur une instance neuve,
 * `/api/setup/restore` est anonyme par nature, et chaque lecture peut tenir
 * plusieurs fois 64 Mio en mémoire (le texte, puis l'objet analysé). Libéré à
 * la fin de la réponse, ou à la coupure de la connexion.
 */
export function oneRestoreAtATime(_req: Request, res: Response, next: NextFunction) {
  if (restoreBusy) {
    return res.status(429).json({ error: 'A restore is already in progress', code: 'restore_in_progress' });
  }
  restoreBusy = true;
  let released = false;
  const release = () => { if (!released) { released = true; restoreBusy = false; } };
  res.once('finish', release);
  res.once('close', release);
  next();
}

export const adminBackupRouter = Router();
adminBackupRouter.use(requireAuth, requireAdmin);
adminBackupRouter.post('/backup', backupLimiter, handleBackup);
adminBackupRouter.post('/restore/preview', oneRestoreAtATime, backupLimiter, restoreJson, handlePreview);
adminBackupRouter.post('/restore', oneRestoreAtATime, backupLimiter, restoreJson, handleRestore);

export const setupBackupRouter = Router();
setupBackupRouter.use(requireEmptyInstance);
setupBackupRouter.post('/restore/preview', oneRestoreAtATime, backupLimiter, restoreJson, handlePreview);
setupBackupRouter.post('/restore', oneRestoreAtATime, backupLimiter, restoreJson, handleRestore);
