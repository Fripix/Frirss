/**
 * Oracle du flux : le contenu qu'un flux RSS / Atom donne pour un article
 * (`content:encoded`, `content` Atom, sinon `description` / `summary`) dit ce
 * que l'extrait de la page DOIT contenir. C'est une mesure absolue, là où
 * `compareExtracts` ne voit que l'écart entre deux versions de l'extracteur :
 * une perte que la base avait déjà (Docker en 1.8.0 : l'article entier
 * remplacé par des « articles liés ») reste invisible à la comparaison.
 *
 * Logique pure, testée dans `feedOracle.test.ts` ; `capture.mts` enregistre le
 * contenu du flux, `compare.mts` mesure les extraits contre lui.
 */
import { parseHTML } from 'linkedom';
import {
  decodeEntities,
  isFragment,
  isTracked,
  normalizeText,
  parseFeedItems,
  splitSentences,
  visibleBlocks,
  visibleText,
  type AcceptedMatcher,
  type ExtractLike,
} from './lib.ts';

// ── Lecture du contenu des items ───────────────────────────────────────

export interface FeedEntry {
  /** Lien de l'article, tel que `parseFeedItems` le retient (celui que `capture.mts` capture). */
  link: string;
  /** Clés d'appariement (`urlKey`) : lien, lien d'origine FeedBurner, liens `alternate`, guid permalien. */
  keys: string[];
  /** HTML du contenu de l'item (vide si le flux n'en donne pas). */
  content: string;
}

const HTML_TAG = /<\/?[a-z][\w-]*(?:\s[^>]*)?\/?>/i;

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Premier élément `name` non vide (un `<content src="…"/>` Atom est sauté). */
function element(block: string, name: string): { attrs: string; inner: string } | null {
  const open = new RegExp(`<${name}(?![\\w:-])([^>]*?)(/?)>`, 'gi');
  for (let m = open.exec(block); m; m = open.exec(block)) {
    if (m[2] === '/') continue;
    const rest = block.slice(open.lastIndex);
    const close = new RegExp(`</${name}\\s*>`, 'i').exec(rest);
    if (!close) return null;
    return { attrs: m[1], inner: rest.slice(0, close.index) };
  }
  return null;
}

