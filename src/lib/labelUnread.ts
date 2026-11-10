import type { Article } from '../types';

/**
 * Non-lus des étiquettes dans la barre latérale (issue #29, suite : la
 * demande portait sur les étiquettes, la 1.9.0 n'avait répondu que pour
 * Favoris et « À lire plus tard »).
 *
 * La source est `unread-count`, que FriRSS lit déjà chaque minute : FreshRSS
 * y liste chaque étiquette avec ses non-lus depuis la 1.26. Un serveur plus
 * ancien ne les rend pas — ses étiquettes sont alors relevées par
 * identifiants (`stream/items/ids` avec `xt`), au démarrage et quand une
 * étiquette apparaît, et la valeur connue est gardée entre deux relevés
 * (`keepLabelUnread`), là où `unreadCounts` est sinon remplacé en bloc par la
 * réponse du serveur.
 */
type Counts = Record<string, number>;

/** Les entrées d'étiquettes absentes de la réponse serveur gardent leur valeur connue. */
export function keepLabelUnread(next: Counts, prev: Counts, labels: readonly { id: string }[]): Counts {
  for (const l of labels) {
    if (!(l.id in next) && l.id in prev) next[l.id] = prev[l.id];
  }
  return next;
}

/** Les étiquettes dont aucun compte n'est connu : à relever par identifiants. */
export function missingLabelUnread<T extends { id: string }>(counts: Counts, labels: readonly T[]): T[] {
  return labels.filter((l) => !(l.id in counts));
}

/** Un article entre dans l'étiquette (`joining`) ou en sort : seul un non-lu compte. */
export function afterLabelMembershipChange(
  counts: Counts,
  article: Pick<Article, 'read'>,
  labelId: string,
  joining: boolean,
): Counts {
  if (article.read) return counts;
  return { ...counts, [labelId]: Math.max(0, (counts[labelId] ?? 0) + (joining ? 1 : -1)) };
}
