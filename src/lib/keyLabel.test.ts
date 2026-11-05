import { describe, it, expect } from 'vitest';
import { keyLabel } from './keyLabel';

const t = (k: string) => `t:${k}`;

// Trois copies du même formateur divergeaient : la barre des raccourcis
// écrivait « Suppr » en français pour toutes les langues, l'aide-mémoire
// « Esc » quand les Préférences disaient « Échap ».
describe('keyLabel', () => {
  it('écrit les flèches et les touches d’édition en symboles', () => {
    expect(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace'].map((k) => keyLabel(k, t))).toEqual(['↑', '↓', '←', '→', '⌫']);
  });

  it('nomme dans la langue de l’interface les touches qui ont un nom', () => {
    expect(keyLabel('Escape', t)).toBe('t:preferences.shortcuts.keyEscape');
    expect(keyLabel('Delete', t)).toBe('t:preferences.shortcuts.keyDelete');
    expect(keyLabel(' ', t)).toBe('t:preferences.shortcuts.keySpace');
    expect(keyLabel('Enter', t)).toBe('t:preferences.shortcuts.keyEnter');
  });

  // Un raccourci enregistré avant leur refus s'affichait « HOME », « PAGEUP ».
  it('nomme dans la langue de l’interface Début, Fin, PgPréc et PgSuiv', () => {
    expect(['Home', 'End', 'PageUp', 'PageDown'].map((k) => keyLabel(k, t))).toEqual([
      't:preferences.shortcuts.keyHome', 't:preferences.shortcuts.keyEnd',
      't:preferences.shortcuts.keyPageUp', 't:preferences.shortcuts.keyPageDown',
    ]);
  });

  it('met une lettre en capitale', () => {
    expect(keyLabel('b', t)).toBe('B');
  });
});
