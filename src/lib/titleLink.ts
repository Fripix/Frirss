import type { Article } from '../types';
import { safeHref } from './safeHref';

/**
 * Le clic sur le titre-lien d'une ligne ou d'une carte appartient-il au
 * navigateur ?
 *
 * Oui pour le clic molette, le ⌘-clic (macOS), le Ctrl-clic et le Maj-clic :
 * le navigateur ouvre alors un onglet en ARRIÈRE-PLAN (ou une fenêtre), ce
 * que `window.open` ne sait pas faire — il ouvre toujours au premier plan.
 * C'est toute la raison d'être du titre-lien.
 *
 * Non pour le clic gauche simple : il sélectionne l'article, comme partout
 * ailleurs sur la ligne. Non plus pour l'Alt-clic, même combiné : Chrome et
 * Firefox TÉLÉCHARGERAIENT la page de l'article.
 */
export function titleClickIsNative(e: {
  button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean;
}): boolean {
  if (e.altKey) return false;
  if (e.button === 1) return true;
  return e.button === 0 && (e.metaKey || e.ctrlKey || e.shiftKey);
}

/**
 * Après une ouverture native du titre (onglet en arrière-plan) : l'article
 * est marqué lu, comme le clic molette sur la ligne le fait aujourd'hui — mais
 * il n'est PAS sélectionné. Ouvrir en arrière-plan, c'est garder sa place :
 * le volet de lecture ne doit pas changer d'article.
 *
 * - **Jamais une bascule** : un article déjà lu n'est pas repassé non lu.
 * - **Marquage implicite** (`{ implicit: true }`, celui du défilement) : sous
 *   « Non lus », la ligne reste à sa place (`shouldLeaveList`,
 *   `src/lib/removeOnRead.ts`) — elle ne disparaît pas sous le curseur au
 *   moment où l'on ouvre l'onglet. `selectArticle`, le chemin du clic molette
 *   d'aujourd'hui, la gardait aussi.
 * - **Rien sans URL ouvrable** (`safeHref`) : aucun onglet n'est parti, le
 *   titre n'est d'ailleurs pas un lien dans ce cas.
 *
 * `toggleRead` (et non `selectArticle`) parce que c'est le seul écrivain qui
 * marque lu sans sélectionner ; hors ligne, il met l'écriture en file
 * d'attente comme `selectArticle`.
 */
export function markReadOnBackgroundOpen(
  article: Article,
  toggleRead: (article: Article, opts: { implicit: true }) => unknown,
): void {
  if (article.read || !safeHref(article.url)) return;
  void toggleRead(article, { implicit: true });
}
