export interface RefreshDelta {
  totalNew: number;
  newByFeed: Record<string, number>;
}

// Compare per-feed unread counts before/after a refresh to surface how many new
// articles arrived and in which feeds. Only real feeds (`feed/…`) count —
// categories, states and the reading-list total are derived and would double
// count. Only positive deltas (new items) are reported.
export function computeRefreshDelta(
  before: Record<string, number>,
  after: Record<string, number>
): RefreshDelta {
  const newByFeed: Record<string, number> = {};
  let totalNew = 0;
  for (const [id, count] of Object.entries(after)) {
    if (!id.startsWith('feed/')) continue;
    const delta = count - (before[id] || 0);
    if (delta > 0) {
      newByFeed[id] = delta;
      totalNew += delta;
    }
  }
  return { totalNew, newByFeed };
}
