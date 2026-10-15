import { describe, expect, it } from 'vitest';
import type { Article } from '../types';
import type { ArticleFeedback } from '../api/intelligence';
import { DEFAULT_INTERESTING_ALGORITHM, INTERESTING_ALGORITHMS, isInterestingAlgorithm, rankInterestingArticles } from './intelligenceRanking';

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
  for (const algorithm of ['current', 'weighted-idf', 'synonyms', 'topics', 'combined', 'microsoft-news', 'personal-news'] as const) {
    const ranked = rankInterestingArticles(articles, [feedback('defense production', 'military procurement', 1)], Date.now(), algorithm);
    expect(ranked).toHaveLength(3);
    expect(new Set(ranked.map((item) => item.id)).size).toBe(3);
  }
  expect(articles.map((item) => item.id)).toEqual(['a', 'b', 'c']);
});

it('supports the Microsoft NewsRec-inspired attention ranker', () => {
  const defence = article('defence', 'NATO defence procurement expands', 'Military production and European security planning');
  const unrelated = article('other', 'Celebrity gossip and dating rumours', 'Entertainment news about actors');
  const relevantButDifferentWords = article('security', 'European alliance increases readiness', 'Armed forces prepare new procurement plans');
  const ranked = rankInterestingArticles(
    [unrelated, relevantButDifferentWords, defence],
    [
      feedback('NATO defence procurement', 'Military security and readiness', 1),
      feedback('Celebrity gossip', 'Dating rumours about actors', -1),
    ],
    Date.now(),
    'microsoft-news',
  );
  expect(ranked[0].id).toBe('defence');
  expect(ranked[ranked.length - 1].id).toBe('other');
});

it('keeps all candidates in Microsoft NewsRec-inspired mode with empty feedback', () => {
  const items = [article('a', 'AI research', 'New chips'), article('b', 'Garden design', 'Plants and soil')];
  const ranked = rankInterestingArticles(items, [], Date.now(), 'microsoft-news');
  expect(ranked).toHaveLength(2);
  expect(new Set(ranked).size).toBe(2);
});


it('supports Personal News by learning preferences and retaining diverse candidates', () => {
  const liked = article('liked', 'European defence procurement', 'NATO military readiness and security policy');
  const related = article('related', 'Military readiness in Europe', 'Defence procurement and alliance planning');
  const disliked = article('disliked', 'Celebrity gossip', 'Actors dating rumours and entertainment news');
  const independent = article('independent', 'AI chip research', 'Researchers improve machine learning');
  independent.sourceId = 'feed/2';
  const ranked = rankInterestingArticles(
    [disliked, related, independent, liked],
    [
      feedback('European defence procurement', 'NATO military readiness and security policy', 1),
      feedback('Celebrity gossip', 'Actors dating rumours and entertainment news', -1),
    ],
    Date.now(),
    'personal-news',
  );
  expect(ranked).toHaveLength(4);
  expect(ranked[0].id).toBe('liked');
  expect(ranked.findIndex((item) => item.id === 'disliked')).toBeGreaterThan(0);
});

it('keeps all candidates in Personal News mode with empty feedback', () => {
  const items = [article('a', 'AI research', 'New chips'), article('b', 'Garden design', 'Plants and soil')];
  const ranked = rankInterestingArticles(items, [], Date.now(), 'personal-news');
  expect(ranked).toHaveLength(2);
  expect(new Set(ranked).size).toBe(2);
});

