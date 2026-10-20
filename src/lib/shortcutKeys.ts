/**
 * Touches que l'éditeur de raccourcis refuse : celles que le navigateur ou le
 * système utilise déjà (règle du propriétaire, 2026-10-20). Les flèches restent
 * permises — elles sont aussi des touches de défilement, mais ce choix est
 * tranché : elles sont les raccourcis par défaut et « elles sont pratiques ».
 */
const RESERVED_KEYS = new Set([
  'Tab', ' ', 'Enter',
  // Modificateurs pressés seuls : ils n'existent que pour être combinés.
  'Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS', 'Fn', 'CapsLock',
  // Recherche rapide de Firefox (texte, puis liens seulement).
  '/', "'",
  // Aide-mémoire des raccourcis, traité avant les raccourcis configurables.
  '?',
]);

const FUNCTION_KEY = /^F([1-9]|1[0-2])$/;

export type ShortcutRefusal = { reason: 'reserved' } | { reason: 'taken'; action: string };

/** Pourquoi `key` ne peut pas devenir le raccourci de `action`, ou `null` s'il le peut. */
export function shortcutRefusal(
  key: string,
  action: string,
  shortcuts: Record<string, string>,
): ShortcutRefusal | null {
  if (RESERVED_KEYS.has(key) || FUNCTION_KEY.test(key)) return { reason: 'reserved' };
  const owner = Object.keys(shortcuts).find((a) => a !== action && shortcuts[a] === key);
  return owner ? { reason: 'taken', action: owner } : null;
}
