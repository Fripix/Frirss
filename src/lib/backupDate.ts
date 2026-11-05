/**
 * Date d'une sauvegarde telle que l'aperçu de restauration l'affiche : en
 * toutes lettres, dans la langue de l'interface. L'aperçu montrait la chaîne
 * ISO brute (`2026-10-01T08:05:00.000Z`), à lire en UTC.
 *
 * `null` pour une date absente ou illisible : l'aperçu écrit alors « — ».
 * `timeZone` n'existe que pour les tests ; l'interface prend celle de
 * l'appareil.
 */
export function formatBackupDate(iso: string | null | undefined, locale: string, timeZone?: string): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleString(locale, { dateStyle: 'long', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) });
}
