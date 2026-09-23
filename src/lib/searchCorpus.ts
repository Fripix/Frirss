import type { Article } from '../types';
import { matchesTerms } from './searchMatch';

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
