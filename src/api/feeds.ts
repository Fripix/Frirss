import client from './client';
import type { Subscription, Tag, UnreadCount, GReaderItem, GReaderStream } from '../types';

const BASE = '/api/greader.php/reader/api/0';

export async function getSubscriptionList(): Promise<Subscription[]> {
  const { data } = await client.get<{ subscriptions?: Subscription[] }>(`${BASE}/subscription/list`, {
    params: { output: 'json' },
  });
  return data.subscriptions || [];
}

export async function getTagList(): Promise<Tag[]> {
  const { data } = await client.get<{ tags?: Tag[] }>(`${BASE}/tag/list`, {
    params: { output: 'json' },
  });
  return data.tags || [];
}

export async function getUnreadCounts(): Promise<UnreadCount[]> {
  const { data } = await client.get<{ unreadcounts?: UnreadCount[] }>(`${BASE}/unread-count`, {
    params: { output: 'json' },
  });
  return data.unreadcounts || [];
}

export async function getStreamContents(
  streamId: string,
  count = 20,
  continuation: string | null = null,
  excludeTag: string | null = null,
  { cacheOnly = false }: { cacheOnly?: boolean } = {}
): Promise<GReaderStream | null> {
  const params: Record<string, string | number> = { output: 'json', n: count };
  if (continuation) params.c = continuation;
  if (excludeTag) params.xt = excludeTag;
  const url = `${BASE}/stream/contents/${buildStreamPath(streamId)}`;
  const config: { params: typeof params; headers?: Record<string, string> } = { params };
  // Cache-only read: backend returns the cached copy (200) or 204 on a miss,
  // without touching FreshRSS. Used for the instant SWR first paint.
  if (cacheOnly) config.headers = { 'X-Cache-Only': '1' };
  const { status, data } = await client.get<{ items?: GReaderItem[]; continuation?: string | null }>(url, config);
  if (cacheOnly && (status === 204 || !data)) return null; // cache miss
  return {
    items: data.items || [],
    continuation: data.continuation || null,
  };
}

/**
 * Build the URL path for a stream ID.
 *
 * FreshRSS parses label streams by matching a regex on REQUEST_URI:
 *   /stream/contents/user/[^/+]/label/([A-Za-z0-9'!*()%$_.~+-]+)
 *
 * The regex captures the label name (potentially percent-encoded) and
 * calls urldecode() on it.  So we must keep the structural slashes in
 * "user/-/label/" as literal '/' in the URL path and only percent-
 * encode the label name itself (e.g.  "test1/films" → "test1%2Ffilms").
 *
 * For feeds, the same pattern applies: structural "feed/" stays literal,
 * then the feed URL is percent-encoded.
 *
 * State streams (reading-list, starred, …) have no special chars in
 * practice and are left as-is.
 */
function buildStreamPath(streamId: string): string {
  // Label streams: user/-/label/LabelName  or  user/1/label/LabelName
  const labelMatch = streamId.match(/^(user\/[^/]+\/label\/)(.+)$/);
  if (labelMatch) {
    return `${labelMatch[1]}${encodeURIComponent(labelMatch[2])}`;
  }
  // Feed streams: feed/https://example.com/rss
  if (streamId.startsWith('feed/')) {
    return `feed/${encodeURIComponent(streamId.substring(5))}`;
  }
  // State streams & everything else — no encoding needed for path segments
  // (reading-list, starred, etc. contain only safe chars)
  return streamId;
}

export async function getStarredItems(
  count = 20,
  continuation: string | null = null,
  cacheOnly = false
): Promise<GReaderStream | null> {
  return getStreamContents('user/-/state/com.google/starred', count, continuation, null, { cacheOnly });
}

/**
 * Count items in a stream cheaply via the IDs-only endpoint (no article
 * content fetched). Returns the number of IDs returned, capped at `cap`.
 */
export async function getStreamItemCount(streamId: string, cap = 1000): Promise<number> {
  const { data } = await client.get<{ itemRefs?: { id: string }[] }>(
    `${BASE}/stream/items/ids`,
    { params: { output: 'json', s: streamId, n: cap } }
  );
  return data.itemRefs?.length ?? 0;
}

// Cache the write token (CSRF)
let writeToken: string | null = null;

async function ensureToken(): Promise<string | null> {
  if (!writeToken) {
    writeToken = await getToken();
  }
  return writeToken;
}

// Force token refresh (called on app init or after auth error)
export function clearWriteToken(): void {
  writeToken = null;
}

