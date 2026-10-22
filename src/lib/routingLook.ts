import type { ToggleState } from '../components/Preferences/ai/RoutingControls';

/**
 * Les trois aspects d'un interrupteur. Exporté pour que la clé du bloc
 * (`RoutingKey`) dessine ses échantillons avec le même code que les vrais
 * interrupteurs : elle ne peut pas dériver de ce qu'elle explique.
 * Contour en ombre portée intérieure : passer de 1 à 1,5 px ne décale rien.
 */
export function toggleLook(state: ToggleState) {
  return state === 'on'
    ? { background: 'var(--accent)', color: 'var(--on-accent)', boxShadow: 'none' }
    : state === 'inherited'
      ? { background: 'transparent', color: 'var(--accent)', boxShadow: 'inset 0 0 0 1.5px var(--accent)' }
      : { background: 'transparent', color: 'var(--list-summary)', boxShadow: 'inset 0 0 0 1px var(--panel-border)' };
}