describe('correctness fixes for the existing term models', () => {
  const ids = (ranked: Article[]) => ranked.map((item) => item.id);
  const at = (ranked: Article[], id: string) => ranked.findIndex((item) => item.id === id);
  const sameTime = Date.UTC(2026, 9, 1, 12);
  const now = sameTime + 3600000;

  // "quokka" is rare among the candidates, "harbor"/"ferry" are common, so
  // with candidate IDF the rare shared term outweighs the two common ones.
  const idfCorpus = () => [
    article('rare', 'Quokka violin cello', '', sameTime),
    article('common', 'Harbor ferry tulip', '', sameTime),
    ...['lemon', 'mango', 'peach', 'grape', 'melon', 'olive'].map((word) =>
      article(`filler-${word}`, `Harbor ferry ${word}`, '', sameTime)),
  ];
  const idfUpvote = feedback('Quokka harbor ferry', '', 1);
  const unrelatedDownvotes = Array.from({ length: 30 }, () => feedback('Zeppelin airship', '', -1));

  for (const algorithm of ['weighted-idf', 'synonyms', 'microsoft-news', 'personal-news'] as const) {
    it(`${algorithm}: computes IDF from candidates only, so votes on absent topics do not reorder candidates`, () => {
      const plain = rankInterestingArticles(idfCorpus(), [idfUpvote], now, algorithm);
      const withUnrelatedHistory = rankInterestingArticles(idfCorpus(), [idfUpvote, ...unrelatedDownvotes], now, algorithm);
      expect(ids(withUnrelatedHistory)).toEqual(ids(plain));
      expect(at(withUnrelatedHistory, 'rare')).toBeLessThan(at(withUnrelatedHistory, 'common'));
    });
  }

  it('synonyms mode applies IDF like weighted-idf when no synonym or stem applies', () => {
    const weighted = rankInterestingArticles(idfCorpus(), [idfUpvote], now, 'weighted-idf');
    const synonyms = rankInterestingArticles(idfCorpus(), [idfUpvote], now, 'synonyms');
    expect(ids(synonyms)).toEqual(ids(weighted));
    expect(synonyms[0].id).toBe('rare');
  });

  // 30 upvotes, 3 of which mention crypto; both downvotes are about crypto.
  // A raw signed sum gives "crypto" +1 (looks liked); averaging each polarity
  // separately shows it is in 10% of upvotes but 100% of downvotes.
  const heavyUpvoterHistory = [
    ...Array.from({ length: 3 }, () => feedback('Crypto custody rules', '', 1)),
    ...Array.from({ length: 27 }, () => feedback('Linux kernel scheduler', '', 1)),
    ...Array.from({ length: 2 }, () => feedback('Crypto scam warning', '', -1)),
  ];

  for (const algorithm of ['weighted-idf', 'synonyms'] as const) {
    it(`${algorithm}: normalises upvote and downvote profiles independently`, () => {
      const items = [
        article('crypto', 'Crypto token listing', '', sameTime),
        article('neutral', 'Garden compost tips', '', sameTime),
      ];
      const ranked = rankInterestingArticles(items, heavyUpvoterHistory, now, algorithm);
      expect(ids(ranked)).toEqual(['neutral', 'crypto']);
    });
  }

  // "film" shares no words with any vote, so only the topic profile decides.
  // Culture: 3 of 13 upvotes, but 2 of 2 downvotes.
  const topicHistory = [
    ...Array.from({ length: 10 }, () => feedback('Linux kernel software', '', 1)),
    ...Array.from({ length: 3 }, () => feedback('Movie premiere', '', 1)),
    ...Array.from({ length: 2 }, () => feedback('Music festival', '', -1)),
  ];

  for (const algorithm of ['topics', 'personal-news'] as const) {
    it(`${algorithm}: normalises positive and negative topic profiles independently`, () => {
      const items = [
        article('culture', 'Film review', '', sameTime),
        article('neutral', 'Garden compost tips', '', sameTime),
      ];
      const ranked = rankInterestingArticles(items, topicHistory, now, algorithm);
      expect(ids(ranked)).toEqual(['neutral', 'culture']);
    });
  }

  // Regression: the synonym groups list inflected forms ("learning", "armed",
  // "emissions", "warming"), but they were looked up only after stemming, so
  // these articles had no topic and Topics could not rank them at all.
  const technologyHistory = Array.from({ length: 3 }, () => feedback('Linux kernel software', '', 1));
  it('topics: recognises the inflected words the synonym groups list', () => {
    for (const [title, history] of [
      ['Deep learning breakthrough', technologyHistory],
      ['Armed forces on alert', [feedback('Navy patrol', '', 1)]],
      ['Emissions fall as warming slows', [feedback('Physics research', '', 1)]],
    ] as const) {
      const items = [article('neutral', 'Garden compost tips', '', sameTime), article('match', title, '', sameTime)];
      expect(ids(rankInterestingArticles(items, [...history], now, 'topics'))).toEqual(['match', 'neutral']);
    }
  });

  it('topics: does not stretch a listed word to its other inflections', () => {
    // "learning" means AI in the synonym list; "learn" and "warm" alone do not.
    const items = [article('neutral', 'Garden compost tips', '', sameTime), article('learn', 'Learn to bake on a warm day', '', sameTime)];
    const history = [...technologyHistory, feedback('Physics research', '', 1)];
    expect(ids(rankInterestingArticles(items, history, now, 'topics'))).toEqual(['neutral', 'learn']);
  });

  it('personal-news: bounds diversity reranking so large candidate sets stay fast', () => {
    const words = ['policy', 'chip', 'energy', 'market', 'climate', 'rocket', 'vaccine', 'battery', 'satellite', 'election'];
    const items = Array.from({ length: 600 }, (_, index) => {
      const item = article(
        `bulk-${index}`,
        `${words[index % 10]} ${words[(index * 3) % 10]} report ${index}`,
        `${words[(index * 7) % 10]} analysis and ${words[(index + 4) % 10]} outlook`,
        sameTime - index * 60000,
      );
      item.sourceId = `feed/${index % 12}`;
      return item;
    });
    const history = Array.from({ length: 50 }, (_, index) =>
      feedback(`${words[index % 10]} briefing`, `${words[(index + 1) % 10]} update`, index % 4 === 0 ? -1 : 1));
    const started = performance.now();
    const ranked = rankInterestingArticles(items, history, now, 'personal-news');
    const elapsed = performance.now() - started;
    expect(ranked).toHaveLength(items.length);
    expect(new Set(ranked).size).toBe(items.length);
    // Generous bound: the unbounded greedy loop needed minutes at this size.
    expect(elapsed).toBeLessThan(3000);
  });
});

