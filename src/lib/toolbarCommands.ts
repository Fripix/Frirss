import { useEffect, useRef } from 'react';
import type { ToolbarItemId } from './toolbarItems';

/**
 * Les barres offrent leurs actions à la palette (Ctrl/⌘ K).
 *
 * Même principe que la sonde de l'IA (`aiTranslateProbe.ts`) : c'est le
 * composant qui porte le bouton qui sait si l'action est possible maintenant
 * et sous quel libellé, et qui l'exécute — avec le gestionnaire de son bouton,
 * confirmation de « Tout lu » comprise. La palette ne recopie aucune condition.
 *
 * Les offres ne dépendent PAS de la visibilité du bouton : masqué ou non, la
 * commande est là. C'est ce qui permet de masquer sans rien perdre.
 */

export interface ToolbarOffer {
  /** Identifiant de la commande (`density:compact`, `label:<id>`…). */
  command: string;
  /** L'élément de barre qu'elle remplace (garde-fou de couverture). */
  item: ToolbarItemId;
  /** Libellé déjà traduit, celui du bouton. */
  label: string;
}

const PROBE = 'frirss:toolbar-probe';
const COMMAND = 'frirss:toolbar-command';

/** Côté palette : ce que les barres montées proposent maintenant. */
export function probeToolbarCommands(): ToolbarOffer[] {
  const detail = { offers: [] as ToolbarOffer[] };
  window.dispatchEvent(new CustomEvent(PROBE, { detail }));
  return detail.offers;
}

/** Côté palette : exécuter une commande offerte. */
export function runToolbarCommand(command: string): void {
  window.dispatchEvent(new CustomEvent(COMMAND, { detail: { command } }));
}

/**
 * Côté barre : répondre à la sonde et exécuter ses commandes.
 *
 * `run` ne reçoit qu'une commande que `getOffers()` propose AU MOMENT de
 * l'événement : une palette ouverte sur un état périmé (article changé,
 * « Tout lu » devenu impossible) ne déclenche rien.
 */
export function useToolbarCommands(getOffers: () => ToolbarOffer[], run: (command: string) => void): void {
  const offersRef = useRef(getOffers);
  const runRef = useRef(run);
  useEffect(() => {
    offersRef.current = getOffers;
    runRef.current = run;
  });
  useEffect(() => {
    const onProbe = (e: Event) => {
      (e as CustomEvent<{ offers: ToolbarOffer[] }>).detail.offers.push(...offersRef.current());
    };
    const onCommand = (e: Event) => {
      const { command } = (e as CustomEvent<{ command: string }>).detail;
      if (offersRef.current().some((o) => o.command === command)) runRef.current(command);
    };
    window.addEventListener(PROBE, onProbe);
    window.addEventListener(COMMAND, onCommand);
    return () => {
      window.removeEventListener(PROBE, onProbe);
      window.removeEventListener(COMMAND, onCommand);
    };
  }, []);
}
