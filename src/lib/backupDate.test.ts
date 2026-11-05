import { describe, it, expect } from 'vitest';
import { formatBackupDate } from './backupDate';

describe('formatBackupDate', () => {
  it('écrit la date d’une sauvegarde en toutes lettres, dans la langue donnée', () => {
    const iso = '2026-10-01T08:05:00.000Z';
    const fr = formatBackupDate(iso, 'fr', 'UTC');
    expect(fr).toContain('octobre');
    expect(fr).toContain('2026');
    expect(fr).not.toContain('T08');
    expect(formatBackupDate(iso, 'en', 'UTC')).toContain('October');
  });

  it('rien à afficher pour une date absente ou illisible', () => {
    expect(formatBackupDate(null, 'fr')).toBeNull();
    expect(formatBackupDate('pas une date', 'fr')).toBeNull();
  });
});
