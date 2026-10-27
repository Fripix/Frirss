// ═══════════════════════════════════════════════════════════════════════
// Différences entre deux jeux de préférences — logique pure de `prefsSync`.
//
// La synchronisation n'envoie plus l'instantané complet : seules partent les
// clés dont la valeur locale diffère de la dernière valeur connue du serveur.
// Un appareil resté ouvert ne réécrit donc plus, avec ses vieilles valeurs,
// les clés qu'un autre appareil a changées entre-temps.
// ═══════════════════════════════════════════════════════════════════════

export type PrefsSnapshot = Record<string, unknown>;

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Sérialisation JSON aux clés d'objet triées : `{x,y}` et `{y,x}` sont égaux. */
function stable(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
}

/**
 * Clés de `local` dont la valeur diffère de `known` — une clé absente de
 * `known` (le serveur ne l'a jamais reçue) compte comme modifiée.
 */
export function changedKeys(local: PrefsSnapshot, known: PrefsSnapshot): string[] {
  return Object.keys(local).filter((k) => !has(known, k) || stable(local[k]) !== stable(known[k]));
}

/** Sous-ensemble de `snapshot` limité aux clés demandées ET présentes. */
export function pickKeys(snapshot: PrefsSnapshot, keys: readonly string[]): PrefsSnapshot {
  const out: PrefsSnapshot = {};
  for (const k of keys) if (has(snapshot, k)) out[k] = snapshot[k];
  return out;
}

/**
 * Ce que la relecture du serveur a le droit d'appliquer : les clés qu'il porte,
 * moins celles encore sales localement (une modification pas encore reçue par
 * le serveur ne doit jamais être écrasée par son ancienne valeur).
 */
export function mergeForRelecture(server: PrefsSnapshot, dirty: ReadonlySet<string>): PrefsSnapshot {
  const out: PrefsSnapshot = {};
  for (const k of Object.keys(server)) if (!dirty.has(k)) out[k] = server[k];
  return out;
}
