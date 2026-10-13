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
  it('matches short abbreviations in the synonyms model', () => {
    const abbreviation = article('ai', 'AI regulation and research', 'New AI policy');
    const unrelated = article('other', 'Gardening tools', 'Pruning and soil care');
    const ranked = rankInterestingArticles(
      [unrelated, abbreviation],
      [feedback('Artificial intelligence', 'AI systems and research', 1)],
      Date.now(),
      'synonyms',
    );
    expect(ranked[0].id).toBe('ai');
  });

  it('normalizes inflected synonym forms before synonym lookup', () => {
    const inflected = article('defence', 'Defences and military readiness', 'Security planning');
    const unrelated = article('other', 'Gardening tools', 'Pruning and soil care');
    const ranked = rankInterestingArticles(
      [unrelated, inflected],
      [feedback('Defence readiness', 'Military security planning', 1)],
      Date.now(),
      'synonyms',
    );
    expect(ranked[0].id).toBe('defence');
  });

  it('handles duplicate and empty IDs in Combined mode without collapsing articles', () => {
    const first = article('duplicate', 'AI chip research', 'Artificial intelligence advances');
    const second = article('duplicate', 'Gardening tools', 'Pruning and soil care');
    const third = article('', 'Military defence analysis', 'Security research');
    const ranked = rankInterestingArticles(
      [first, second, third],
      [feedback('AI chip research', 'Artificial intelligence advances', 1)],
      Date.now(),
      'combined',
    );
    expect(ranked).toHaveLength(3);
    expect(new Set(ranked).size).toBe(3);
    expect(ranked).toContain(first);
    expect(ranked).toContain(second);
    expect(ranked).toContain(third);
  });

  it('diversifies repeated sources without banning them for the rest of the list', () => {
    const sameSource = [
      article('a', 'AI chip research', 'Artificial intelligence advances'),
      article('b', 'AI chip research', 'Artificial intelligence advances'),
      article('c', 'AI chip research', 'Artificial intelligence advances'),
      article('d', 'AI chip research', 'Artificial intelligence advances'),
    ];
    sameSource.forEach((item) => { item.sourceId = 'feed/a'; });
    const otherSource = article('other', 'AI chip research', 'Artificial intelligence advances');
    otherSource.sourceId = 'feed/b';
    const ranked = rankInterestingArticles(
      [...sameSource, otherSource],
      [feedback('AI chip research', 'Artificial intelligence advances', 1)],
      Date.now(),
      'combined',
    );
    expect(ranked[2].sourceId).toBe('feed/b');
    expect(ranked.slice(3).some((item) => item.sourceId === 'feed/a')).toBe(true);
  });

  it('ignores unexpected runtime vote values instead of treating them as dislikes', () => {
    const relevant = article('relevant', 'AI chip research', 'Artificial intelligence advances');
    const unrelated = article('other', 'Gardening tools', 'Pruning and soil care');
    const malformed = { ...feedback('AI chip research', 'Artificial intelligence advances', 1), vote: 0 } as unknown as ArticleFeedback;
    const withoutFeedback = rankInterestingArticles([unrelated, relevant], [], Date.now(), 'current');
    const withMalformedFeedback = rankInterestingArticles([unrelated, relevant], [malformed], Date.now(), 'current');
    expect(withMalformedFeedback.map((item) => item.id)).toEqual(withoutFeedback.map((item) => item.id));
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