describe('algorithm registry and selection contract', () => {
  it('keeps the default and every existing algorithm, adding Intelligence Next last', () => {
    expect(DEFAULT_INTERESTING_ALGORITHM).toBe('current');
    expect(INTERESTING_ALGORITHMS.map((a) => a.value)).toEqual([
      'current', 'weighted-idf', 'synonyms', 'topics', 'combined', 'microsoft-news', 'personal-news', 'intelligence-next',
    ]);
    expect(INTERESTING_ALGORITHMS.every((a) => isInterestingAlgorithm(a.value))).toBe(true);
    for (const value of ['', 'Current', 'intelligence', null, undefined, 3]) expect(isInterestingAlgorithm(value)).toBe(false);
  });

  it('existing algorithms ignore the Intelligence Next context entirely', () => {
    const now = Date.UTC(2026, 9, 15);
    const items = [
      article('a', 'Rust compiler release', 'Faster builds and borrow checking', now - 3_600_000),
      article('b', 'Tomato garden tips', 'Grow tomatoes on a balcony', now - 7_200_000),
      article('c', 'Compiler internals', 'How the Rust borrow checker works', now - 1_800_000),
      article('d', 'Stock market wobble', 'Bond yields jump again', now - 900_000),
    ];
    items[1].sourceId = 'feed/2';
    items[3].sourceId = 'feed/3';
    const votes = [feedback('Rust compiler', 'borrow checker', 1), feedback('Stock market', 'bond yields', -1)];
    const context = {
      subscriptions: [{ id: 'feed/2', title: 'Garden weekly' }],
      savedArticles: [{ id: 's', title: 'Tomato garden tips', summary: '', content: '', sourceId: 'feed/2', starred: true, readLater: true }],
    };
    for (const { value } of INTERESTING_ALGORITHMS) {
      if (value === 'intelligence-next') continue;
      const without = rankInterestingArticles(items, votes, now, value).map((x) => x.id);
      expect(rankInterestingArticles(items, votes, now, value, context).map((x) => x.id), value).toEqual(without);
    }
  });
});
