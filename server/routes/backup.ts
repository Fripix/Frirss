import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { userCount } from '../db.js';
import { APP_VERSION } from '../version.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { collectBackup, applyBackup, summarizeBackup } from '../backup.js';
import { sealBackup, openBackup, BackupError, MIN_PASSPHRASE_LENGTH, type BackupErrorCode } from '../backupCrypto.js';

// Le déchiffrement d'une enveloppe est un oracle : sans limite de cadence,
// il autorise un essai de phrase de passe par requête, indéfiniment.
const backupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
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
    return res.status(403).json({ error: 'Instance already configured' });
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

function handleBackup(req: Request, res: Response) {
  try {
    const { passphrase } = req.body ?? {};
    if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE_LENGTH) {
      return res.status(400).json({ error: 'Passphrase too short', code: 'weak_passphrase' });
    }
    res.json({ backup: sealBackup(collectBackup(), passphrase, APP_VERSION) });
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
export const adminBackupRouter = Router();
adminBackupRouter.use(requireAuth, requireAdmin);
adminBackupRouter.post('/backup', backupLimiter, handleBackup);
adminBackupRouter.post('/restore/preview', backupLimiter, handlePreview);
adminBackupRouter.post('/restore', backupLimiter, handleRestore);

export const setupBackupRouter = Router();
setupBackupRouter.use(requireEmptyInstance);
setupBackupRouter.post('/restore/preview', backupLimiter, handlePreview);
setupBackupRouter.post('/restore', backupLimiter, handleRestore);
