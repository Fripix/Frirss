import { useUiStore } from '../../stores/uiStore';

/**
 * Premier résumé demandé sur cet appareil : si le panneau est replié, on le
 * déplie — une seule fois (`aiPanelAutoExpanded`). Quelqu'un qui le replie
 * ensuite l'a fait exprès, et la demande suivante ne le rouvre plus.
 *
 * Partagé par le bouton « Résumer » et par le raccourci / la palette : qui
 * demande un résumé doit le voir arriver, quel que soit le chemin pris.
 * (Un module à part et non un export de `AiSummary.tsx` : un composant ne doit
 * exporter que des composants, sinon le rechargement à chaud se dégrade.)
 */
export function expandOnFirstSummary(): void {
  const ui = useUiStore.getState();
  if (ui.aiPanelCollapsed && !ui.aiPanelAutoExpanded) {
    ui.setAiPanelCollapsed(false);
    ui.markAiPanelAutoExpanded();
  }
}
