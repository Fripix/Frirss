import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
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

describe('backupErrorKey — instance déjà configurée', () => {
  it('nomme le refus au premier démarrage plutôt que de dire « réessayez »', () => {
    // Le 403 de /api/setup/* ne portait aucun code : le client affichait
    // « L'opération a échoué. Réessayez. » — un conseil qui ne peut pas
    // fonctionner, puisque réessayer rend exactement le même 403.
    expect(backupErrorKey({ response: { data: { code: 'instance_configured' } } }))
      .toBe('backup.errConfigured');
  });

  it('rend une clé qui existe réellement dans les traductions', () => {
    const fr = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/locales/fr.json'), 'utf8'));
    const resolves = (key: string) => key.split('.').reduce((d, part) => d?.[part], fr);
    expect(typeof resolves('backup.errConfigured')).toBe('string');
  });
});

describe('backupErrorKey', () => {
  it('distingue les pannes portées par le code serveur', () => {
    expect(backupErrorKey(withCode('not_a_backup'))).toBe('backup.errNotBackup');
    expect(backupErrorKey(withCode('unsupported_version'))).toBe('backup.errVersion');
    expect(backupErrorKey(withCode('bad_passphrase'))).toBe('backup.errPassphrase');
    expect(backupErrorKey(withCode('schema_mismatch'))).toBe('backup.errSchema');
    expect(backupErrorKey(withCode('rate_limited'))).toBe('backup.errTooMany');
  });

  // 1.8.0 : une sauvegarde sans administrateur actif, ou trop grosse pour
  // être restaurée (un 413 de nginx compris), se nomme au lieu de « réessayez ».
  it('nomme la sauvegarde sans administrateur et la sauvegarde trop grosse', () => {
    expect(backupErrorKey(withCode('no_admin'))).toBe('backup.errNoAdmin');
    expect(backupErrorKey(withCode('too_large'))).toBe('backup.errTooLarge');
  });

  // Un 413 sans code ne vient pas de FriRSS (qui porte `too_large`) : de nginx
  // au-delà de 64 Mo, ou d'un proxy inverse placé devant, plafonné à 1 Mo par
  // défaut. « Allégez les logos » y était un faux remède.
  // Deux administrateurs, ou deux onglets : « réessayez » ne disait pas
  // qu'une restauration était déjà en cours — sur une instance qui vient
  // peut-être d'être remplacée.
  it('dit qu’une restauration est déjà en cours', () => {
    expect(backupErrorKey(withCode('restore_in_progress'))).toBe('backup.errBusy');
  });

  it('ne prête pas à FriRSS un 413 venu d’un intermédiaire', () => {
    expect(backupErrorKey({ response: { status: 413 } })).toBe('backup.errBodyRefused');
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

  it('les six clés rendues existent réellement dans fr.json', () => {
    expect(hasKey('backup.errNotBackup')).toBe(true);
    expect(hasKey('backup.errVersion')).toBe(true);
    expect(hasKey('backup.errPassphrase')).toBe(true);
    expect(hasKey('backup.errGeneric')).toBe(true);
    expect(hasKey('backup.errSchema')).toBe(true);
    expect(hasKey('backup.errTooMany')).toBe(true);
  });
});
