import type { Article } from '../types';

/**
 * « Marquer lu au défilement » — les décisions, isolées du DOM.
 *
 * C'est l'option attendue par tous ceux qui viennent d'un autre lecteur, et la
 * seule façon de traiter une vue Non lus à trois cents entrées sans cliquer
 * trois cents fois.
 *
 * L'écriture passe par `toggleRead`, l'un des cinq sites d'écriture existants
 * de `feedStore` — pas un sixième. C'est aussi pourquoi `shouldMark` refuse un
 * article déjà lu : `toggleRead` le repasserait non lu, l'exact contraire de
 * ce que le réglage promet.
 */

/** Délai avant de marquer : le temps de remonter si on est allé trop loin. */
export const MARK_READ_DELAY_MS = 1000;

interface Rect { bottom: number }
interface RootRect { top: number }

/**
 * La ligne est-elle sortie par le HAUT ?
 *
 * Remonter la liste fait sortir des lignes par le BAS : celles-là ne doivent
 * jamais être marquées, on ne les a pas dépassées, on y arrive.
 */
export function scrolledPastTop(rect: Rect, rootRect: RootRect | null | undefined): boolean {
  if (!rootRect) return false;
  return rect.bottom <= rootRect.top;
}

/**
 * `seen` = les lignes qui ont été visibles au moins une fois.
 *
 * Indispensable : l'IntersectionObserver rapporte l'état de TOUTES les lignes
 * observées dès son premier appel. Sans cette condition, ouvrir une vue dont
 * la position de défilement est restaurée marquerait lu tout ce qui se trouve
 * au-dessus.
 */
export function shouldMark(article: Article, pastTop: boolean, seen: Set<string>): boolean {
  if (article.read) return false;
  if (!pastTop) return false;
  return seen.has(article.id);
}
