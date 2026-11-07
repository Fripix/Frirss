/**
 * Logique pure de l'outil de non-régression de l'extraction (`capture.mts`,
 * `compare.mts`). Rien ici ne touche au réseau, aux processus ni au disque :
 * tout est testé dans `lib.test.ts`.
 *
 * Règle que l'outil défend : l'extraction ne perd JAMAIS de texte d'article.
 * Laisser une publicité est acceptable ; perdre une phrase ne l'est pas, sauf
 * retrait accepté explicitement (`accepted.json`, hors dépôt).
 */
import { createHash } from 'node:crypto';

/** User-Agent d'un navigateur courant : certains sites refusent les robots. */
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

/** Nom du fichier d'une page : 16 premiers caractères du SHA-1 de son URL. */
export function pageFileName(url: string): string {
  return createHash('sha1').update(url).digest('hex').slice(0, 16) + '.html';
}

/** Hôte d'une URL, ou chaîne vide si elle ne se lit pas. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

// ── Entités HTML / XML ─────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  sbquo: '‚', bdquo: '„', hellip: '…', mdash: '—', ndash: '–', middot: '·',
  bull: '•', copy: '©', reg: '®', trade: '™', deg: '°', euro: '€',
  shy: '\u00ad', thinsp: '\u2009', ensp: '\u2002', emsp: '\u2003',
  zwnj: '\u200c', zwj: '\u200d', times: '×', divide: '÷',
  eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç',
  ocirc: 'ô', ucirc: 'û', ugrave: 'ù', icirc: 'î', iuml: 'ï', euml: 'ë',
  Eacute: 'É', Egrave: 'È', Agrave: 'À', Ccedil: 'Ç', oelig: 'œ', OElig: 'Œ',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß',
};

/** Décode les entités nommées courantes et toutes les entités numériques. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

// ── Fichier de flux ────────────────────────────────────────────────────

/** Une URL de flux par ligne ; `#` en tête de ligne = commentaire. */
export function parseFeedList(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (!out.includes(line)) out.push(line);
  }
  return out;
}

// ── Index du corpus ────────────────────────────────────────────────────

export interface IndexEntry {
  /** Absent quand la capture a échoué. */
  file?: string;
  url: string;
  finalUrl?: string;
  feed?: string;
  capturedAt: string;
  /** Code HTTP, ou `timeout` / `too-large` / `not-html` / `error`. */
  status: number | string;
  bytes?: number;
  error?: string;
}

export interface ParsedIndex {
  entries: IndexEntry[];
  errors: { line: number; message: string }[];
}

/** Lit `index.jsonl` : une entrée JSON par ligne, lignes vides ignorées. */
export function parseIndex(text: string): ParsedIndex {
  const entries: IndexEntry[] = [];
  const errors: ParsedIndex['errors'] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    try {
      const value = JSON.parse(line) as Partial<IndexEntry> | null;
      if (!value || typeof value !== 'object' || typeof value.url !== 'string' || !value.url) {
        errors.push({ line: i + 1, message: 'entrée sans url' });
        return;
      }
      if (value.file !== undefined && typeof value.file !== 'string') {
        errors.push({ line: i + 1, message: 'file doit être une chaîne' });
        return;
      }
      entries.push(value as IndexEntry);
    } catch (err) {
      errors.push({ line: i + 1, message: (err as Error).message });
    }
  });
  return { entries, errors };
}

/** URL déjà capturées avec succès : on ne les recapture pas. */
export function capturedUrls(entries: IndexEntry[]): Set<string> {
  return new Set(entries.filter((e) => e.file).map((e) => e.url));
}

/** Pages comparables : celles qui ont un fichier, une fois chacune (la dernière ligne gagne). */
export function comparablePages(entries: IndexEntry[]): IndexEntry[] {
  const byFile = new Map<string, IndexEntry>();
  for (const e of entries) {
    if (!e.file) continue;
    byFile.delete(e.file);
    byFile.set(e.file, e);
  }
  return [...byFile.values()];
}

// ── Lecture d'un flux RSS / Atom ───────────────────────────────────────

