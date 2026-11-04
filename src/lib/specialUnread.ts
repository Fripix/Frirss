import type { Article } from '../types';
import { READ_LATER_LABEL } from './viewLists';

/**
 * Non-lus des Favoris et d'« À lire plus tard », affichés dans la sidebar
 * quand le réglage est activé (issue #29 : la demande portait sur les
 * étiquettes, le propriétaire a choisi d'y répondre pour ces deux listes).
 *
 * Le relevé serveur (`stream/items/ids` avec `xt=…/read`) fixe la valeur ; ces
 * deux fonctions la tiennent juste entre deux relevés, à chaque geste qui
 * touche UN article. Les marquages en masse (« tout lu », plages) ne
 * savent pas quels favoris ils ont touchés : ils relancent le relevé une fois
 * confirmés par le serveur.
 *
 * Rien ne bouge → le MÊME objet est rendu, pour ne pas réveiller la sidebar.
 */
export interface SpecialUnread {
  starred: number;
  readLater: number;
}

const inReadLater = (a: Pick<Article, 'labels'>) => !!a.labels?.includes(READ_LATER_LABEL);

/** `delta` : -1 quand l'article devient lu, +1 quand il redevient non lu. */
export function afterReadChange(
  counts: SpecialUnread,
  article: Pick<Article, 'starred' | 'labels'>,
  delta: 1 | -1,
): SpecialUnread {
  const starred = !!article.starred;
  const readLater = inReadLater(article);
  if (!starred && !readLater) return counts;
  return {
    starred: starred ? Math.max(0, counts.starred + delta) : counts.starred,
    readLater: readLater ? Math.max(0, counts.readLater + delta) : counts.readLater,
  };
}

/** Un article entre dans la liste (`joining`) ou en sort : seul un non-lu compte. */
export function afterMembershipChange(
  counts: SpecialUnread,
  article: Pick<Article, 'read'>,
  list: keyof SpecialUnread,
  joining: boolean,
): SpecialUnread {
  if (article.read) return counts;
  return { ...counts, [list]: Math.max(0, counts[list] + (joining ? 1 : -1)) };
}

/**
 * Ce que la ligne Favoris / À lire plus tard de la sidebar reçoit : `count`
 * (non-lus, pastille des flux) et `badge` (total, pastille colorée
 * d'origine). Deux réglages indépendants, décision du propriétaire.
 */
export function specialRowCounts(
  total: number,
  unread: number,
  prefs: { showTotals: boolean; showUnread: boolean },
): { count: number | undefined; badge: number | undefined } {
  return {
    count: prefs.showUnread ? unread : undefined,
    badge: prefs.showTotals ? total : undefined,
  };
}
