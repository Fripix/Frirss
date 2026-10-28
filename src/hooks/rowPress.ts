import { createContext, useContext, useEffect } from 'react';
import type { LongPressControl } from './useLongPress';

/**
 * Les appuis longs d'une ligne d'article : celui de la ligne (menu) et ceux
 * de ses boutons (étoile, « À lire plus tard » : classement par catégorie).
 *
 * Deux voisins ont besoin de les voir TOUS :
 * - le balayage qui enveloppe la ligne sur mobile (`MobileArticleRow`) : sa
 *   direction décidée les annule tous, et un appui qui a abouti pendant le
 *   contact en cours — sur la ligne OU sur un bouton — bloque le balayage.
 *   Avant, seul l'appui de la ligne comptait : un appui long sur l'étoile
 *   puis un glisser basculait encore lu / à lire plus tard ;
 * - le drag natif de la ligne (`draggable`) : sur Chrome Android, un appui
 *   long en démarre un (~495 ms) suivi d'un `touchcancel`, y compris quand
 *   le doigt est posé sur l'étoile. Le premier appui tactile qui le réclame
 *   aboutit tout de suite, et le drag est annulé.
 */
export interface RowPressRegistry {
  register: (control: LongPressControl) => () => void;
  cancelAll: () => void;
  firedThisContact: () => boolean;
  claimTouchDrag: () => boolean;
}

export function createRowPressRegistry(): RowPressRegistry {
  const presses = new Set<LongPressControl>();
  return {
    register(control) {
      presses.add(control);
      return () => { presses.delete(control); };
    },
    cancelAll() {
      for (const p of presses) p.cancel();
    },
    firedThisContact() {
      for (const p of presses) if (p.firedThisContact()) return true;
      return false;
    },
    claimTouchDrag() {
      for (const p of presses) if (p.claimTouchDrag()) return true;
      return false;
    },
  };
}

export const RowPressContext = createContext<RowPressRegistry | null>(null);

/** Inscrit un appui long dans le registre de la ligne qui l'englobe, s'il y en a un. */
export function useRegisterRowPress(control: LongPressControl, registry?: RowPressRegistry | null) {
  const fromContext = useContext(RowPressContext);
  const target = registry === undefined ? fromContext : registry;
  useEffect(() => target?.register(control), [target, control]);
}
