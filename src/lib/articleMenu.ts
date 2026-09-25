/**
 * Menu contextuel d'un article : ce qu'il contient, et où il s'ouvre.
 * Spec : docs/superpowers/specs/2026-09-13-article-context-menu-design.md
 */
export type ArticleMenuKind =
  | 'openSource' | 'toggleRead' | 'markBelowRead' | 'markAboveRead'
  | 'toggleStar' | 'toggleReadLater' | 'copyLink';

/** Bloc visuel de l'entrée (retouche : un filet sépare deux groupes différents). */
export type ArticleMenuGroup = 1 | 2 | 3;

export interface ArticleMenuItem {
  kind: ArticleMenuKind;
  /** Clé i18n du libellé ; elle suit l'état de l'article. */
  labelKey: string;
  /**
   * Groupe visuel : 1 = ouvrir à la source ; 2 = marquer lu et ses deux
   * marquages de plage ; 3 = favoris, à lire plus tard, copier le lien. Un
   * filet sépare deux entrées consécutives de groupes différents
   * (`ArticleContextMenu.tsx`) — porté par l'entrée plutôt que déduit de sa
   * position, pour qu'une entrée qui disparaît (pas d'URL, pas de plage) ne
   * fasse pas glisser le filet sur la mauvaise frontière.
   */
  group: ArticleMenuGroup;
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
  if (hasUrl) items.push({ kind: 'openSource', labelKey: 'articleRow.openSource', group: 1 });
  items.push({
    kind: 'toggleRead',
    labelKey: article.read ? 'articleRow.markUnread' : 'articleRow.markRead',
    group: 2,
  });
  // Marquages de plage (issue #15) : placés contre « Marquer lu », dont ils
  // sont l'extension — même groupe visuel.
  if (canMarkRange) {
    items.push({ kind: 'markAboveRead', labelKey: 'articleRow.markAboveRead', group: 2 });
    items.push({ kind: 'markBelowRead', labelKey: 'articleRow.markBelowRead', group: 2 });
  }
  items.push({
    kind: 'toggleStar',
    labelKey: article.starred ? 'articleRow.removeStar' : 'articleRow.addStar',
    group: 3,
  });
  items.push({
    kind: 'toggleReadLater',
    labelKey: isReadLater ? 'articleRow.removeReadLater' : 'articleRow.addReadLater',
    group: 3,
  });
  if (hasUrl) items.push({ kind: 'copyLink', labelKey: 'articleRow.copyLink', group: 3 });
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
