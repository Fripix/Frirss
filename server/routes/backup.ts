import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { userCount } from '../db.js';
import { APP_VERSION } from '../version.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { collectBackup, applyBackup, summarizeBackup } from '../backup.js';
import { sealBackup, openBackup, BackupError, MIN_PASSPHRASE_LENGTH } from '../backupCrypto.js';

// Le déchiffrement d'une enveloppe est un oracle : sans limite de cadence,
// il autorise un essai de phrase de passe par requête, indéfiniment.
const backupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many attempts, please try again later' },
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

/** Traduit un BackupError en réponse HTTP. Les autres erreurs restent des 500. */
function fail(res: Response, err: unknown) {
  if (err instanceof BackupError) {
    const status = err.code === 'weak_passphrase' ? 400 : err.code === 'bad_passphrase' ? 401 : 422;
    return res.status(status).json({ error: err.message, code: err.code });
  }
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
