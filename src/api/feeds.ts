import client from './client';
import { isStaleWriteTokenFailure } from '../lib/writeTokenRetry';
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

/**
 * Envoyer une écriture SIGNÉE par le jeton d'écriture, avec une seule reprise.
 *
 * Le jeton était obtenu une fois puis gardé pour toute la session, et rien ne
 * l'invalidait : dès qu'il périmait, chaque ✓, chaque favori, chaque « à lire
 * plus tard » échouait jusqu'au rechargement de la page. Le retrait optimiste
 * de la ligne déguisait ces échecs en réussites.
 *
 * La reprise est UNIQUE, et elle l'est par construction — `client.post` n'est
 * appelé qu'à deux endroits, jamais dans une boucle ni par récursion. Un
 * second échec ressort tel quel : ce sont les appelants qui savent quoi en
 * faire (rollback pour un refus, file d'attente pour un incident réseau), et
 * une reprise supplémentaire ici leur retirerait cette décision tout en
 * multipliant les écritures en vol.
 *
 * `build` reçoit le jeton en argument plutôt que de le lire au-dessus : la
 * seconde tentative doit repartir du jeton FRAIS, sinon elle rejoue le refus.
 */
async function postSigned(
  path: string,
  build: (token: string | null) => URLSearchParams
): Promise<void> {
  const token = await ensureToken();
  try {
    await client.post(`${BASE}${path}`, build(token));
  } catch (err) {
    // Hors ligne, 5xx, 404… : rien qu'un nouveau jeton puisse réparer.
    if (!isStaleWriteTokenFailure(err)) throw err;
    let fresh: string | null;
    try {
      clearWriteToken();
      fresh = await ensureToken();
    } catch {
      // Impossible d'obtenir un jeton : c'est l'échec d'ORIGINE qui compte,
      // lui seul décrit ce qui est arrivé à l'écriture.
      throw err;
    }
    await client.post(`${BASE}${path}`, build(fresh));
  }
}

async function editTag(
  itemIds: string | string[],
  addTag: string | null = null,
  removeTag: string | null = null
): Promise<void> {
  return postSigned('/edit-tag', (token) => {
    const params = new URLSearchParams();
    if (token) params.append('T', token);
    const ids = Array.isArray(itemIds) ? itemIds : [itemIds];
    ids.forEach((id) => params.append('i', id));
    if (addTag) params.append('a', addTag);
    if (removeTag) params.append('r', removeTag);
    return params;
  });
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

async function getToken(): Promise<string> {
  const { data } = await client.get<string>(`${BASE}/token`);
  // Token comes with trailing newline — strip it
  return typeof data === 'string' ? data.trim() : data;
}

// Mark all items in a stream as read (up to a timestamp)
export async function markAllAsRead(streamId: string, timestampUsec: string | number | null = null): Promise<void> {
  return postSigned('/mark-all-as-read', (token) => {
    const params = new URLSearchParams();
    if (token) params.append('T', token);
    params.append('s', streamId);
    if (timestampUsec) {
      params.append('ts', String(timestampUsec));
    }
    return params;
  });
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
  return postSigned('/subscription/edit', (token) => {
    const params = new URLSearchParams();
    if (token) params.append('T', token);
    params.append('ac', 'subscribe');
    params.append('s', `feed/${feedUrl}`);
    if (title) params.append('t', title);
    if (categoryId && categoryLabel) {
      params.append('a', categoryId);
      params.append('l', categoryLabel);
    }
    return params;
  });
}

// Rename / move a feed
export async function editFeed(
  feedId: string,
  title?: string,
  categoryId?: string,
  categoryLabel?: string
): Promise<void> {
  return postSigned('/subscription/edit', (token) => {
    const params = new URLSearchParams();
    if (token) params.append('T', token);
    params.append('ac', 'edit');
    params.append('s', feedId);
    if (title) params.append('t', title);
    if (categoryId && categoryLabel) {
      params.append('a', categoryId);
      params.append('l', categoryLabel);
    }
    return params;
  });
}

// Unsubscribe from a feed
export async function unsubscribeFeed(feedId: string): Promise<void> {
  return postSigned('/subscription/edit', (token) => {
    const params = new URLSearchParams();
    if (token) params.append('T', token);
    params.append('ac', 'unsubscribe');
    params.append('s', feedId);
    return params;
  });
}

// Rename a label / tag
export async function renameTag(oldTag: string, newTag: string): Promise<void> {
  return postSigned('/rename-tag', (token) => {
    const params = new URLSearchParams();
    if (token) params.append('T', token);
    params.append('s', oldTag);
    params.append('dest', newTag);
    return params;
  });
}

// Delete a label / tag
export async function deleteTag(tagId: string): Promise<void> {
  return postSigned('/disable-tag', (token) => {
    const params = new URLSearchParams();
    if (token) params.append('T', token);
    params.append('s', tagId);
    return params;
  });
}

// Add/remove a label on articles
export async function setArticleLabel(
  itemIds: string | string[],
  labelId: string,
  add = true
): Promise<void> {
  return editTag(itemIds, add ? labelId : null, add ? null : labelId);
}