export async function editTag(
  itemIds: string | string[],
  addTag: string | null = null,
  removeTag: string | null = null
): Promise<void> {
  const token = await ensureToken();
  const params = new URLSearchParams();
  if (token) params.append('T', token);
  const ids = Array.isArray(itemIds) ? itemIds : [itemIds];
  ids.forEach((id) => params.append('i', id));
  if (addTag) params.append('a', addTag);
  if (removeTag) params.append('r', removeTag);
  await client.post(`${BASE}/edit-tag`, params);
}

export function markAsRead(itemIds: string | string[]): Promise<void> {
  return editTag(itemIds, 'user/-/state/com.google/read');
}

export function markAsUnread(itemIds: string | string[]): Promise<void> {
  return editTag(itemIds, null, 'user/-/state/com.google/read');
}

export function markAsStarred(itemIds: string | string[]): Promise<void> {
  return editTag(itemIds, 'user/-/state/com.google/starred');
}

export function removeStarred(itemIds: string | string[]): Promise<void> {
  return editTag(itemIds, null, 'user/-/state/com.google/starred');
}

export async function getToken(): Promise<string> {
  const { data } = await client.get<string>(`${BASE}/token`);
  // Token comes with trailing newline — strip it
  return typeof data === 'string' ? data.trim() : data;
}

// Mark all items in a stream as read (up to a timestamp)
export async function markAllAsRead(streamId: string, timestampUsec: string | number | null = null): Promise<void> {
  const token = await ensureToken();
  const params = new URLSearchParams();
  if (token) params.append('T', token);
  params.append('s', streamId);
  if (timestampUsec) {
    params.append('ts', String(timestampUsec));
  }
  await client.post(`${BASE}/mark-all-as-read`, params);
}

// Search articles
export async function searchItems(
  query: string,
  count = 40,
  continuation: string | null = null,
  streamId = 'user/-/state/com.google/reading-list'
): Promise<GReaderStream> {
  const params: Record<string, string | number> = { output: 'json', n: count, q: query };
  if (continuation) params.c = continuation;
  const { data } = await client.get<{ items?: GReaderItem[]; continuation?: string | null }>(
    `${BASE}/stream/contents/${buildStreamPath(streamId)}`,
    { params }
  );
  return {
    items: data.items || [],
    continuation: data.continuation || null,
  };
}

// Subscribe to a new feed
export async function subscribeFeed(
  feedUrl: string,
  title = '',
  categoryId = '',
  categoryLabel = ''
): Promise<void> {
  const token = await ensureToken();
  const params = new URLSearchParams();
  if (token) params.append('T', token);
  params.append('ac', 'subscribe');
  params.append('s', `feed/${feedUrl}`);
  if (title) params.append('t', title);
  if (categoryId && categoryLabel) {
    params.append('a', categoryId);
    params.append('l', categoryLabel);
  }
  await client.post(`${BASE}/subscription/edit`, params);
}

// Rename / move a feed
export async function editFeed(
  feedId: string,
  title?: string,
  categoryId?: string,
  categoryLabel?: string
): Promise<void> {
  const token = await ensureToken();
  const params = new URLSearchParams();
  if (token) params.append('T', token);
  params.append('ac', 'edit');
  params.append('s', feedId);
  if (title) params.append('t', title);
  if (categoryId && categoryLabel) {
    params.append('a', categoryId);
    params.append('l', categoryLabel);
  }
  await client.post(`${BASE}/subscription/edit`, params);
}

// Unsubscribe from a feed
export async function unsubscribeFeed(feedId: string): Promise<void> {
  const token = await ensureToken();
  const params = new URLSearchParams();
  if (token) params.append('T', token);
  params.append('ac', 'unsubscribe');
  params.append('s', feedId);
  await client.post(`${BASE}/subscription/edit`, params);
}

// Rename a label / tag
export async function renameTag(oldTag: string, newTag: string): Promise<void> {
  const token = await ensureToken();
  const params = new URLSearchParams();
  if (token) params.append('T', token);
  params.append('s', oldTag);
  params.append('dest', newTag);
  await client.post(`${BASE}/rename-tag`, params);
}

// Delete a label / tag
export async function deleteTag(tagId: string): Promise<void> {
  const token = await ensureToken();
  const params = new URLSearchParams();
  if (token) params.append('T', token);
  params.append('s', tagId);
  await client.post(`${BASE}/disable-tag`, params);
}

// Add/remove a label on articles
export async function setArticleLabel(
  itemIds: string | string[],
  labelId: string,
  add = true
): Promise<void> {
  return editTag(itemIds, add ? labelId : null, add ? null : labelId);
}