/** HTML d'un élément de flux : CDATA déballé, HTML échappé décodé, texte brut mis en HTML. */
function elementHtml(el: { attrs: string; inner: string } | null): string {
  if (!el) return '';
  const inner = el.inner.trim();
  let text: string;
  if (/\btype\s*=\s*["']?xhtml/i.test(el.attrs)) {
    text = inner;
  } else if (!inner.includes('<![CDATA[') && HTML_TAG.test(inner)) {
    // HTML brut dans le XML (flux invalide mais courant) : déjà du HTML.
    text = inner;
  } else {
    text = '';
    let last = 0;
    for (const m of inner.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
      text += decodeEntities(inner.slice(last, m.index));
      text += m[1];
      last = m.index + m[0].length;
    }
    text += decodeEntities(inner.slice(last));
  }
  text = text.trim();
  // CDATA qui enveloppe du HTML échappé.
  if (!HTML_TAG.test(text) && /&lt;\/?[a-z]/i.test(text)) text = decodeEntities(text).trim();
  if (!text || HTML_TAG.test(text)) return text;
  return escapeText(text).replace(/\r?\n/g, '<br>');
}

/**
 * Clé d'appariement d'une URL : hôte sans `www.`, chemin en minuscules sans
 * barre finale, requête sans les `utm_*`, fragment ignoré.
 */
export function urlKey(url: string): string {
  try {
    const u = new URL(url);
    const params = [...u.searchParams].filter(([k]) => !/^utm_/i.test(k));
    const query = params.length ? '?' + new URLSearchParams(params).toString() : '';
    return u.hostname.toLowerCase().replace(/^www\./, '') + u.pathname.toLowerCase().replace(/\/+$/, '') + query;
  } catch {
    return url.trim().toLowerCase();
  }
}

function absoluteUrl(link: string, base: string | undefined): string | null {
  try {
    const u = base ? new URL(link, base) : new URL(link);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

function candidateLinks(block: string): string[] {
  const out: string[] = [];
  const orig = /<(?:[\w-]+:)?origLink\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?origLink\s*>/i.exec(block);
  if (orig) out.push(orig[1]);
  for (const m of block.matchAll(/<(?:atom:)?link\b([^>]*?)(\/?)>/gi)) {
    const href = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[1]);
    if (href) {
      const rel = /\srel\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[1]);
      if (!rel || (rel[1] ?? rel[2]).toLowerCase() === 'alternate') out.push(href[1] ?? href[2]);
      continue;
    }
    if (m[2] === '/') continue;
    const rest = block.slice((m.index ?? 0) + m[0].length);
    const close = /<\/(?:atom:)?link\s*>/i.exec(rest);
    if (close) out.push(rest.slice(0, close.index));
  }
  const guid = /<guid\b[^>]*>([\s\S]*?)<\/guid\s*>/i.exec(block);
  if (guid) out.push(guid[1]);
  return out.map((l) => decodeEntities(l.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim()).filter(Boolean);
}

/** Items d'un flux avec leur contenu : le plus long de `content:encoded`/`content` et de `description`/`summary`. */
export function parseFeedEntries(xml: string, feedUrl?: string): FeedEntry[] {
  const text = xml.replace(/<!--[\s\S]*?-->/g, '');
  const out: FeedEntry[] = [];
  const block = /<((?:[\w-]+:)?(?:item|entry))\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  for (let m = block.exec(text); m; m = block.exec(text)) {
    const body = m[2];
    const link = parseFeedItems(`<${m[1]}>${body}</${m[1]}>`, feedUrl)[0]?.link;
    if (!link) continue;
    const keys = new Set<string>([urlKey(link)]);
    for (const c of candidateLinks(body)) {
      const abs = absoluteUrl(c, feedUrl);
      if (abs) keys.add(urlKey(abs));
    }
    const full = elementHtml(element(body, 'content:encoded')) || elementHtml(element(body, '(?:atom:)?content'));
    const summary = elementHtml(element(body, 'description')) || elementHtml(element(body, '(?:atom:)?summary'));
    const content = visibleText(summary).length > visibleText(full).length ? summary : full;
    out.push({ link, keys: [...keys], content });
  }
  return out;
}

/** Clé → contenu ; le premier item qui porte une clé la garde ; un contenu sans texte est ignoré. */
export function indexFeedEntries(entries: FeedEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of entries) {
    if (!visibleText(e.content)) continue;
    for (const k of e.keys) if (!map.has(k)) map.set(k, e.content);
  }
  return map;
}

/** Contenu du flux d'une page capturée : par son `url`, sinon par son `finalUrl`. */
export function feedContentFor(map: Map<string, string>, page: { url: string; finalUrl?: string }): string | null {
  return map.get(urlKey(page.url)) ?? (page.finalUrl ? map.get(urlKey(page.finalUrl)) : undefined) ?? null;
}

// ── Index du corpus ────────────────────────────────────────────────────

/**
 * Ajoute `feedFile` (en dernier champ) aux lignes de `index.jsonl` dont le
 * `file` est dans `feedFiles` et qui n'en ont pas encore. Toute autre ligne
 * (y compris illisible) est rendue telle quelle, à sa place.
 */
export function setFeedFiles(indexText: string, feedFiles: Map<string, string>): { text: string; updated: number } {
  let updated = 0;
  const lines = indexText.split('\n').map((raw) => {
    if (!raw.trim()) return raw;
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return raw;
    }
    if (!value || typeof value !== 'object' || typeof value.file !== 'string' || value.feedFile !== undefined) return raw;
    const feedFile = feedFiles.get(value.file);
    if (!feedFile) return raw;
    updated++;
    // Le champ est inséré avant l'accolade finale, dans le style de la ligne
    // (certaines lignes importées sont écrites `"a": 1, "b": 2`) : rien d'autre ne bouge.
    const spaced = /"\s*:\s+/.test(raw);
    const inserted = raw.replace(
      /\s*\}\s*$/,
      `${spaced ? ', ' : ','}"feedFile"${spaced ? ': ' : ':'}${JSON.stringify(feedFile)}}`,
    );
    try {
      if (JSON.stringify(JSON.parse(inserted)) === JSON.stringify({ ...value, feedFile })) return inserted;
    } catch {
      // forme inattendue : on resérialise
    }
    return JSON.stringify({ ...value, feedFile });
  });
  return { text: lines.join('\n'), updated };
}

