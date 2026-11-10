import type { Article } from '../types';

/**
 * Non-lus des étiquettes dans la barre latérale (issue #29, suite : la
 * demande portait sur les étiquettes, la 1.9.0 n'avait répondu que pour
 * Favoris et « À lire plus tard »).
 *
 * La seule source est `unread-count`, que FriRSS lit déjà chaque minute :
 * FreshRSS y liste chaque étiquette avec ses non-lus depuis la 1.26
 * (`listTags(precounts: true)` dans `p/api/greader.php`), zéro compris. Un
 * serveur plus ancien ne les rend pas : rien n'est affiché et Préférences ›
 * Étiquettes demande une mise à jour (décision du propriétaire, 2026-11-11 :
 * un relevé de repli par identifiants avait été écrit, puis retiré — une clé
 * créée par un geste local le trompait).
 */
type Counts = Record<string, number>;

/**
 * Le serveur fournit-il les non-lus des étiquettes ? Jugé sur les identifiants
 * de la DERNIÈRE réponse `unread-count` (jamais sur `unreadCounts`, où un ✓
 * local crée aussi des clés) : vrai dès qu'une étiquette y figure, faux si des
 * étiquettes existent et qu'aucune n'y est, `null` tant qu'aucune étiquette
 * n'est connue.
 */
export function labelUnreadFromServer(serverIds: ReadonlySet<string>, labels: readonly { id: string }[]): boolean | null {
  if (!labels.length) return null;
  return labels.some((l) => serverIds.has(l.id));
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
