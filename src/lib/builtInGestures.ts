import { keyLabel } from './keyLabel';
import { isAppleKeyboard } from './platformKeys';

export interface BuiltInGesture {
  /** La touche ou le geste, tel qu'affiché. */
  key: string;
  /** Ce qu'il fait. */
  label: string;
}

/**
 * Les gestes et touches intégrés — ni réassignables ni masquables —, tels
 * que les listent l'aide « ? » et Préférences → Général.
 *
 * Une seule liste pour les deux écrans : chacun tenait la sienne, et elles
 * avaient divergé (A4, 1.9.0) — l'aide n'avait pas « Échap → Retour à la
 * grille », Préférences pas « ? », et ⌘K n'était dans aucune. Les libellés
 * de ⌘K et de « ? » sont ceux de la barre des raccourcis.
 */
export function builtInGestures(t: (k: string) => string): BuiltInGesture[] {
  const esc = keyLabel('Escape', t);
  return [
    { key: esc, label: t('preferences.shortcuts.escExitFocus') },
    { key: esc, label: t('preferences.shortcuts.escBackToGrid') },
    { key: t('preferences.shortcuts.keyDoubleClick'), label: t('preferences.shortcuts.doubleClickFocus') },
    { key: t('preferences.shortcuts.keyHold'), label: t('preferences.shortcuts.holdToFile') },
    { key: isAppleKeyboard() ? '⌘K' : 'Ctrl+K', label: t('palette.title') },
    { key: '?', label: t('preferences.shortcuts.helpTitle') },
  ];
}
