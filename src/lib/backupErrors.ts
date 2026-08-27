/**
 * Clé i18n décrivant un échec de sauvegarde ou de restauration.
 *
 * Le serveur renvoie `{ error, code }` ; c'est ce `code` qui permet de dire à
 * l'utilisateur laquelle des trois pannes il vient de rencontrer, plutôt qu'un
 * message générique. C'est toute la raison d'être de l'en-tête en clair de
 * l'enveloppe — d'où un test dédié.
 */
export function backupErrorKey(err: unknown): string {
  const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
  switch (code) {
    case 'not_a_backup': return 'backup.errNotBackup';
    case 'unsupported_version': return 'backup.errVersion';
    case 'bad_passphrase': return 'backup.errPassphrase';
    case 'schema_mismatch': return 'backup.errSchema';
    case 'rate_limited': return 'backup.errTooMany';
    case 'instance_configured': return 'backup.errConfigured';
    default: return 'backup.errGeneric';
  }
}
