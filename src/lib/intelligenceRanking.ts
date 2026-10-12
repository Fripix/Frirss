import type { Article } from '../types';
import type { ArticleFeedback } from '../api/intelligence';

function tokenize(text: string): Set<string> {
  return new Set(text.toLocaleLowerCase().replace(/<[^>]*>/g, ' ').match(/[\p{L}\p{N}]{3,}/gu) ?? []);
}

/**
 * Lightweight cold-start ranker. Feedback is compared with article text
 * (title, RSS summary and available content), not just title keywords.
 * This is deliberately deterministic and local; a semantic embedding model
 * can replace this feature representation without changing feedback storage.
 */
export function rankInterestingArticles(
  articles: Article[],
  feedback: ArticleFeedback[],
  now = Date.now(),
): Article[] {
  const examples = feedback.map((item) => ({
    vote: item.vote,
    terms: tokenize(`${item.title} ${item.summary} ${item.content} ${item.sourceId}`),
  }));
  const score = (article: Article) => {
    const terms = tokenize(`${article.title} ${article.summary} ${article.content} ${article.source}`);
    let positive = 0;
    let negative = 0;
    for (const example of examples) {
      let shared = 0;
      for (const term of example.terms) if (terms.has(term)) shared++;
      const similarity = shared / Math.max(1, Math.sqrt(terms.size * example.terms.size));
      if (example.vote === 1) positive += similarity;
      else negative += similarity;
    }
    const ageHours = Math.max(0, (now - article.published) / 3600000);
    return positive - negative * 1.25 + (1 / (1 + ageHours / 72)) * 0.03;
  };
  return [...articles].sort((a, b) => score(b) - score(a));
}
