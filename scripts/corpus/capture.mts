/**
 * Capture des pages d'articles pour le corpus de non-régression de
 * l'extraction. Mode d'emploi : `scripts/corpus/README.md`.
 *
 *   npx tsx scripts/corpus/capture.mts --feeds <fichier> --out <dossier> [--per-feed 8] [--max-age-days 30]
 *
 * Le corpus grandit : une page déjà capturée n'est pas recapturée ; un échec
 * est journalisé dans l'index (sans fichier) et retenté au passage suivant.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  BROWSER_USER_AGENT,
  capturedUrls,
  hostOf,
  pageFileName,
  parseArgs,
  parseFeedItems,
  parseFeedList,
  parseIndex,
  pickRecent,
  type IndexEntry,
} from './lib.ts';

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const HOST_DELAY_MS = 1_000;

const lastRequest = new Map<string, number>();

/** Au moins une seconde entre deux requêtes vers un même hôte. */
async function politeWait(url: string): Promise<void> {
  const host = hostOf(url);
  const wait = (lastRequest.get(host) ?? 0) + HOST_DELAY_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest.set(host, Date.now());
}

type Fetched =
  | { ok: true; status: number; finalUrl: string; contentType: string; body: Uint8Array }
  | { ok: false; status: number | string; finalUrl?: string; error?: string };

async function fetchCapped(url: string, accept: string): Promise<Fetched> {
  await politeWait(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': BROWSER_USER_AGENT, Accept: accept, 'Accept-Language': 'fr,en;q=0.8' },
    });
    // La redirection a pu changer d'hôte : il compte aussi pour le délai.
    lastRequest.set(hostOf(res.url), Date.now());
    if (!res.ok) {
      await res.body?.cancel();
      return { ok: false, status: res.status, finalUrl: res.url };
    }
    const declared = Number(res.headers.get('content-length'));
    if (declared > MAX_BYTES) {
      await res.body?.cancel();
      return { ok: false, status: 'too-large', finalUrl: res.url };
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = res.body!.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return { ok: false, status: 'too-large', finalUrl: res.url };
      }
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      body.set(c, at);
      at += c.byteLength;
    }
    return { ok: true, status: res.status, finalUrl: res.url, contentType: res.headers.get('content-type') ?? '', body };
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError';
    return { ok: false, status: aborted ? 'timeout' : 'error', ...(aborted ? {} : { error: String((err as Error).message) }) };
  } finally {
    clearTimeout(timer);
  }
}

/** Décode selon le `charset` de l'en-tête, sinon celui de `<meta>`, sinon UTF-8. */
function decode(body: Uint8Array, contentType: string): string {
  const fromHeader = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1];
  const head = new TextDecoder('latin1').decode(body.subarray(0, 4096));
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1];
  for (const label of [fromHeader, fromMeta, 'utf-8']) {
    if (!label) continue;
    try {
      return new TextDecoder(label).decode(body);
    } catch {
      // libellé inconnu : on essaie le suivant
    }
  }
  return new TextDecoder().decode(body);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.feeds || !args.out) throw new Error('--feeds et --out sont obligatoires');
  const perFeed = Math.max(1, Number(args['per-feed']) || 8);
  const maxAgeDays = Math.max(1, Number(args['max-age-days']) || 30);
  const out = path.resolve(args.out);
  const pagesDir = path.join(out, 'pages');
  const indexFile = path.join(out, 'index.jsonl');
  mkdirSync(pagesDir, { recursive: true });

  const feeds = parseFeedList(readFileSync(args.feeds, 'utf8'));
  const index = existsSync(indexFile) ? parseIndex(readFileSync(indexFile, 'utf8')) : { entries: [], errors: [] };
  for (const e of index.errors) console.error(`index.jsonl:${e.line} ignorée : ${e.message}`);
  const done = capturedUrls(index.entries);

  let feedsRead = 0;
  let fresh = 0;
  const failures = new Map<string, Map<string, number>>();
  const fail = (url: string, status: number | string) => {
    const host = hostOf(url) || '?';
    const byStatus = failures.get(host) ?? new Map<string, number>();
    byStatus.set(String(status), (byStatus.get(String(status)) ?? 0) + 1);
    failures.set(host, byStatus);
  };

  for (const feed of feeds) {
    const res = await fetchCapped(feed, 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5');
    if (!res.ok) {
      console.log(`flux ${feed} : échec ${res.status}${res.error ? ` (${res.error})` : ''}`);
      fail(feed, `flux ${res.status}`);
      continue;
    }
    feedsRead++;
    const items = parseFeedItems(decode(res.body, res.contentType), res.finalUrl || feed);
    const links = pickRecent(items, { perFeed, maxAgeDays, now: Date.now(), exclude: done });
    console.log(`flux ${feed} : ${items.length} articles, ${links.length} à capturer`);

    for (const url of links) {
      const page = await fetchCapped(url, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5');
      const entry: IndexEntry = { url, feed, capturedAt: new Date().toISOString(), status: page.status };
      if (page.finalUrl && page.finalUrl !== url) entry.finalUrl = page.finalUrl;
      if (page.ok && !/html/i.test(page.contentType)) {
        entry.status = 'not-html';
        entry.error = page.contentType || 'sans type';
      } else if (page.ok) {
        const file = pageFileName(url);
        const html = decode(page.body, page.contentType);
        writeFileSync(path.join(pagesDir, file), html);
        entry.file = file;
        entry.bytes = page.body.byteLength;
        done.add(url);
        fresh++;
      } else if (page.error) {
        entry.error = page.error;
      }
      if (!entry.file) fail(url, entry.status);
      appendFileSync(indexFile, JSON.stringify(entry) + '\n');
      console.log(`  ${entry.file ? 'ok  ' : 'échec'} ${String(entry.status).padEnd(8)} ${url}`);
    }
  }

  console.log(`\n${feedsRead}/${feeds.length} flux lus · ${fresh} pages nouvelles`);
  if (failures.size) {
    console.log('échecs par hôte :');
    for (const [host, byStatus] of [...failures].sort()) {
      console.log(`  ${host} : ${[...byStatus].map(([s, n]) => `${s} ×${n}`).join(', ')}`);
    }
  }
}

main().catch((err: Error) => {
  console.error(`capture : ${err.message}`);
  process.exit(2);
});
