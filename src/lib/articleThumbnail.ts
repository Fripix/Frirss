/** First <img> src found in an article's HTML body, or null. */
export function extractImageFromContent(html: string): string | null {
  if (!html) return null;
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

/** Uppercase first letter of a source name, for the no-image card fallback. */
export function sourceInitial(source: string): string {
  const c = source?.trim()?.[0];
  return c ? c.toUpperCase() : '?';
}
