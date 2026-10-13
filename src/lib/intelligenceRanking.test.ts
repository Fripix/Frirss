import { describe, expect, it } from 'vitest';
import type { Article } from '../types';
import type { ArticleFeedback } from '../api/intelligence';
import { rankInterestingArticles } from './intelligenceRanking';

function article(id: string, title: string, summary: string, published = Date.now()): Article {
  return {
    id, title, summary, content: '', author: '', url: `https://example.test/${id}`,
    source: 'Example', sourceId: 'feed/1', published, read: false, starred: false, labels: [], tags: [],
  };
}

const feedback = (title: string, summary: string, vote: 1 | -1): ArticleFeedback => ({
  articleId: 'voted', url: '', title, summary, content: '', sourceId: 'feed/1', vote,
});

describe('rankInterestingArticles', () => {
  it('ranks content related to a positive vote above unrelated content', () => {
    const liked = article('liked', 'New chip design', 'Researchers improve AI accelerator efficiency');
    const unrelated = article('other', 'Gardening tips', 'How to grow tomatoes at home');
    const ranked = rankInterestingArticles([unrelated, liked], [feedback('AI accelerator', 'chip design efficiency', 1)]);
    expect(ranked[0].id).toBe('liked');
  });

  it('pushes content related to a negative vote down', () => {
    const disliked = article('disliked', 'Celebrity gossip', 'Latest celebrity relationship rumours');
    const other = article('other', 'A quiet walk', 'Walking routes through a forest');
    const ranked = rankInterestingArticles([disliked, other], [feedback('Celebrity gossip', 'relationship rumours', -1)]);
    expect(ranked[0].id).toBe('other');
  });

  it('does not mutate the original article array', () => {
    const items = [article('a', 'A', 'First'), article('b', 'B', 'Second')];
    rankInterestingArticles(items, []);
    expect(items.map((item) => item.id)).toEqual(['a', 'b']);
  });
});

it('supports all experimental algorithms without mutating input', () => {
  const articles = [
    article('a', 'NATO defence procurement', 'Military production expands'),
    article('b', 'AI chip design', 'Researchers improve machine learning'),
    article('c', 'Celebrity gossip', 'Relationship rumours spread'),
  ];
  for (const algorithm of ['current', 'weighted-idf', 'synonyms', 'topics', 'combined'] as const) {
    const ranked = rankInterestingArticles(articles, [feedback('defense production', 'military procurement', 1)], Date.now(), algorithm);
    expect(ranked).toHaveLength(3);
    expect(new Set(ranked.map((item) => item.id)).size).toBe(3);
  }
  expect(articles.map((item) => item.id)).toEqual(['a', 'b', 'c']);
});
