# Interesting rankers: synthetic evaluation

An offline, seeded comparison of the algorithms a reader can pick for the
**Interesting** view (`src/lib/intelligenceRanking.ts`) and of the
Intelligence Next design variants (`src/lib/intelligenceNext.ts`).

```sh
npm run eval:interesting                        # Markdown report on stdout
npm run eval:interesting -- --out report.md     # also write it to a file
npm run eval:interesting -- --skip-runtime      # leave out the timing table
```

It needs only the dev dependencies (`tsx`), no network, no server and no
FreshRSS instance. Every table except the runtime one is deterministic: two
runs on the same commit give the same numbers.

## Synthetic data only

`syntheticWorld.ts` generates every feed, article, vote and saved item from
fixed seeds. No real feeds, votes, bookmarks, Raindrop data or any other
reader data are used, read or needed. Feed hosts use the reserved `.example`
top-level domain and article links `example.test`.

The "ground truth" is how the generator was built: the simulated reader likes
rust / ai / astronomy, dislikes celebrity / deals and ignores the rest; 10 % of
its upvotes are noise on neutral topics. The numbers therefore show whether a
ranker reacts to the signals it is given, **not** whether a real reader would
prefer its ordering. Real-world quality is unvalidated, and the Intelligence
Next weights are a-priori choices that were not tuned on this data or any
other.

## Worlds

* **realistic**: Zipf-distributed vocabularies (80 words per topic, 800 general
  words); same-topic articles share only some terms, as in news text.
* **homogeneous**: 15 words per topic; same-topic articles look almost alike
  (cosine ≈ 0.7). This is a harsh case for similarity-based diversity and for
  any vote aggregation that saturates.

Each snapshot has 300 unread candidates from 20 feeds over the last 7 days,
including a prolific deals feed (~25 %), about 8 % syndicated copies of a
story in a second feed, and a just-added Woodworking feed (8 articles, no
votes on its topic).

## Scenarios

| Key | Signals |
|---|---|
| A | warm start: 60 votes, 20 saved articles, subscriptions |
| B | sparse feedback: 3 votes, no saved articles |
| C | cold start: subscriptions and freshness only |
| D | as A without subscriptions (only Intelligence Next reads them) |
| E | as C, with the deals publisher split over three feeds on one host |
| F | as C, with the two rust publishers sharing one host (`blogs.example/<name>/`) |
| G | as A, with ~15 % of the candidates undated (`publishedMissing`) |
| H | as C, with the new feed one of eight channels on one platform host (`video.example/channel/<name>`) |

E, F and H only change subscriptions, so they appear only in the Intelligence
Next variant tables. The "PR #47 settings" rows there reproduce that version's
evidence settings, but keep this version's neutral handling of undated
articles and full strength for saved candidates.

## Metrics

* **liked share @20**: share of the top 20 from liked topics (higher is better).
* **disliked @20**: number of disliked-topic articles in the top 20.
* **mean pct**: mean position of a group as a fraction of the list (0 = top).
* **new feed**: the just-added Woodworking feed's mean pct and top-20 count.
* **max/source @20**, **longest run**: source concentration in the top 20.
* **dup pairs @20**: pairs of copies of one story in the top 20.
* **E deals @20**, **F rust pct**, **G undated @20** (about 3 expected at
  the base rate), **H new pct** (the new feed's mean pct on the platform host).

## Caveats

* English vocabulary only, and fixed generator choices; changing the
  generator changes the numbers.
* The Topic model's fixed six-category taxonomy has no category for rust or
  astronomy (it recognises AI through its synonym list), so its liked share
  reflects that design as much as the votes.
* Timings are indicative: a single machine, no isolation.
