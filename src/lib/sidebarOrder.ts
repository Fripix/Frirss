import type { Subscription } from '../types';

/** Une catégorie de la barre latérale, avec ses flux dans l'ordre affiché. */
export interface SidebarCategory {
  id: string;
  label: string;
  feeds: Subscription[];
}

/** La catégorie synthétique des flux sans catégorie : pas un flux FreshRSS. */
export const UNCATEGORIZED = 'uncategorized';

/**
 * Les catégories et leurs flux dans l'ordre de la barre latérale : l'ordre
 * personnel (`categoryOrder`, `feedOrder`), sinon l'alphabet. Une seule
 * source : la barre latérale l'affiche, « flux suivant avec non-lus »
 * (issue #35) la parcourt. Deux copies divergeraient, et le saut tomberait
 * ailleurs que sur la ligne visible juste en dessous.
 */
export function orderSidebarCategories(
  subscriptions: Subscription[],
  categoryOrder: string[],
  feedOrder: Record<string, string[]>,
  uncategorizedLabel: string,
): SidebarCategory[] {
  const map: Record<string, SidebarCategory> = {};
  subscriptions.forEach((sub) => {
    const catId = sub.categories?.[0]?.id || UNCATEGORIZED;
    const catLabel = sub.categories?.[0]?.label || uncategorizedLabel;
    if (!map[catId]) map[catId] = { id: catId, label: catLabel, feeds: [] };
    map[catId].feeds.push(sub);
  });

  const cats = Object.values(map);
  if (categoryOrder.length > 0) {
    cats.sort((a, b) => {
      const ai = categoryOrder.indexOf(a.id);
      const bi = categoryOrder.indexOf(b.id);
      if (ai === -1 && bi === -1) return a.label.localeCompare(b.label);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  } else {
    cats.sort((a, b) => a.label.localeCompare(b.label));
  }

  cats.forEach((cat) => {
    const order = feedOrder[cat.id];
    if (order && order.length > 0) {
      cat.feeds.sort((a, b) => {
        const ai = order.indexOf(a.id);
        const bi = order.indexOf(b.id);
        if (ai === -1 && bi === -1) return a.title.localeCompare(b.title);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
    }
  });

  return cats;
}

export type NextUnread =
  | { kind: 'feed'; feed: Subscription }
  | { kind: 'category'; category: SidebarCategory }
  | { kind: 'none' };

/**
 * La vue suivante qui a encore des non-lus (issue #35), dans l'ordre de la
 * barre latérale, en repartant du haut une fois arrivé en bas :
 * - depuis un flux : le flux suivant qui a des non-lus ;
 * - depuis une catégorie : la catégorie suivante qui en a (la somme de ses
 *   flux, comme son badge) ;
 * - d'ailleurs (accueil, étiquette, rien) : le premier flux qui en a.
 * La vue de départ n'est jamais rendue : on vient de la vider, et son
 * compteur peut encore dater d'avant. `none` : plus rien de non lu.
 */
export function nextUnreadView(
  currentId: string | null | undefined,
  categories: SidebarCategory[],
  unreadCounts: Record<string, number>,
): NextUnread {
  const count = (id: string) => unreadCounts[id] || 0;
  const rotate = <T>(items: T[], index: number): T[] =>
    index < 0 ? items : [...items.slice(index + 1), ...items.slice(0, index)];

  // La catégorie des flux sans catégorie n'est pas un flux FreshRSS : on ne
  // saute pas dessus comme sur une catégorie.
  const realCategories = categories.filter((c) => c.id !== UNCATEGORIZED);
  const catIndex = currentId ? realCategories.findIndex((c) => c.id === currentId) : -1;
  if (catIndex >= 0) {
    const next = rotate(realCategories, catIndex)
      .find((c) => c.feeds.reduce((sum, f) => sum + count(f.id), 0) > 0);
    return next ? { kind: 'category', category: next } : { kind: 'none' };
  }

  const feeds = categories.flatMap((c) => c.feeds);
  const feedIndex = currentId ? feeds.findIndex((f) => f.id === currentId) : -1;
  const next = rotate(feeds, feedIndex).find((f) => f.id !== currentId && count(f.id) > 0);
  return next ? { kind: 'feed', feed: next } : { kind: 'none' };
}
