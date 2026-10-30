import type { ArticleOrder } from './effectiveOrder';
import type { Article, Filter } from '../types';

/**
 * Ce qui se décide sur les listes d'une vue, en mémoire et hors ligne : leur
 * clé, celle dont une vue se sert quand la sienne manque, et ce qu'une écriture
 * de masse y change.
 */

/** Une liste rangée : le compte et le serveur, le flux, le filtre et l'ordre. */
export interface ViewAddress {
  scope: string;
  /** Vide pour l'accueil. */
  feedId: string;
  filter: Filter;
  order: ArticleOrder;
}

export interface ViewList {
  articles: Article[];
  continuation: string | null;
}

const OLDEST = ':oldest';
const FILTERS: readonly string[] = ['all', 'unread', 'starred', 'readlater'] satisfies Filter[];

/** `<portée>|<flux>:<filtre>`, plus `:oldest` pour l'ordre inverse. */
export function viewListKey({ scope, feedId, filter, order }: ViewAddress): string {
  return `${scope}|${feedId}:${filter}${order === 'oldest' ? OLDEST : ''}`;
}

/**
 * La lecture inverse. Depuis la fin : le nom d'une étiquette peut contenir `:`
 * ou `|`, une portée jamais. `null` pour ce qui n'est pas une clé de vue.
 */
export function parseViewKey(key: string): ViewAddress | null {
  const bar = key.indexOf('|');
  if (bar < 0) return null;
  const scope = key.slice(0, bar);
  let rest = key.slice(bar + 1);
  const order: ArticleOrder = rest.endsWith(OLDEST) ? 'oldest' : 'newest';
  if (order === 'oldest') rest = rest.slice(0, -OLDEST.length);
  const colon = rest.lastIndexOf(':');
  if (colon < 0) return null;
  const filter = rest.slice(colon + 1);
  if (!FILTERS.includes(filter)) return null;
  return { scope, feedId: rest.slice(0, colon), filter: filter as Filter, order };
}

/**
 * Les listes du même flux et de la même portée dont une vue peut se servir
 * quand la sienne manque hors ligne.
 *
 * La préparation hors ligne ne range que la liste « Tous » dans l'ordre par
 * défaut : sans ce repli, un flux préparé ne s'ouvrait pas sous le filtre Non
 * lus ni en ordre inverse. « Non lus » se déduit de « Tous » ; l'inverse est
 * impossible, et les vues Favoris et À lire plus tard ne se déduisent que
 * d'elles-mêmes, leur flux n'étant pas celui de l'accueil.
 */
export function fallbackSources(view: ViewAddress): ViewAddress[] {
  const other: ArticleOrder = view.order === 'oldest' ? 'newest' : 'oldest';
  const reversed = { ...view, order: other };
  if (view.filter !== 'unread') return [reversed];
  return [{ ...view, filter: 'all' }, { ...view, filter: 'all', order: other }, reversed];
}

/**
 * La vue déduite d'une liste source : filtrée, puis retournée si la source est
 * dans l'autre ordre. Retourner suffit : une liste vient d'un seul serveur, dans
 * un seul ordre, alors que trier sur `published` ne redirait pas l'ordre
 * d'insertion que FreshRSS emploie.
 *
 * Jamais de page suivante : la continuation appartient à la source et ne dit
 * rien de la suite d'une liste filtrée, ou lue depuis l'autre bout.
 */
export function deriveFromSource(list: ViewList, source: ViewAddress, view: ViewAddress): ViewList {
  const kept = view.filter === 'unread' && source.filter !== 'unread'
    ? list.articles.filter((a) => !a.read)
    : list.articles;
  return { articles: source.order === view.order ? kept : [...kept].reverse(), continuation: null };
}

/**
 * Ce que la préparation hors ligne range pour un flux, vu ce qui l'est déjà.
 *
 * Une liste rangée plus longue (`loadMore`, une préparation plus ancienne) garde
 * sa fin et sa page suivante : la préparation s'arrête aux 30 derniers jours, ce
 * qui se trouve au-delà n'a aucune raison de disparaître. Le haut vient de la
 * préparation, plus récente.
 */
export function mergePreparedList(prepared: Article[], stored: ViewList | undefined): ViewList {
  if (!stored || stored.articles.length <= prepared.length) return { articles: prepared, continuation: null };
  const ids = new Set(prepared.map((a) => a.id));
  return {
    articles: [...prepared, ...stored.articles.filter((a) => !ids.has(a.id))],
    continuation: stored.continuation,
  };
}

/** Ce qu'un « Tout lu » touche dans une liste. */
export interface StreamMark {
  /** La liste EST le flux marqué : tout y est lu, quelle qu'en soit la source. */
  whole: boolean;
  /** Sinon : les flux marqués. */
  sourceIds: ReadonlySet<string>;
  /** Liste « Non lus » : les lignes marquées en sortent. */
  drop: boolean;
}

/** Rend la MÊME liste quand rien ne change : l'appelant n'écrit alors rien. */
export function markStreamRead(articles: Article[], { whole, sourceIds, drop }: StreamMark): Article[] {
  const marked = (a: Article) => whole || sourceIds.has(a.sourceId);
  if (drop) {
    const kept = articles.filter((a) => !marked(a));
    return kept.length === articles.length ? articles : kept;
  }
  if (!articles.some((a) => marked(a) && !a.read)) return articles;
  return articles.map((a) => (marked(a) && !a.read ? { ...a, read: true } : a));
}
