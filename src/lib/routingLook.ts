import type { ToggleState } from '../components/Preferences/ai/RoutingControls';

/**
 * Les quatre aspects d'un interrupteur : **plein** quand la ligne a sa propre
 * valeur (vert activé, gris désactivé), **cerclé** quand elle hérite (vert si
 * ce qu'elle hérite l'active, gris sinon). Exporté pour que la clé du bloc
 * (`RoutingKey`) dessine ses échantillons avec le même code que les vrais
 * interrupteurs : elle ne peut pas dériver de ce qu'elle explique.
 * Contour en ombre portée intérieure : passer de 1 à 1,5 px ne décale rien.
 */
export function toggleLook(state: ToggleState) {
  switch (state) {
    case 'on': return { background: 'var(--accent)', color: 'var(--on-accent)', boxShadow: 'none' };
    case 'off': return { background: 'var(--panel-border)', color: 'var(--list-summary)', boxShadow: 'none' };
    case 'inherited': return { background: 'transparent', color: 'var(--accent)', boxShadow: 'inset 0 0 0 1.5px var(--accent)' };
    default: return { background: 'transparent', color: 'var(--list-summary)', boxShadow: 'inset 0 0 0 1px var(--panel-border)' };
  }
}

/**
 * La valeur qu'écrit un clic : `true`, `false`, ou `null` (retirer la valeur
 * propre, la ligne hérite de nouveau). L'ordre est celui que le propriétaire a
 * demandé (2026-10-23) — désactivé → activé → hérité — avec une exception
 * voulue au sortir de « hérité » : le clic change toujours ce qui
 * s'applique. Hériter d'un « activé » mène à « désactivé » ; hériter d'un
 * « désactivé » mène droit à « activé », sans passer par un « désactivé »
 * qui ne changerait rien à l'écran ni à la lecture (un second clic pour
 * allumer une ligne neuve).
 */
export function nextRoutingValue(state: ToggleState): boolean | null {
  switch (state) {
    case 'off': return true;
    case 'on': return null;
    case 'inherited': return false;
    default: return true;
  }
}
