import type { Article } from '../types';
import { matchesTerms } from './searchMatch';
import { isOlderEntry } from './entryId';

/**
 * Le corpus d'un balayage : les articles d'un périmètre et leur texte
 * cherchable, gardés quelques minutes pour qu'affiner une requête ne repaye pas
 * le réseau.
 * Spec : docs/superpowers/specs/2026-09-23-client-side-search-design.md
 */

export interface CorpusEntry {
  article: Article;
  /** `articleHaystack(article)`, calculé au balayage. */
  haystack: string;
}

export interface Corpus {
  /** Périmètre balayé — sortie de `resolveSearchStreamId`. */
  streamId: string;
  /** Serveur FreshRSS actif pendant le balayage. */
  serverId: string;
  entries: CorpusEntry[];
  /** Où reprendre ; `null` quand le flux est épuisé. */
  continuation: string | null;
  /** Le flux est allé jusqu'au bout. */
  complete: boolean;
  /** Dernière écriture, pour la péremption. */
  at: number;
}

export const CORPUS_TTL_MS = 5 * 60 * 1000;

export function createCorpus(streamId: string, serverId: string, now: number): Corpus {
  return { streamId, serverId, entries: [], continuation: null, complete: false, at: now };
}

/** Ajoute une page, en écartant les articles déjà vus (un flux bouge pendant le balayage). */
export function addPage(
  corpus: Corpus,
  entries: readonly CorpusEntry[],
  continuation: string | null,
  now: number,
): Corpus {
  const seen = new Set(corpus.entries.map((e) => e.article.id));
  const fresh = entries.filter((e) => !seen.has(e.article.id));
  return {
    ...corpus,
    entries: [...corpus.entries, ...fresh],
    continuation,
    complete: continuation === null,
    at: now,
  };
}

/**
 * Peut-on répondre sans toucher au réseau ?
 *
 * Un corpus INCOMPLET ne sert jamais : il ne prouve aucune absence, et une
 * recherche qui annonce « aucun résultat » sur un corpus partiel ment.
 */
export function corpusIsUsable(
  corpus: Corpus | null,
  streamId: string,
  serverId: string,
  now: number,
): boolean {
  if (!corpus) return false;
  if (corpus.streamId !== streamId) return false;
  if (corpus.serverId !== serverId) return false;
  if (!corpus.complete) return false;
  return now - corpus.at <= CORPUS_TTL_MS;
}

/** Les articles correspondants, dans l'ordre du flux (date décroissante). */
export function corpusMatches(corpus: Corpus, terms: readonly string[]): Article[] {
  return corpus.entries.filter((e) => matchesTerms(e.haystack, terms)).map((e) => e.article);
}

/**
 * Répercute une écriture locale (lu, favori, à lire plus tard) sur l'article
 * gardé. Sans ça, la recherche suivante ressortirait l'ancien état depuis la
 * mémoire : un article coché qui redevient non lu.
 */
export function patchCorpusArticle(corpus: Corpus, id: string, patch: Partial<Article>): Corpus {
  let touched = false;
  const entries = corpus.entries.map((e) => {
    if (e.article.id !== id) return e;
    touched = true;
    return { ...e, article: { ...e.article, ...patch } };
  });
  return touched ? { ...corpus, entries } : corpus;
}

/**
 * Répercute un marquage de plage (« tout lu en dessous / au-dessus ») sur le
 * corpus gardé. Contrairement à un « tout marquer comme lu », le critère est
 * connu exactement — un identifiant d'entrée — donc le corpus reste juste et
 * n'a pas à être jeté.
 *
 * Le critère est l'identifiant d'entrée de l'article pivot (`isOlderEntry`,
 * `src/lib/entryId.ts`), le même que celui envoyé au serveur — jamais la date
 * de publication : FreshRSS ne la compare jamais pour cette action, et un
 * corpus corrigé par date divergerait du serveur sur les flux datés au jour
 * ou les imports en masse, où plusieurs entrées partagent une même date.
 *
 * `exclude` retire de la plage des identifiants que le seul critère
 * d'ordre ne peut pas connaître — utilisé par le rollback de
 * `markReadRelative` (`src/stores/feedStore.ts`) pour épargner ce que le
 * serveur a déjà confirmé, et ce qui était déjà lu avant l'action.
 */
export function patchCorpusByEntry(
  corpus: Corpus,
  bound: { direction: 'above' | 'below'; articleId: string },
  patch: Partial<Article>,
  exclude?: (id: string) => boolean,
): Corpus {
  const touche = (id: string) => (bound.direction === 'below'
    ? isOlderEntry(id, bound.articleId)
    : isOlderEntry(bound.articleId, id));
  return {
    ...corpus,
    entries: corpus.entries.map((e) => (
      touche(e.article.id) && !exclude?.(e.article.id) ? { ...e, article: { ...e.article, ...patch } } : e
    )),
  };
}
