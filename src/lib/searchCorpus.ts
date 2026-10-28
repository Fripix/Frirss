import type { Article } from '../types';
import { matchesTerms } from './searchMatch';
import { entryIdUsec, isOlderEntry } from './entryId';

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
  /**
   * Index des identifiants de `entries`, tenu au fil des pages : il était
   * reconstruit en entier à chaque tranche (9 000 insertions à la dixième
   * pour en écarter quelques-unes). Partagé entre les versions successives
   * du corpus et ne fait que grandir ; `addPage` le reconstruit s'il ne
   * correspond plus à `entries` (une version antérieure étendue après coup).
   */
  ids: Set<string>;
}

export const CORPUS_TTL_MS = 5 * 60 * 1000;

export function createCorpus(streamId: string, serverId: string, now: number): Corpus {
  return { streamId, serverId, entries: [], continuation: null, complete: false, at: now, ids: new Set() };
}

/** L'index à jour pour `corpus` : le sien, sauf s'il a été étendu par une autre version. */
function idsOf(corpus: Corpus): Set<string> {
  if (corpus.ids.size === corpus.entries.length) return corpus.ids;
  return new Set(corpus.entries.map((e) => e.article.id));
}

/** Les entrées encore inconnues de `ids`, qu'elles y entrent au passage. */
function admit(ids: Set<string>, entries: readonly CorpusEntry[]): CorpusEntry[] {
  const fresh: CorpusEntry[] = [];
  for (const e of entries) {
    if (ids.has(e.article.id)) continue;
    ids.add(e.article.id);
    fresh.push(e);
  }
  return fresh;
}

/** Ajoute une page, en écartant les articles déjà vus (un flux bouge pendant le balayage). */
export function addPage(
  corpus: Corpus,
  entries: readonly CorpusEntry[],
  continuation: string | null,
  now: number,
): Corpus {
  const ids = idsOf(corpus);
  const fresh = admit(ids, entries);
  return {
    ...corpus,
    entries: fresh.length ? [...corpus.entries, ...fresh] : corpus.entries,
    continuation,
    complete: continuation === null,
    at: now,
    ids,
  };
}

/**
 * Le haut d'une page lue depuis le début du flux qui est plus récent que tout
 * ce que le corpus contient — Rafraîchir pendant une recherche, sans
 * rebalayer.
 *
 * On s'arrête au premier article déjà connu, ou au premier dont
 * l'identifiant d'entrée n'est pas plus récent que le plus récent du corpus :
 * un article retiré du flux depuis le balayage ne doit pas faire prendre tout
 * le reste pour du neuf. `reachedKnown` faux : toute la page est neuve, il
 * faut lire la suivante.
 */
export function newerEntries(
  corpus: Corpus,
  page: readonly CorpusEntry[],
): { fresh: CorpusEntry[]; reachedKnown: boolean } {
  const ids = idsOf(corpus);
  const newest = corpus.entries.length ? entryIdUsec(corpus.entries[0].article.id) : null;
  const notNewer = (id: string) => {
    if (newest === null) return false;
    const usec = entryIdUsec(id);
    return usec !== null && BigInt(usec) <= BigInt(newest);
  };
  const fresh: CorpusEntry[] = [];
  for (const e of page) {
    if (ids.has(e.article.id) || notNewer(e.article.id)) return { fresh, reachedKnown: true };
    fresh.push(e);
  }
  return { fresh, reachedKnown: false };
}

/**
 * Place en tête des entrées plus récentes (`newerEntries`), doublons écartés.
 *
 * `at` ne bouge pas : seul le haut a été relu, le reste a l'âge du balayage,
 * et rajeunir le corpus prolongerait la vie d'états de lecture que rien n'a
 * revérifiés.
 */
export function prependEntries(corpus: Corpus, entries: readonly CorpusEntry[]): Corpus {
  const ids = idsOf(corpus);
  const fresh = admit(ids, entries);
  if (!fresh.length) return corpus.ids === ids ? corpus : { ...corpus, ids };
  return { ...corpus, entries: [...fresh, ...corpus.entries], ids };
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

/**
 * Les correspondances d'une seule tranche. Le balayage les accumule page par
 * page au lieu de refiltrer tout le corpus à chaque tranche.
 */
export function matchPage(page: readonly CorpusEntry[], terms: readonly string[]): Article[] {
  return page.filter((e) => matchesTerms(e.haystack, terms)).map((e) => e.article);
}

/** Les articles correspondants, dans l'ordre du flux (date décroissante). */
export function corpusMatches(corpus: Corpus, terms: readonly string[]): Article[] {
  return matchPage(corpus.entries, terms);
}

/**
 * Un patch d'article : des valeurs fixes, ou calculées sur l'article COURANT —
 * ce que demande un rollback d'étiquette, qui ne doit retirer que la sienne et
 * non restaurer un instantané d'avant le clic (il emporterait une étiquette
 * posée entre-temps).
 */
export type ArticlePatch = Partial<Article> | ((article: Article) => Partial<Article>);

/** Applique un `ArticlePatch` à un article. */
export function applyArticlePatch(article: Article, patch: ArticlePatch): Article {
  return { ...article, ...(typeof patch === 'function' ? patch(article) : patch) };
}

/** Les étiquettes avec `labelId` posée (`on`) ou retirée, sans doublon ni effet sur les autres. */
export function withLabel(labels: readonly string[] | undefined, labelId: string, on: boolean): string[] {
  const others = (labels ?? []).filter((l) => l !== labelId);
  return on ? [...others, labelId] : others;
}

/**
 * Répercute une écriture locale (lu, favori, à lire plus tard, étiquette) sur
 * l'article gardé. Sans ça, la recherche suivante ressortirait l'ancien état
 * depuis la mémoire : un article coché qui redevient non lu.
 */
export function patchCorpusArticle(corpus: Corpus, id: string, patch: ArticlePatch): Corpus {
  let touched = false;
  const entries = corpus.entries.map((e) => {
    if (e.article.id !== id) return e;
    touched = true;
    return { ...e, article: applyArticlePatch(e.article, patch) };
  });
  return touched ? { ...corpus, entries } : corpus;
}

/** `id` tombe-t-il dans la plage d'un marquage « en dessous / au-dessus » ? Le pivot n'y est jamais. */
export function inEntryRange(bound: { direction: 'above' | 'below'; articleId: string }, id: string): boolean {
  return bound.direction === 'below'
    ? isOlderEntry(id, bound.articleId)
    : isOlderEntry(bound.articleId, id);
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
  const touche = (id: string) => inEntryRange(bound, id);
  return {
    ...corpus,
    entries: corpus.entries.map((e) => (
      touche(e.article.id) && !exclude?.(e.article.id) ? { ...e, article: { ...e.article, ...patch } } : e
    )),
  };
}
