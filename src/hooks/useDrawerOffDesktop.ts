import { useLayoutEffect } from 'react';
import { useUiStore } from '../stores/uiStore';

/**
 * `sidebarVisible` est la préférence de la barre latérale du BUREAU, mais hors
 * bureau elle pilote aussi l'ouverture du tiroir. Sa valeur par défaut est
 * `true` : sans ce garde, un chargement sur téléphone (ou un passage du bureau
 * au téléphone) ouvrait le tiroir tout seul par-dessus la liste.
 *
 * On écrit donc dans le store SANS passer par `setSidebarVisible` : celui-ci
 * persiste, et fermer le tiroir effacerait la préférence du bureau. Au retour
 * sur le bureau, la préférence stockée est relue.
 *
 * Hors bureau, `sidebarIsPreference` est faux : ouvrir ou fermer le tiroir
 * (`toggleSidebar`, `setSidebarVisible`) n'enregistre rien.
 *
 * Le store démarre déjà à `false` sous 1024 px (voir `uiStore`) : le premier
 * rendu n'ouvre pas le tiroir, ce qui évite à `useAndroidBack` d'empiler puis
 * de dépiler une couche d'historique pour rien. Ce hook couvre le reste — une
 * disposition forcée, un redimensionnement.
 */
export function useDrawerOffDesktop(isDesktop: boolean): void {
  // Layout effect : la correction part avant la première peinture.
  useLayoutEffect(() => {
    if (!isDesktop) {
      useUiStore.setState({ sidebarVisible: false, sidebarIsPreference: false });
      return;
    }
    let stored = true;
    try {
      const raw = localStorage.getItem('frirss_sidebarVisible');
      if (raw !== null) stored = JSON.parse(raw) !== false;
    } catch { /* stockage indisponible : la valeur par défaut */ }
    useUiStore.setState({ sidebarVisible: stored, sidebarIsPreference: true });
  }, [isDesktop]);
}
