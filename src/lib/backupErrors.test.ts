import { describe, it, expect } from 'vitest';
import fr from '../locales/fr.json';
import { backupErrorKey } from './backupErrors';

/** Accède à une clé i18n imbriquée (« backup.errPassphrase » → fr.backup.errPassphrase). */
function hasKey(dotted: string): boolean {
  const parts = dotted.split('.');
  let node: unknown = fr;
  for (const part of parts) {
    if (typeof node !== 'object' || node === null || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string';
}

function withCode(code: string) {
  return { response: { data: { code } } };
}

describe('backupErrorKey', () => {
  it('distingue les trois pannes portées par le code serveur', () => {
    expect(backupErrorKey(withCode('not_a_backup'))).toBe('backup.errNotBackup');
    expect(backupErrorKey(withCode('unsupported_version'))).toBe('backup.errVersion');
    expect(backupErrorKey(withCode('bad_passphrase'))).toBe('backup.errPassphrase');
  });

  it('retombe sur le générique pour weak_passphrase (erreur de saisie, pas de fichier)', () => {
    expect(backupErrorKey(withCode('weak_passphrase'))).toBe('backup.errGeneric');
  });

  it('retombe sur le générique pour un code inconnu', () => {
    expect(backupErrorKey(withCode('quelque_chose_d_imprevu'))).toBe('backup.errGeneric');
  });

  it('retombe sur le générique pour une erreur sans réponse (panne réseau)', () => {
    expect(backupErrorKey(new Error('Network Error'))).toBe('backup.errGeneric');
    expect(backupErrorKey({})).toBe('backup.errGeneric');
  });

  it('retombe sur le générique pour null ou undefined', () => {
    expect(backupErrorKey(null)).toBe('backup.errGeneric');
    expect(backupErrorKey(undefined)).toBe('backup.errGeneric');
  });

  it('les quatre clés rendues existent réellement dans fr.json', () => {
    expect(hasKey('backup.errNotBackup')).toBe(true);
    expect(hasKey('backup.errVersion')).toBe(true);
    expect(hasKey('backup.errPassphrase')).toBe(true);
    expect(hasKey('backup.errGeneric')).toBe(true);
  });
});
