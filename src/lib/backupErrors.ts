/**
 * Clé i18n décrivant un échec de sauvegarde ou de restauration.
 *
 * Le serveur renvoie `{ error, code }` ; c'est ce `code` qui permet de dire à
 * l'utilisateur laquelle des trois pannes il vient de rencontrer, plutôt qu'un
 * message générique. C'est toute la raison d'être de l'en-tête en clair de
 * l'enveloppe — d'où un test dédié.
 */
export function backupErrorKey(err: unknown): string {
  const response = (err as { response?: { status?: number; data?: { code?: string } } })?.response;
  const code = response?.data?.code;
  // Le 413 de FriRSS porte `too_large`. Sans code, il vient d'avant : nginx
  // au-delà de 64 Mo, ou un proxy inverse placé devant (1 Mo par défaut). Le
  // message nomme les deux, sans deviner lequel.
  if (!code && response?.status === 413) return 'backup.errBodyRefused';
  switch (code) {
    case 'no_admin': return 'backup.errNoAdmin';
    case 'too_large': return 'backup.errTooLarge';
    case 'not_a_backup': return 'backup.errNotBackup';
    case 'unsupported_version': return 'backup.errVersion';
    case 'bad_passphrase': return 'backup.errPassphrase';
    case 'schema_mismatch': return 'backup.errSchema';
    case 'rate_limited': return 'backup.errTooMany';
    case 'instance_configured': return 'backup.errConfigured';
    default: return 'backup.errGeneric';
  }
}