export interface FeedItem {
  link: string;
  /** Horodatage en ms, ou `null` si le flux n'en donne pas de lisible. */
  date: number | null;
}

function unwrapCdata(text: string): string {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function xmlText(text: string): string {
  return decodeEntities(unwrapCdata(text)).trim();
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? decodeEntities(m[1] ?? m[2] ?? '') : null;
}

function absolute(link: string, base: string | undefined): string | null {
  try {
    const u = base ? new URL(link, base) : new URL(link);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

function itemLink(block: string): string | null {
  // FeedBurner : le vrai lien de l'article, `link` n'étant qu'une redirection.
  const orig = /<(?:[\w-]+:)?origLink\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?origLink\s*>/i.exec(block);
  if (orig && xmlText(orig[1])) return xmlText(orig[1]);

  let atomFallback: string | null = null;
  const linkTag = /<(?:atom:)?link\b([^>]*?)(\/?)>/gi;
  for (let m = linkTag.exec(block); m; m = linkTag.exec(block)) {
    const attrs = m[1];
    const href = attr(attrs, 'href');
    if (href !== null) {
      // Atom : `rel="alternate"` ou pas de `rel` du tout.
      const rel = (attr(attrs, 'rel') ?? 'alternate').toLowerCase();
      if (rel !== 'alternate') continue;
      const type = (attr(attrs, 'type') ?? '').toLowerCase();
      if (!type || type.includes('html')) return href.trim();
      atomFallback ??= href.trim();
      continue;
    }
    if (m[2] === '/') continue;
    // RSS : le lien est le texte de l'élément.
    const rest = block.slice(linkTag.lastIndex);
    const close = /<\/(?:atom:)?link\s*>/i.exec(rest);
    if (close) {
      const text = xmlText(rest.slice(0, close.index));
      if (text) return text;
    }
  }
  if (atomFallback) return atomFallback;

  const guid = /<guid\b([^>]*)>([\s\S]*?)<\/guid\s*>/i.exec(block);
  if (guid && (attr(guid[1], 'isPermaLink') ?? 'true').toLowerCase() !== 'false') {
    const text = xmlText(guid[2]);
    if (/^https?:\/\//i.test(text)) return text;
  }
  return null;
}

function itemDate(block: string): number | null {
  for (const name of ['pubDate', 'published', 'updated', 'date', 'issued', 'modified']) {
    const m = new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}\\s*>`, 'i').exec(block);
    if (!m) continue;
    const t = Date.parse(xmlText(m[1]));
    if (Number.isFinite(t)) return t;
  }
  return null;
}

/** Articles d'un flux RSS 2.0, RSS 1.0 ou Atom, dans l'ordre du flux. */
export function parseFeedItems(xml: string, feedUrl?: string): FeedItem[] {
  const text = xml.replace(/<!--[\s\S]*?-->/g, '');
  const out: FeedItem[] = [];
  const seen = new Set<string>();
  const block = /<((?:[\w-]+:)?(?:item|entry))\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  for (let m = block.exec(text); m; m = block.exec(text)) {
    const raw = itemLink(m[2]);
    const link = raw ? absolute(raw, feedUrl) : null;
    if (!link || seen.has(link)) continue;
    seen.add(link);
    out.push({ link, date: itemDate(m[2]) });
  }
  return out;
}

export interface PickOptions {
  perFeed: number;
  maxAgeDays: number;
  now: number;
  exclude: Set<string>;
}

/**
 * Les `perFeed` articles les plus récents pas encore capturés. Un flux dont
 * chaque article est daté est trié du plus récent au plus ancien ; sinon
 * l'ordre du flux est gardé (les flux mettent le plus récent en tête). Un
 * article daté de plus de `maxAgeDays` est écarté ; un article sans date reste.
 */
export function pickRecent(items: FeedItem[], opts: PickOptions): string[] {
  const oldest = opts.now - opts.maxAgeDays * 86_400_000;
  let list = items.filter((i) => !opts.exclude.has(i.link) && (i.date === null || i.date >= oldest));
  if (list.length && list.every((i) => i.date !== null)) {
    list = [...list].sort((a, b) => (b.date as number) - (a.date as number));
  }
  return list.slice(0, Math.max(0, opts.perFeed)).map((i) => i.link);
}

// ── Texte visible d'un extrait ─────────────────────────────────────────

/** Éléments dont le bord termine une phrase, même sans ponctuation. */
const BLOCK_TAGS =
  'p|li|h[1-6]|td|th|blockquote|figcaption|br|div|tr|dt|dd|pre|figure|section|article|header|footer|aside|nav|ul|ol|dl|table|caption|hr|summary|details|main';
const BLOCK_RE = new RegExp(`<\\/?(?:${BLOCK_TAGS})\\b[^>]*>`, 'gi');

/** Blocs de texte visible : balises retirées, entités décodées, blancs normalisés. */
export function visibleBlocks(html: string): string[] {
  const text = decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style|template)\b[\s\S]*?<\/\1\s*>/gi, '')
      .replace(BLOCK_RE, '\n')
      .replace(/<[^>]*>/g, ''),
  );
  return text
    .split('\n')
    .map((b) => b.replace(/[\s\u00ad\u200b]+/g, ' ').trim())
    .filter(Boolean);
}

/** Texte visible d'un seul tenant (sert aux longueurs). */
export function visibleText(html: string): string {
  return visibleBlocks(html).join(' ');
}

/** Ponctuation qui termine une phrase seulement suivie d'un blanc ou de la fin. */
const SPACED_ENDS = new Set(['.', '!', '?', '…', '؟']);
/** Ponctuation pleine chasse : termine une phrase sans blanc derrière. */
const WIDE_ENDS = new Set(['。', '！', '？']);
/** Guillemets et parenthèses fermants qui restent collés à la fin de phrase. */
const CLOSERS = new Set(['"', "'", '”', '’', '»', ')', ']', '）', '」', '』', '》', '〉', '】']);

function splitBlock(block: string): string[] {
  const chars = [...block];
  const out: string[] = [];
  let start = 0;
  let i = 0;
  while (i < chars.length) {
    const c = chars[i];
    if (WIDE_ENDS.has(c) || SPACED_ENDS.has(c)) {
      let j = i + 1;
      while (j < chars.length && (WIDE_ENDS.has(chars[j]) || SPACED_ENDS.has(chars[j]))) j++;
      while (j < chars.length && CLOSERS.has(chars[j])) j++;
      const wide = WIDE_ENDS.has(c);
      if (wide || j >= chars.length || /\s/.test(chars[j])) {
        const s = chars.slice(start, j).join('').trim();
        if (s) out.push(s);
        start = j;
      }
      i = j;
      continue;
    }
    i++;
  }
  const tail = chars.slice(start).join('').trim();
  if (tail) out.push(tail);
  return out;
}

/** Phrases du texte visible : ponctuation forte et fins de bloc. */
export function splitSentences(html: string): string[] {
  return visibleBlocks(html).flatMap(splitBlock);
}

/** Forme comparable : NFKC, minuscules, ponctuation et blancs réduits à une espace. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\s\u00ad\u200b]+/gu, ' ')
    .trim();
}

const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/gu;

/** Une écriture sans espaces entre les mots (chinois, japonais, thaï…). */
export function isNoSpaceScript(text: string): boolean {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  if (!letters) return false;
  const wide = text.match(NO_SPACE_SCRIPT)?.length ?? 0;
  return wide / letters >= 0.3;
}

/** Longueur minimale d'une phrase surveillée : 25 caractères, 8 sans espaces. */
export function isTracked(sentence: string): boolean {
  const n = [...normalizeText(sentence)].length;
  return n >= (isNoSpaceScript(sentence) ? 8 : 25);
}

/**
 * Fragment court surveillé : de 12 caractères jusqu'au seuil d'une phrase,
 * hors écritures sans espaces. Un mot isolé (« Partager », « Lire aussi »)
 * n'en est pas un ; une ligne de liste ou un intertitre court, si.
 */
export function isFragment(sentence: string): boolean {
  if (isTracked(sentence) || isNoSpaceScript(sentence)) return false;
  return [...normalizeText(sentence)].length >= 12;
}

/** Au-delà de ces caractères de fragments perdus (non acceptés), la page échoue. */
export const LOST_FRAGMENTS_LIMIT = 60;

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) count++;
  return count;
}

// ── Retraits acceptés ──────────────────────────────────────────────────

export interface AcceptedRule {
  /** `/regex/drapeaux`, ou une sous-chaîne (insensible à la casse et à la ponctuation). */
  pattern: string;
  reason: string;
  /** Hôte (et ses sous-domaines) auquel la règle se limite. */
  scope?: string;
}

export interface AcceptedMatcher {
  match(text: string, host: string): AcceptedRule | null;
}

/** Lit `accepted.json` : un tableau de règles. Lève une erreur si une règle est mal formée. */
export function parseAccepted(json: string): AcceptedRule[] {
  const value = JSON.parse(json) as unknown;
  if (!Array.isArray(value)) throw new Error('accepted : un tableau de règles est attendu');
  return value.map((r, i) => {
    const rule = r as Partial<AcceptedRule> | null;
    if (!rule || typeof rule.pattern !== 'string' || !rule.pattern) {
      throw new Error(`accepted[${i}] : pattern manquant`);
    }
    if (typeof rule.reason !== 'string' || !rule.reason.trim()) {
      throw new Error(`accepted[${i}] : reason manquante`);
    }
    if (rule.scope !== undefined && (typeof rule.scope !== 'string' || !rule.scope)) {
      throw new Error(`accepted[${i}] : scope doit être un hôte`);
    }
    return { pattern: rule.pattern, reason: rule.reason, ...(rule.scope ? { scope: rule.scope } : {}) };
  });
}

function inScope(host: string, scope: string | undefined): boolean {
  if (!scope) return true;
  const s = scope.toLowerCase();
  return host === s || host.endsWith('.' + s);
}

export function compileAccepted(rules: AcceptedRule[]): AcceptedMatcher {
  const compiled = rules.map((rule) => {
    const rx = /^\/(.+)\/([a-z]*)$/s.exec(rule.pattern);
    if (rx) {
      const re = new RegExp(rx[1], rx[2]);
      return { rule, test: (t: string) => re.test(t) };
    }
    const lower = rule.pattern.toLowerCase();
    const norm = normalizeText(rule.pattern);
    return {
      rule,
      test: (t: string) => t.toLowerCase().includes(lower) || (norm !== '' && normalizeText(t).includes(norm)),
    };
  });
  return {
    match(text, host) {
      for (const c of compiled) if (inScope(host, c.rule.scope) && c.test(text)) return c.rule;
      return null;
    },
  };
}

// ── Comparaison de deux extraits ───────────────────────────────────────

export interface ExtractLike {
  title: string;
  content: string;
}

/** `src` des images d'un extrait (les `data:` exclus : ce sont des espaces réservés). */
export function imageSources(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const src = attr(m[0], 'src');
    if (src && src.trim() && !/^data:/i.test(src.trim()) && !out.includes(src.trim())) out.push(src.trim());
  }
  return out;
}

export interface PageDiff {
  baseNull: boolean;
  headNull: boolean;
  /** La base extrayait, la tête rend `null`. */
  newNull: boolean;
  /** Phrases perdues, non acceptées. */
  lost: string[];
  /** Fragments courts perdus, non acceptés (voir `isFragment`). */
  lostFragments: string[];
  accepted: { text: string; reason: string }[];
  gained: string[];
  /** Phrases présentes plus souvent en tête qu'en base. */
  duplicated: string[];
  lostImages: string[];
  acceptedImages: { text: string; reason: string }[];
  baseLength: number;
  headLength: number;
  /** Chute de longueur de plus de 20 %. */
  lengthDrop: boolean;
  titleChanged: { base: string; head: string } | null;
  /** Quelque chose diffère. */
  changed: boolean;
  /** Perte non acceptée, `null` nouveau ou image perdue : bloque le commit. */
  failing: boolean;
}

export function compareExtracts(
  base: ExtractLike | null,
  head: ExtractLike | null,
  host: string,
  accepted: AcceptedMatcher = compileAccepted([]),
): PageDiff {
  const baseText = base ? visibleText(base.content) : '';
  const headText = head ? visibleText(head.content) : '';
  const baseNorm = ` ${normalizeText(baseText)} `;
  const headNorm = ` ${normalizeText(headText)} `;

  const lost: string[] = [];
  const lostFragments: string[] = [];
  const acceptedList: PageDiff['accepted'] = [];
  const duplicated: string[] = [];
  const gained: string[] = [];

  if (base && head) {
    const seen = new Set<string>();
    for (const s of splitSentences(base.content)) {
      if (isFragment(s)) {
        const n = normalizeText(s);
        if (seen.has(n)) continue;
        seen.add(n);
        if (occurrences(headNorm, ` ${n} `) === 0) {
          const rule = accepted.match(s, host);
          if (rule) acceptedList.push({ text: s, reason: rule.reason });
          else lostFragments.push(s);
        }
        continue;
      }
      if (!isTracked(s)) continue;
      const n = normalizeText(s);
      if (seen.has(n)) continue;
      seen.add(n);
      const needle = ` ${n} `;
      const inHead = occurrences(headNorm, needle);
      if (inHead === 0) {
        const rule = accepted.match(s, host);
        if (rule) acceptedList.push({ text: s, reason: rule.reason });
        else lost.push(s);
      } else if (inHead > occurrences(baseNorm, needle)) {
        duplicated.push(s);
      }
    }
    const seenHead = new Set<string>();
    for (const s of splitSentences(head.content)) {
      if (!isTracked(s)) continue;
      const n = normalizeText(s);
      if (seenHead.has(n)) continue;
      seenHead.add(n);
      if (!baseNorm.includes(` ${n} `)) gained.push(s);
    }
  }

  const lostImages: string[] = [];
  const acceptedImages: PageDiff['acceptedImages'] = [];
  if (base && head) {
    const headImages = new Set(imageSources(head.content));
    for (const src of imageSources(base.content)) {
      if (headImages.has(src)) continue;
      const rule = accepted.match(src, host);
      if (rule) acceptedImages.push({ text: src, reason: rule.reason });
      else lostImages.push(src);
    }
  }

  const baseLength = baseText.length;
  const headLength = headText.length;
  const lengthDrop = !!base && !!head && baseLength > 0 && headLength < baseLength * 0.8;
  const titleChanged =
    base && head && base.title.trim() !== head.title.trim() ? { base: base.title, head: head.title } : null;
  const newNull = !!base && !head;

  const changed =
    (!base) !== (!head) ||
    lost.length > 0 ||
    lostFragments.length > 0 ||
    acceptedList.length > 0 ||
    gained.length > 0 ||
    duplicated.length > 0 ||
    lostImages.length > 0 ||
    acceptedImages.length > 0 ||
    lengthDrop ||
    titleChanged !== null;

  return {
    baseNull: !base,
    headNull: !head,
    newNull,
    lost,
    lostFragments,
    accepted: acceptedList,
    gained,
    duplicated,
    lostImages,
    acceptedImages,
    baseLength,
    headLength,
    lengthDrop,
    titleChanged,
    changed,
    failing: newNull || lost.length > 0 || lostImages.length > 0 || fragmentsWeigh(lostFragments),
  };
}

function fragmentsWeigh(fragments: string[]): boolean {
  return fragments.reduce((sum, f) => sum + [...normalizeText(f)].length, 0) >= LOST_FRAGMENTS_LIMIT;
}

// ── Arguments de ligne de commande ─────────────────────────────────────

/** `--clé valeur` → `{ clé: valeur }` ; une option répétée garde la dernière. */
export function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`argument inattendu : ${a}`);
    const eq = a.indexOf('=');
    if (eq > 2) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) throw new Error(`valeur manquante pour ${a}`);
    out[a.slice(2)] = next;
    i++;
  }
  return out;
}
