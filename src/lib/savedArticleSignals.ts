/**
 * Compact snapshot of the reader's starred and read-later articles, used by
 * Intelligence Next as a weak positive signal. Built from the lists the store
 * already fetches for the sidebar counts, so it costs no extra request.
 */
import type { Article } from '../types';
import type { SavedArticleSignal } from './intelligenceNext';

/** Intelligence Next reads at most this much of a body; keeping more only costs memory. */
const MAX_CONTENT_CHARS = 20_000;

/** One entry per article; an article in both lists is both starred and read-later. */
export function buildSavedArticleSignals(starred: Article[], readLater: Article[]): SavedArticleSignal[] {
  const byId = new Map<string, SavedArticleSignal>();
  const add = (article: Article, flags: { starred: boolean; readLater: boolean }) => {
    if (!article?.id) return;
    const existing = byId.get(article.id);
    if (existing) {
      existing.starred ||= flags.starred;
      existing.readLater ||= flags.readLater;
      return;
    }
    byId.set(article.id, {
      id: article.id,
      title: article.title,
      summary: article.summary,
      content: typeof article.content === 'string' ? article.content.slice(0, MAX_CONTENT_CHARS) : '',
      sourceId: article.sourceId,
      ...flags,
    });
  };
  for (const article of starred) add(article, { starred: true, readLater: false });
  for (const article of readLater) add(article, { starred: !!article.starred, readLater: true });
  return [...byId.values()];
}

/**
 * Same articles, flags and text as before? The store keeps the previous array
 * then, so a sync poll that changed nothing does not re-rank the Interesting list.
 */
export function sameSavedArticleSignals(a: SavedArticleSignal[], b: SavedArticleSignal[]): boolean {
  return a.length === b.length && a.every((item, index) => {
    const other = b[index];
    return item.id === other.id && item.starred === other.starred && item.readLater === other.readLater
      && item.title === other.title && item.summary === other.summary && item.content === other.content;
  });
}
