// Builds the request that triggers a REAL feed refresh on FreshRSS.
//
// FreshRSS documents this as a GET with the token in the query string, which
// would write the secret into every access log it crosses. It does not have to
// be: FrontController merges $_POST into the request params, tokenIsOk() reads
// them without caring about the origin, and feedController has no CSRF check.
// So credentials travel in the body — only the controller and action stay in
// the URL. Never switch this back to GET.

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
  body: URLSearchParams;
}

export function buildActualizeRequest(opts: {
  serverUrl: string;
  freshrssUser: string;
  token: string;
  maxFeeds?: number;
}): ActualizeRequest {
  const base = opts.serverUrl.replace(/\/+$/, '');
  const body = new URLSearchParams({
    user: opts.freshrssUser,
    token: opts.token,
    maxFeeds: String(opts.maxFeeds ?? refreshMaxFeeds()),
    ajax: '1',
  });
  return { url: `${base}/i/?c=feed&a=actualize`, body };
}
