/**
 * Les éléments dont le rôle rend les enfants présentationnels (un bouton, une
 * case à cocher, un onglet…) et qui contiennent pourtant un contrôle
 * focalisable : la règle `nested-interactive` d'axe, sans axe.
 *
 * Un lecteur d'écran n'annonce pas ce que contient un bouton ; un bouton ou un
 * lien placé dedans devient introuvable pour lui, et le clavier tombe sur un
 * arrêt de tabulation qu'il ne sait pas nommer. `tabindex="-1"` n'y change
 * rien : l'élément reste focalisable (axe le signale aussi).
 *
 * Sert aux tests des lignes et cartes d'articles (L-26, 1.9.0).
 */
const PRESENTATIONAL_ROLES = new Set([
  'button', 'checkbox', 'img', 'menuitemcheckbox', 'menuitemradio', 'meter',
  'option', 'progressbar', 'radio', 'scrollbar', 'separator', 'slider',
  'switch', 'tab',
]);

const FOCUSABLE = [
  'button:not([disabled])', 'a[href]', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]',
  '[contenteditable]:not([contenteditable="false"])',
].join(', ');

function roleOf(el: Element): string | null {
  const explicit = el.getAttribute('role')?.trim().split(/\s+/)[0];
  if (explicit) return explicit;
  if (el.tagName === 'BUTTON') return 'button';
  return null;
}

export function nestedInteractive(root: Element): Element[] {
  const candidates = [root, ...root.querySelectorAll('*')];
  return candidates.filter((el) => {
    const role = roleOf(el);
    return role !== null && PRESENTATIONAL_ROLES.has(role) && el.querySelector(FOCUSABLE) !== null;
  });
}
