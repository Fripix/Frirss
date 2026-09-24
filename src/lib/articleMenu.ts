/**
 * Menu contextuel d'un article : ce qu'il contient, et où il s'ouvre.
 * Spec : docs/superpowers/specs/2026-09-13-article-context-menu-design.md
 */
export type ArticleMenuKind =
  | 'openSource' | 'toggleRead' | 'markBelowRead' | 'markAboveRead'
  | 'toggleStar' | 'toggleReadLater' | 'copyLink';

export interface ArticleMenuItem {
  kind: ArticleMenuKind;
  /** Clé i18n du libellé ; elle suit l'état de l'article. */
  labelKey: string;
}

/**
 * Entrées du menu, dans l'ordre. Sans URL, « Ouvrir à la source » et « Copier le
 * lien » n'ont rien à ouvrir ni à copier : elles disparaissent.
 *
 * `canMarkRange` porte jusqu'ici le refus de `canMarkAllRead`
 * (`src/lib/markAllRead.ts`) : en Favoris et À lire plus tard, l'action du
 * store se refuse déjà — ce ne sont pas des flux qu'on vide, ce sont des
 * sélections transversales — mais une entrée de menu qui ne fait rien est
 * plus déroutante qu'une entrée absente. Dans les autres vues, les deux
 * marquages de plage restent TOUJOURS présents, quelle que soit la position
 * de la ligne dans la liste chargée : elle ne dit rien de ce que le flux
 * contient au-delà, donc les masquer par index mentirait une fois sur deux.
 */
export function articleMenuItems(
  article: { url?: string; read: boolean; starred: boolean },
  isReadLater: boolean,
  canMarkRange: boolean,
): ArticleMenuItem[] {
  const hasUrl = !!article.url?.trim();
  const items: ArticleMenuItem[] = [];
  if (hasUrl) items.push({ kind: 'openSource', labelKey: 'articleRow.openSource' });
  items.push({ kind: 'toggleRead', labelKey: article.read ? 'articleRow.markUnread' : 'articleRow.markRead' });
  // Marquages de plage (issue #15) : placés contre « Marquer lu », dont ils
  // sont l'extension.
  if (canMarkRange) {
    items.push({ kind: 'markBelowRead', labelKey: 'articleRow.markBelowRead' });
    items.push({ kind: 'markAboveRead', labelKey: 'articleRow.markAboveRead' });
  }
  items.push({ kind: 'toggleStar', labelKey: article.starred ? 'articleRow.removeStar' : 'articleRow.addStar' });
  items.push({ kind: 'toggleReadLater', labelKey: isReadLater ? 'articleRow.removeReadLater' : 'articleRow.addReadLater' });
  if (hasUrl) items.push({ kind: 'copyLink', labelKey: 'articleRow.copyLink' });
  return items;
}

/**
 * Point d'ouverture du menu. La touche Menu (ou Maj+F10) émet `contextmenu` sur
 * l'élément focalisé avec `clientX = clientY = 0` : sans ce cas, le menu
 * s'ouvrirait dans le coin de la fenêtre. Il s'ouvre alors sous la ligne.
 */
export function menuAnchor(
  event: { clientX: number; clientY: number },
  rect: { left: number; bottom: number },
): { x: number; y: number } {
  if (event.clientX === 0 && event.clientY === 0) return { x: rect.left, y: rect.bottom };
  return { x: event.clientX, y: event.clientY };
}
