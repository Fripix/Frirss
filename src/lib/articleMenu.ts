/**
 * Menu contextuel d'un article : ce qu'il contient, et où il s'ouvre.
 * Spec : docs/superpowers/specs/2026-09-13-article-context-menu-design.md
 */
export type ArticleMenuKind = 'openSource' | 'toggleRead' | 'toggleStar' | 'toggleReadLater' | 'copyLink';

export interface ArticleMenuItem {
  kind: ArticleMenuKind;
  /** Clé i18n du libellé ; elle suit l'état de l'article. */
  labelKey: string;
}

/**
 * Entrées du menu, dans l'ordre. Sans URL, « Ouvrir à la source » et « Copier le
 * lien » n'ont rien à ouvrir ni à copier : elles disparaissent.
 */
export function articleMenuItems(
  article: { url?: string; read: boolean; starred: boolean },
  isReadLater: boolean,
): ArticleMenuItem[] {
  const hasUrl = !!article.url?.trim();
  const items: ArticleMenuItem[] = [];
  if (hasUrl) items.push({ kind: 'openSource', labelKey: 'articleRow.openSource' });
  items.push({ kind: 'toggleRead', labelKey: article.read ? 'articleRow.markUnread' : 'articleRow.markRead' });
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
