// Resolve the best "site" URL to open for a feed.
//
// The naive `feed.htmlUrl || feed.url` breaks for feeds whose channel <link>
// points at the feed itself (e.g. MacGeneration's htmlUrl is the RSS at
// megaflux.macg.co) — "Open site" then downloads raw XML. Articles, on the
// other hand, always link to the real site, so we derive the site from an
// article's origin when the feed's own htmlUrl is unusable.

function originOf(u?: string): string | null {
  if (!u) return null;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return `${parsed.protocol}//${parsed.host}/`;
  } catch {
    return null;
  }
}

// A URL that is itself a feed rather than a website (extension or path segment).
function looksLikeFeed(u: string): boolean {
  return /\.(xml|rss|atom)(?:[?#]|$)/i.test(u) || /\/(?:feed|feeds|rss|atom|flux)\/?(?:[?#]|$)/i.test(u);
}

export function feedSiteUrl(
  feed: { htmlUrl?: string; url?: string },
  sampleArticleUrl?: string
): string | null {
  const html = feed.htmlUrl?.trim() || '';
  const feedUrl = feed.url?.trim() || '';

  // A good site link: present, distinct from the feed URL, and not itself a feed.
  if (html && html !== feedUrl && !looksLikeFeed(html)) return html;

  // Otherwise derive the real site — an article's origin is the site; fall back
  // to the origin (domain root) of htmlUrl/url, then the raw value.
  return originOf(sampleArticleUrl) || originOf(html) || originOf(feedUrl) || html || feedUrl || null;
}