/** Retire `--name` (drapeau sans valeur) de la ligne de commande. */
export function takeFlag(argv: string[], name: string): { argv: string[]; present: boolean } {
  const flag = `--${name}`;
  return { argv: argv.filter((a) => a !== flag), present: argv.includes(flag) };
}

// ── Oracle ─────────────────────────────────────────────────────────────

const POSTED_FIRST =
  /^(?:the post|l[’']\s?article|cet article|der beitrag|el artículo|la entrada|l[’']articolo)\s.+?\s(?:appeared first on|first appeared on|est apparu en premier sur|est paru en premier sur|erschien zuerst auf|apareció primero en|è apparso per la prima volta su)\s.+/i;
const READ_MORE =
  /^(?:(?:next|previous) (?:article|post)\s*:|(?:read more|continue reading|keep reading|read the (?:full|rest of the|whole) (?:article|story|post)|read full (?:article|story)|lire la suite|lire l[’']article|la suite|weiterlesen|leer más|seguir leyendo|continua a leggere|leia mais)\b)/i;

/**
 * Ce qu'un flux ajoute à l'article et que la page n'a pas à reprendre : la
 * signature WordPress « The post X appeared first on Y », les liens « Read
 * more », « Continue reading », « Lire la suite », et la navigation « Next
 * article: … » / « Previous article: … » (go.dev).
 */
export function isFeedTrailer(text: string): boolean {
  const t = text.trim();
  if (POSTED_FIRST.test(t)) return true;
  return READ_MORE.test(t) && t.length <= 200;
}

/** Une phrase coupée par le flux (« … », « […] ») se compare comme un début. */
function isTruncated(sentence: string): boolean {
  return /(?:…|\.\.\.)\s*[\])]?\s*$/.test(sentence.trim());
}

function contains(haystack: string, sentence: string): boolean {
  const n = normalizeText(sentence);
  return haystack.includes(isTruncated(sentence) ? ` ${n}` : ` ${n} `);
}

function blockSentences(block: string): string[] {
  return splitSentences(escapeText(block));
}

const XML_ENTITIES = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);
const namedEntityCache = new Map<string, string>();

/**
 * Décode les entités nommées que `decodeEntities` ne connaît pas (`&rarr;`,
 * `&hearts;`…) : sans cela le flux garde « &rarr; » là où l'extrait, sérialisé
 * par le DOM, porte « → ». Les cinq entités XML restent : elles protègent le
 * balisage.
 */
function decodeNamedEntities(html: string): string {
  return html.replace(/&([a-z][a-z0-9]*);/gi, (whole, name: string) => {
    if (XML_ENTITIES.has(name.toLowerCase())) return whole;
    const known = namedEntityCache.get(name);
    if (known !== undefined) return known;
    const decoded = String(parseHTML(`<html><body><p>${whole}</p></body></html>`).document.body.textContent ?? whole);
    namedEntityCache.set(name, decoded);
    return decoded;
  });
}

/** Texte visible du corps de la page brute (en-tête et `noscript` exclus). */
export function pageVisibleText(pageHtml: string): string {
  const body = pageHtml.replace(/^[\s\S]*?<body\b[^>]*>/i, '').replace(/<head\b[\s\S]*?<\/head\s*>/i, '');
  return visibleText(decodeNamedEntities(body).replace(/<noscript\b[\s\S]*?<\/noscript\s*>/gi, ' '));
}

