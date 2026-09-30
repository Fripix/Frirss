// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore } from './uiStore';

/**
 * La confirmation avant « tout marquer comme lu » devient active PAR DÉFAUT
 * (demande du propriétaire, 2026-09-30, après l'issue #17) — mais elle ne doit
 * rien changer aux installations existantes.
 *
 * Ce qui distingue les deux : le serveur. Un compte qui a déjà des
 * préférences enregistrées mais pas celle-ci vient d'avant le changement, et
 * garde donc l'ancien comportement. Un compte sans aucune préférence est neuf.
 */
describe('confirmMarkAllRead — valeur par défaut', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ confirmMarkAllRead: true });
  });

  it('reste active sur une installation neuve', () => {
    useUiStore.getState().applyServerPrefs({});
    expect(useUiStore.getState().confirmMarkAllRead).toBe(true);
  });

  it('repasse à l’ancien comportement pour un compte qui avait déjà des réglages', () => {
    useUiStore.getState().applyServerPrefs({ markReadOnScroll: true, showFavicons: false });
    expect(useUiStore.getState().confirmMarkAllRead).toBe(false);
  });

  it('respecte le choix de qui l’avait explicitement activée', () => {
    useUiStore.getState().applyServerPrefs({ markReadOnScroll: true, confirmMarkAllRead: true });
    expect(useUiStore.getState().confirmMarkAllRead).toBe(true);
  });

  it('respecte le choix de qui l’avait explicitement désactivée', () => {
    useUiStore.setState({ confirmMarkAllRead: true });
    useUiStore.getState().applyServerPrefs({ confirmMarkAllRead: false });
    expect(useUiStore.getState().confirmMarkAllRead).toBe(false);
  });
});
