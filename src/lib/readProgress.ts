/**
 * Où en est la lecture, en pourcentage, pour la barre de progression du volet.
 *
 * Un article plus court que la fenêtre n'a rien à faire défiler : il est lu
 * en entier dès qu'il est à l'écran, d'où 100 % et non 0 %.
 *
 * La mesure est appelée depuis un écouteur de défilement. Elle reste pure —
 * l'appelant lit le DOM, coalesce les événements sur une image d'animation et
 * n'écrit l'état qu'ensuite : un `setState` par événement de défilement
 * re-rendait le volet soixante fois par seconde pendant un balayage.
 */
export function readProgressPercent(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  const maxScroll = scrollHeight - clientHeight;
  if (maxScroll <= 0) return 100;
  return Math.min(100, Math.max(0, Math.round((scrollTop / maxScroll) * 100)));
}
