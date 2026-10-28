/**
 * Le libellé affiché d'une touche de raccourci, partout où une touche se montre
 * (barre des raccourcis, aide-mémoire, Préférences, infobulles).
 *
 * Une seule fonction : trois copies divergeaient — la barre écrivait « Suppr »
 * en français pour toutes les langues, l'aide-mémoire « Esc » quand les
 * Préférences disaient « Échap ».
 */
const SYMBOLS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backspace: '⌫',
  Tab: 'Tab',
};

const NAMED: Record<string, string> = {
  ' ': 'preferences.shortcuts.keySpace',
  Escape: 'preferences.shortcuts.keyEscape',
  Enter: 'preferences.shortcuts.keyEnter',
  Delete: 'preferences.shortcuts.keyDelete',
};

export function keyLabel(key: string, t: (k: string) => string): string {
  if (SYMBOLS[key]) return SYMBOLS[key];
  if (NAMED[key]) return t(NAMED[key]);
  return key.toUpperCase();
}
