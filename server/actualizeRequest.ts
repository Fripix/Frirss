// Builds the request that triggers a REAL feed refresh on FreshRSS.
//
// It is a GET, with the master token in the query string, because that is the
// only form FreshRSS accepts. Measured against FreshRSS 1.29.1 with a valid
// token: GET with credentials in the query string → 200; POST with the same
// credentials in the query string → 302; POST with them in the body → 302.
// The method is what decides, not where the credentials sit.
//
// The cause is `app/FreshRSS.php::initAuth()`, which applies a global CSRF
// check to EVERY POST with a narrow allow-list; the feed/actualize exemption
// only applies when `allow_anonymous_refresh` is enabled, which it is not by
// default. A rejected POST answers 403 [CSRF] and redirects. There is no third
// option: `isCsrfOk()` compares against a session-bound token, and FriRSS has
// no FreshRSS session — it authenticates by token, not by password.
//
// Consequence, accepted knowingly: the token lands in the access logs of the
// FreshRSS server and of anything in front of it. That is how the endpoint is
// designed, and the UI warns the user before they paste the secret. Mitigation
// for operators: PROXY_REWRITES sends this request straight to FreshRSS over
// the internal network, so no public reverse proxy ever sees it. Inside FriRSS,
// the token must still never reach the browser or an application log — see
// redactUrl() in routes/proxy.ts and sanitizeError() at the call site.

export const DEFAULT_MAX_FEEDS = 1000;

/** Operator-tunable batch size (FRIRSS_REFRESH_MAX_FEEDS); junk falls back to the default. */
export function refreshMaxFeeds(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.FRIRSS_REFRESH_MAX_FEEDS;
  if (raw == null || raw === '') return DEFAULT_MAX_FEEDS;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_MAX_FEEDS;
}

export interface ActualizeRequest {
  url: string;
  /** Pinned in the type: anything else is rejected by FreshRSS's CSRF gate. */
  method: 'GET';
}

export function buildActualizeRequest(opts: {
  serverUrl: string;
  freshrssUser: string;
  token: string;
  maxFeeds?: number;
}): ActualizeRequest {
  const base = opts.serverUrl.replace(/\/+$/, '');
  const params = new URLSearchParams({
    c: 'feed',
    a: 'actualize',
    user: opts.freshrssUser,
    token: opts.token,
    maxFeeds: String(opts.maxFeeds ?? refreshMaxFeeds()),
    ajax: '1',
  });
  return { url: `${base}/i/?${params.toString()}`, method: 'GET' };
}
