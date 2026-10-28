export interface RefreshDelta {
  totalNew: number;
  newByFeed: Record<string, number>;
}

// Compare per-feed unread counts before/after a refresh to surface how many new
// articles arrived and in which feeds. Only real feeds (`feed/…`) count —
// categories, states and the reading-list total are derived and would double
// count. Only positive deltas (new items) are reported.
//
// `ignoreUnknownFeeds` : un flux absent de `before` ne compte pas. C'est le cas
// de `loadSubscriptions` après un ajout — le stock entier du flux ajouté
// passerait sinon pour des arrivées. L'appelant doit donc poser à 0 dans
// `before` les flux qu'il connaît sans compteur, sans quoi leurs vraies
// arrivées seraient écartées avec les flux nouveaux.
export function computeRefreshDelta(
  before: Record<string, number>,
  after: Record<string, number>,
  opts?: { ignoreUnknownFeeds?: boolean },
): RefreshDelta {
  const newByFeed: Record<string, number> = {};
  let totalNew = 0;
  for (const [id, count] of Object.entries(after)) {
    if (!id.startsWith('feed/')) continue;
    if (opts?.ignoreUnknownFeeds && !(id in before)) continue;
    const delta = count - (before[id] || 0);
    if (delta > 0) {
      newByFeed[id] = delta;
      totalNew += delta;
    }
  }
  return { totalNew, newByFeed };
}
