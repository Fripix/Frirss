import { isOlderEntry } from './entryId';
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

/** Une liste, et le moment où elle a été lue ou touchée pour la dernière fois. */
export interface StoredView extends ViewList {
  at: number;
}

const OLDEST = ':oldest';
const FILTERS: readonly string[] = ['all', 'unread', 'starred', 'readlater'] satisfies Filter[];
const ORDERS: readonly ArticleOrder[] = ['newest', 'oldest'];

/** `<portée>|<flux>:<filtre>`, plus `:oldest` pour l'ordre inverse. */
export function viewListKey({ scope, feedId, filter, order }: ViewAddress): string {
  return `${scope}|${feedId}:${filter}${order === 'oldest' ? OLDEST : ''}`;
}

/** Les huit listes d'un flux, ou de l'accueil (`feedId` vide) : quatre filtres, deux ordres. */
export function viewListKeys(scope: string, feedId: string): string[] {
  return FILTERS.flatMap((filter) => ORDERS.map((order) => viewListKey({ scope, feedId, filter: filter as Filter, order })));
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
 * Ce que la préparation hors ligne a rangé pour un flux. Sa clé à elle : aucune
 * visite ne l'écrit, un geste n'y change qu'un champ, et `parseViewKey` ne la
 * prend pas pour une vue. Sous la clé de la vue, une visite en ligne la ramenait
 * à 50 lignes, et une liste exacte périmée, un `[]` de la semaine passée, passait
 * devant elle.
 */
export function preparedListKey(scope: string, feedId: string): string {
  return `${scope}|${feedId}:prepared`;
}

/** Un passage de préparation : 8 pages de 50. */
export const PREPARED_MAX = 400;

/**
 * Les listes du même flux et de la même portée dont une vue peut se servir
 * quand la sienne manque hors ligne, dans l'ordre de préférence.
 *
 * « Non lus » se déduit de « Tous » ; l'inverse est impossible, et les vues
 * Favoris et À lire plus tard ne se déduisent que d'elles-mêmes, leur flux
 * n'étant pas celui de l'accueil.
 */
export function fallbackSources(view: ViewAddress): ViewAddress[] {
  const other: ArticleOrder = view.order === 'oldest' ? 'newest' : 'oldest';
  const reversed = { ...view, order: other };
  if (view.filter !== 'unread') return [reversed];
  return [{ ...view, filter: 'all' }, { ...view, filter: 'all', order: other }, reversed];
}

/**
 * Retourner suffit : une liste vient d'un seul serveur, dans un seul ordre, alors
 * que trier sur `published` ne redirait pas l'ordre d'insertion de FreshRSS.
 */
const inViewOrder = (rows: Article[], from: ArticleOrder, view: ViewAddress) =>
  (from === view.order ? rows : [...rows].reverse());

/**
 * Les lignes de `candidates` qui viennent APRÈS la dernière de `rows`. Celles
 * d'avant ne sont pas des oubliées : la liste les a vues, puis perdues (un ✓ sous
 * Non lus, une purge du serveur), et les rendre ressusciterait des articles lus.
 * Une liste vide n'a pas de fin : rien ne la prolonge. L'identifiant d'entrée est
 * l'ordre même de FreshRSS ; une ligne illisible n'est jamais rapportée.
 */
function rowsPast(rows: Article[], candidates: Article[], order: ArticleOrder): Article[] {
  const last = rows[rows.length - 1];
  if (!last) return [];
  const known = new Set(rows.map((a) => a.id));
  return candidates.filter((a) => !known.has(a.id)
    && (order === 'oldest' ? isOlderEntry(last.id, a.id) : isOlderEntry(a.id, last.id)));
}

export interface OfflineSources {
  /** La liste exacte de la vue. */
  own?: StoredView;
  /** La liste préparée du flux. */
  prepared?: StoredView;
  /** Sans liste exacte, la première de `fallbackSources` qui existe. */
  fallback?: { list: StoredView; source: ViewAddress };
}

export interface OfflineView extends ViewList {
  /**
   * Construite à partir d'autres listes. Elle ne se range JAMAIS sous la clé de la
   * vue : elle s'y figerait, tronquée, et la préparation suivante ne l'atteindrait
   * plus.
   */
  rebuilt: boolean;
}

interface OfflineOptions {
  /** Ce que la liste ne sait pas encore : écritures en file ou récentes. */
  overlay?: (rows: Article[]) => Article[];
  /** Une ligne lue qui reste sous Non lus : l'article ouvert. */
  stays?: (row: Article) => boolean;
}

/**
 * La liste qu'une vue sert hors ligne, et le seul endroit qui en décide :
 * `loadArticles` et la recherche hors ligne lisent la même chose.
 *
 * La préparation est la base quand elle est plus récente que la liste de la vue.
 * Sinon cette liste reste la base, avec ses lignes à jour, et la préparation la
 * prolonge en fin de liste. Seulement si elle a une page suivante : sans, elle dit
 * qu'il n'y a plus rien, à une date postérieure à la préparation. Une liste vidée
 * après elle reste vide, et pour la même raison une liste Non lus complète ne
 * récupère pas des lignes lues depuis.
 *
 * Une liste venue de l'autre ordre lui cède le pas quelle que soit sa date : elle
 * ne montre pas le même morceau du flux. Une préparation vide ne compte pas : un
 * flux calme, sans rien dans les 30 jours, n'efface pas ce qu'on a lu de lui.
 *
 * Le recalage passe avant le filtre : une ligne rendue non lue en file entre sous
 * Non lus, une ligne lue en file en sort.
 */
export function offlineViewList(
  view: ViewAddress,
  { own, prepared, fallback }: OfflineSources,
  { overlay = (rows) => rows, stays = () => false }: OfflineOptions = {},
): OfflineView | null {
  const usable = (view.filter === 'all' || view.filter === 'unread') && prepared?.articles.length ? prepared : undefined;
  const base = own ?? fallback?.list;
  if (!base && !usable) return null;

  const fromOrder = own ? view.order : fallback?.source.order;
  const preparedRows = usable ? inViewOrder(usable.articles, 'newest', view) : [];
  const preparedWins = !!usable && (!base || fromOrder !== view.order || base.at < usable.at);

  let rows = preparedRows;
  let continuation: string | null = null;
  let rebuilt = true;
  if (!preparedWins) {
    const baseRows = inViewOrder(base!.articles, fromOrder!, view);
    const tail = base!.continuation ? rowsPast(baseRows, preparedRows, view.order) : [];
    rows = tail.length ? [...baseRows, ...tail] : baseRows;
    rebuilt = !own || tail.length > 0;
    continuation = rebuilt ? null : base!.continuation;
  }
  const settled = overlay(rows);
  const articles = view.filter === 'unread' ? settled.filter((a) => !a.read || stays(a)) : settled;
  return { articles, continuation, rebuilt };
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