export interface FeedOracle {
  /** Phrases suivies (`isTracked`) que l'extrait doit contenir. */
  sentences: string[];
  /** Fragments courts (`isFragment`) que l'extrait doit contenir. */
  fragments: string[];
  /** Écartés : fin de flux (`isFeedTrailer`). */
  trailers: string[];
  /** Écartés : retraits acceptés pour cet hôte. */
  accepted: { text: string; reason: string }[];
  /** Écartés : absents du texte visible de la page (l'extracteur ne peut pas les rendre). */
  offPage: string[];
}

/**
 * Phrases et fragments du flux que l'extrait doit contenir. Sans `pageHtml`,
 * rien n'est écarté pour absence de la page.
 */
export function buildFeedOracle(feedHtml: string, host: string, accepted: AcceptedMatcher, pageHtml?: string): FeedOracle {
  const pageNorm = pageHtml === undefined ? null : ` ${normalizeText(pageVisibleText(pageHtml))} `;
  const out: FeedOracle = { sentences: [], fragments: [], trailers: [], accepted: [], offPage: [] };
  const seen = new Set<string>();
  for (const block of visibleBlocks(decodeNamedEntities(feedHtml))) {
    const trailerBlock = isFeedTrailer(block);
    for (const s of blockSentences(block)) {
      const tracked = isTracked(s);
      if (!tracked && !isFragment(s)) continue;
      const n = normalizeText(s);
      if (seen.has(n)) continue;
      seen.add(n);
      if (trailerBlock || isFeedTrailer(s)) {
        out.trailers.push(s);
        continue;
      }
      const rule = accepted.match(s, host);
      if (rule) {
        out.accepted.push({ text: s, reason: rule.reason });
        continue;
      }
      if (pageNorm !== null && !contains(pageNorm, s)) {
        out.offPage.push(s);
        continue;
      }
      (tracked ? out.sentences : out.fragments).push(s);
    }
  }
  return out;
}

export interface OracleMiss {
  missing: string[];
  missingFragments: string[];
}

/**
 * Ce que l'extrait ne contient pas de l'oracle ; un extrait `null` manque
 * tout. Le titre de l'extrait compte : un flux qui répète le titre en tête du
 * contenu ne signale pas une perte.
 */
export function oracleMisses(oracle: FeedOracle, extract: ExtractLike | null): OracleMiss {
  const hay = extract ? ` ${normalizeText(extract.title)} · ${normalizeText(visibleText(extract.content))} ` : ' ';
  return {
    missing: oracle.sentences.filter((s) => !contains(hay, s)),
    missingFragments: oracle.fragments.filter((s) => !contains(hay, s)),
  };
}

export interface OracleVerdict {
  /** `null` : côté non mesuré (délai, exception). */
  base: OracleMiss | null;
  head: OracleMiss | null;
  /** Phrases que la base rendait et que la tête manque. */
  regressions: string[];
  /** Fragments que la base rendait et que la tête manque (signalés, pas bloquants). */
  fragmentRegressions: string[];
  /** Une régression : bloque. */
  failing: boolean;
  /** La tête manque une phrase du flux (bloque avec `--oracle-strict`). */
  strictFailing: boolean;
}

/** `undefined` = côté non mesuré ; `null` = l'extracteur a rendu `null`. */
export function judgeOracle(
  oracle: FeedOracle,
  base: ExtractLike | null | undefined,
  head: ExtractLike | null | undefined,
): OracleVerdict {
  const b = base === undefined ? null : oracleMisses(oracle, base);
  const h = head === undefined ? null : oracleMisses(oracle, head);
  const regressions = b && h ? h.missing.filter((s) => !b.missing.includes(s)) : [];
  const fragmentRegressions = b && h ? h.missingFragments.filter((s) => !b.missingFragments.includes(s)) : [];
  return {
    base: b,
    head: h,
    regressions,
    fragmentRegressions,
    failing: regressions.length > 0,
    strictFailing: !!h && h.missing.length > 0,
  };
}
