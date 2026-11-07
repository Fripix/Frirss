/**
 * Capture des pages d'articles pour le corpus de non-régression de
 * l'extraction. Mode d'emploi : `scripts/corpus/README.md`.
 *
 *   npx tsx scripts/corpus/capture.mts --feeds <fichier> --out <dossier> [--per-feed 8] [--max-age-days 30]
 *   npx tsx scripts/corpus/capture.mts --feeds <fichier> --out <dossier> --backfill [--from-xml <dossier|fichier>]
 *
 * Chaque page capturée est accompagnée du contenu de son item dans le flux
 * (`<corpus>/feed/<même nom>`, champ `feedFile` de l'index) : c'est l'oracle
 * de `compare.mts`. `--backfill` ne capture rien : il relit les flux et remplit
 * `feedFile` pour les pages déjà capturées dont l'item est encore dans le flux
 * (ou dans les fichiers XML de `--from-xml`).
 *
 * Le corpus grandit : une page déjà capturée n'est pas recapturée ; un échec
 * est journalisé dans l'index (sans fichier) et retenté au passage suivant.
 */
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
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
import { feedContentFor, indexFeedEntries, parseFeedEntries, setFeedFiles, takeFlag } from './feedOracle.ts';

/** Une ligne de l'index, avec le contenu du flux de la page (`<corpus>/feed/`). */
type IndexEntryWithFeed = IndexEntry & { feedFile?: string };

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
  const flag = takeFlag(process.argv.slice(2), 'backfill');
  const args = parseArgs(flag.argv);
  if (!args.feeds || !args.out) throw new Error('--feeds et --out sont obligatoires');
  if (flag.present) return backfill(args);
  const perFeed = Math.max(1, Number(args['per-feed']) || 8);
  const maxAgeDays = Math.max(1, Number(args['max-age-days']) || 30);
  const out = path.resolve(args.out);
  const pagesDir = path.join(out, 'pages');
  const indexFile = path.join(out, 'index.jsonl');
  const feedDir = path.join(out, 'feed');
  mkdirSync(pagesDir, { recursive: true });
  mkdirSync(feedDir, { recursive: true });

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
    const xml = decode(res.body, res.contentType);
    const items = parseFeedItems(xml, res.finalUrl || feed);
    const contents = indexFeedEntries(parseFeedEntries(xml, res.finalUrl || feed));
    const links = pickRecent(items, { perFeed, maxAgeDays, now: Date.now(), exclude: done });
    console.log(`flux ${feed} : ${items.length} articles, ${links.length} à capturer`);

    for (const url of links) {
      const page = await fetchCapped(url, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5');
      const entry: IndexEntryWithFeed = { url, feed, capturedAt: new Date().toISOString(), status: page.status };
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
        const feedHtml = feedContentFor(contents, { url, finalUrl: page.finalUrl });
        if (feedHtml) {
          writeFileSync(path.join(feedDir, file), feedHtml);
          entry.feedFile = file;
        }
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

/** Fichiers XML d'un dossier (ou le fichier lui-même). */
function xmlFiles(spec: string): string[] {
  const abs = path.resolve(spec);
  if (!statSync(abs).isDirectory()) return [abs];
  return readdirSync(abs)
    .filter((f) => /\.(xml|rss|atom)$/i.test(f))
    .sort()
    .map((f) => path.join(abs, f));
}

/**
 * Remplit `feedFile` pour les pages déjà capturées : relit les flux de
 * `--feeds` (puis les XML de `--from-xml`, pour les items sortis du flux).
 * N'écrit que `<corpus>/feed/` et le champ `feedFile` de l'index, dont une
 * copie `index.jsonl.bak` est faite avant.
 */
async function backfill(args: Record<string, string>): Promise<void> {
  const out = path.resolve(args.out);
  const indexFile = path.join(out, 'index.jsonl');
  const feedDir = path.join(out, 'feed');
  const index = parseIndex(readFileSync(indexFile, 'utf8'));
  for (const e of index.errors) console.error(`index.jsonl:${e.line} ignorée : ${e.message}`);
  const withFeed = new Set(
    (index.entries as IndexEntryWithFeed[]).filter((e) => e.file && e.feedFile).map((e) => e.file as string),
  );
  const byFile = new Map<string, IndexEntry>();
  for (const e of index.entries) if (e.file && !withFeed.has(e.file)) byFile.set(e.file, e);
  const todo = [...byFile.values()].filter((e) => existsSync(path.join(out, 'pages', e.file!)));
  console.log(`${todo.length} pages sans contenu de flux`);

  const sources: { name: string; map: Map<string, string> }[] = [];
  let feedsRead = 0;
  const feeds = parseFeedList(readFileSync(args.feeds, 'utf8'));
  for (const feed of feeds) {
    const res = await fetchCapped(feed, 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5');
    if (!res.ok) {
      console.log(`flux ${feed} : échec ${res.status}${res.error ? ` (${res.error})` : ''}`);
      continue;
    }
    feedsRead++;
    sources.push({ name: 'flux', map: indexFeedEntries(parseFeedEntries(decode(res.body, res.contentType), res.finalUrl || feed)) });
  }
  if (args['from-xml']) {
    for (const file of xmlFiles(args['from-xml'])) {
      sources.push({ name: 'xml', map: indexFeedEntries(parseFeedEntries(readFileSync(file, 'utf8'))) });
    }
  }

  mkdirSync(feedDir, { recursive: true });
  const found = new Map<string, string>();
  const bySource = new Map<string, number>();
  for (const e of todo) {
    for (const s of sources) {
      const html = feedContentFor(s.map, e);
      if (!html) continue;
      writeFileSync(path.join(feedDir, e.file!), html);
      found.set(e.file!, e.file!);
      bySource.set(s.name, (bySource.get(s.name) ?? 0) + 1);
      break;
    }
  }

  if (found.size) {
    copyFileSync(indexFile, indexFile + '.bak');
    // Relu juste avant l'écriture : une capture a pu ajouter des lignes entre-temps.
    const { text, updated } = setFeedFiles(readFileSync(indexFile, 'utf8'), found);
    const tmp = indexFile + '.tmp';
    writeFileSync(tmp, text);
    renameSync(tmp, indexFile);
    console.log(`index.jsonl : ${updated} lignes complétées (copie : index.jsonl.bak)`);
  }
  console.log(
    `${feedsRead}/${feeds.length} flux lus · ${found.size}/${todo.length} pages reçoivent un contenu de flux` +
      ` (${[...bySource].map(([k, n]) => `${k} ${n}`).join(', ') || 'aucune'}) · ${todo.length - found.size} sans item`,
  );
}

main().catch((err: Error) => {
  console.error(`capture : ${err.message}`);
  process.exit(2);
});
