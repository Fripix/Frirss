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
import { parseHTML } from 'linkedom';
import { imageIdentity } from '../../src/lib/imageIdentity.ts';

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
const PAGE_BLOCK = new RegExp(`^(?:${BLOCK_TAGS})$`);

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

/** Combien de fois chaque phrase normalisée revient, en tant que phrase. */
function sentenceCounts(html: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of splitSentences(html)) {
    const n = normalizeText(s);
    if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return counts;
}

/** Au-delà de ces caractères de fragments perdus (non acceptés), la page échoue. */
export const LOST_FRAGMENTS_LIMIT = 60;

/**
 * Occurrences de ` n ` (encadré d'espaces) dans un texte normalisé. Deux
 * occurrences voisines partagent l'espace qui les sépare : « a a » en compte deux.
 */
function occurrences(haystack: string, needle: string): number {
  let count = 0;
  const step = Math.max(1, needle.length - 1);
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + step)) count++;
  return count;
}

// ── Ce que la page montre ──────────────────────────────────────────────
// Un doublon de l'extrait n'en est pas un quand la page montre elle-même
// deux exemplaires : un avis du CERT-FR cite chaque bulletin dans un tableau
// puis dans une liste. L'outil relit donc le texte VISIBLE de la page brute.
// Visible : ni script, style, gabarit, `noscript` ; ni un élément `hidden`,
// `aria-hidden="true"`, en `display:none` ou `visibility:hidden` en ligne, ni
// sous une classe de masquage que rien ne re-montre à une taille d'écran.
// Une feuille de style externe ne se lit pas : The Verge écrit le chapeau et
// la signature une fois par mise en page, Ars Technica chaque légende dans sa
// visionneuse puis dans le `<figcaption>`, et la feuille n'en montre qu'un. Ces
// copies de mise en page ne vivent que dans l'en-tête (avant le premier
// paragraphe du corps) et dans une figure, comme pour `withoutRepeats` de
// l'extraction : là seulement elles se confondent (`pageCopies`) ; dans le
// corps, chaque exemplaire compte — un refrain, la page le montre deux fois
// (RD-06).
// Deux images de la même photo côte à côte, sans texte entre elles, comptent
// aussi pour une.

/** Éléments jamais rendus, ou dont le texte n'est pas celui de la page. */
const PAGE_UNREAD = new Set(['script', 'style', 'template', 'noscript', 'head', 'title', 'svg', 'canvas', 'iframe', 'object', 'select', 'textarea']);
/** Classes de masquage courantes ; un jeton qui ne fait qu'en contenir le mot n'en est pas une. */
const PAGE_HIDING_CLASSES = new Set(['hidden', 'invisible', 'd-none', 'is-hidden', 'sr-only', 'visually-hidden', 'screen-reader-text']);
/** Au-delà, deux exemplaires ne « se suivent » plus : ce sont deux passages de la page. */
const TWIN_MAX_SPAN = 4000;
const PAGE_SHOWN_AT_SOME_SIZE = /^(?:[a-z0-9-]+:)+(?:block|flex|grid|inline|inline-block|inline-flex|inline-grid|table|table-cell|table-row|contents|flow-root|list-item|visible|not-sr-only)$|^d-(?:sm|md|lg|xl|xxl)-(?:block|flex|grid|inline|inline-block|inline-flex|table|table-cell|table-row)$/;

interface DomLike {
  nodeType: number;
  textContent: string | null;
  tagName?: string;
  childNodes?: ArrayLike<DomLike>;
  getAttribute?(name: string): string | null;
  hasAttribute?(name: string): boolean;
}

function hiddenInPage(el: DomLike): boolean {
  if (el.hasAttribute!('hidden') || el.getAttribute!('aria-hidden') === 'true') return true;
  const style = el.getAttribute!('style') || '';
  if (/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(style)) return true;
  const tokens = (el.getAttribute!('class') || '').split(/\s+/).filter(Boolean);
  return tokens.some((t) => PAGE_HIDING_CLASSES.has(t)) && !tokens.some((t) => PAGE_SHOWN_AT_SOME_SIZE.test(t));
}

export interface PageView {
  /** Texte visible normalisé, bloc par bloc, encadré d'espaces. */
  norm: string;
  /** Positions, dans `norm`, de l'espace qui ouvre chaque bloc. */
  starts: Set<number>;
  /**
   * La zone de chaque bloc, par sa position dans `norm` : `h` avant le premier
   * paragraphe du corps (l'en-tête), `fN` dans la N-ième `<figure>`, `b` dans
   * le corps. Seules l'en-tête et une figure portent des copies de mise en
   * page (RD-06, comme `withoutRepeats` de l'extraction).
   */
  zones: Map<number, string>;
  /** Pour chaque image (identité à la taille près), ses exemplaires visibles, voisins confondus. */
  images: Map<string, number>;
}

/** Marques de fin d'un bloc et d'une figure, dans la pile du parcours. */
const BLOCK_END: DomLike = { nodeType: -1, textContent: null };
const FIGURE_END: DomLike = { nodeType: -2, textContent: null };
/** Un paragraphe de cette longueur ouvre le corps de la page (comme `BODY_MIN` de l'extraction). */
const PAGE_BODY_MIN = 200;

/** Le texte et les images que la page brute montre (voir plus haut). */
export function pageView(html: string, pageUrl?: string): PageView {
  const { document } = parseHTML(html);
  const blocks: string[] = [];
  const blockZones: string[] = [];
  const openBlocks: string[] = [];
  const figures: number[] = [];
  let figureCount = 0;
  let bodyStarted = false;
  let current = '';
  const flush = () => {
    const n = normalizeText(current);
    if (n) {
      let zone = figures.length ? `f${figures[figures.length - 1]}` : bodyStarted ? 'b' : 'h';
      // Le premier paragraphe du corps : un `<p>` hors figure assez long, ou de deux phrases.
      if (zone === 'h' && openBlocks[openBlocks.length - 1] === 'p' && (current.trim().length >= PAGE_BODY_MIN || splitBlock(current).filter(isTracked).length >= 2)) {
        bodyStarted = true;
        zone = 'b';
      }
      blocks.push(n);
      blockZones.push(zone);
    }
    current = '';
  };
  const images = new Map<string, number>();
  let lastImage: string | null = null;
  let textSinceImage = true;
  const stack: DomLike[] = [document.documentElement as unknown as DomLike];
  while (stack.length) {
    const node = stack.pop()!;
    if (node === BLOCK_END) { flush(); openBlocks.pop(); continue; }
    if (node === FIGURE_END) { figures.pop(); continue; }
    if (node.nodeType === 3) {
      const text = node.textContent || '';
      if (text.trim()) textSinceImage = true;
      current += text;
      continue;
    }
    if (node.nodeType !== 1) continue;
    const tag = (node.tagName || '').toLowerCase();
    if (PAGE_UNREAD.has(tag) || hiddenInPage(node)) continue;
    if (tag === 'img') {
      const identity = imageIdentity(node.getAttribute!('src'), pageUrl);
      if (identity) {
        if (identity !== lastImage || textSinceImage) images.set(identity, (images.get(identity) ?? 0) + 1);
        lastImage = identity;
        textSinceImage = false;
      }
      continue;
    }
    if (tag === 'figure') {
      figures.push(++figureCount);
      stack.push(FIGURE_END);
    }
    if (PAGE_BLOCK.test(tag)) {
      flush();
      openBlocks.push(tag);
      stack.push(BLOCK_END);
    }
    const children = Array.from(node.childNodes ?? []);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  flush();
  const starts = new Set<number>();
  const zones = new Map<number, string>();
  let at = 0;
  blocks.forEach((block, i) => {
    starts.add(at);
    // Sans paragraphe de corps (une page d'accueil, une liste), pas d'en-tête :
    // deux cartes signées « Par l'équipe » sont deux textes.
    zones.set(at, blockZones[i] === 'h' && !bodyStarted ? 'b' : blockZones[i]);
    at += block.length + 1;
  });
  return { norm: ` ${blocks.join(' ')} `, starts, zones, images };
}

/**
 * Exemplaires de ` n ` que la page montre. Dans le corps, chacun compte. Dans
 * l'en-tête et dans une figure, les copies de mise en page se confondent :
 * - `layout` (copies perdues) : tous les exemplaires de l'en-tête en font un,
 *   ceux d'une figure un par figure — la signature de The Verge, écrite dans
 *   chaque mise en page, peut n'apparaître qu'une fois ;
 * - `twins` (doublons nouveaux) : seulement une occurrence qui suit la
 *   précédente en la répétant tout entière (« a b a b »), alignée sur les
 *   blocs (le passage répété commence et finit avec un bloc, l'occurrence au
 *   même endroit de son bloc). Deux cartes signées « Par L'équipe Promo »
 *   sont deux textes ; « (cf. section Documentation) » suivi de l'intertitre
 *   « Documentation » aussi ; la seconde phrase d'une légende que la
 *   visionneuse et le `<figcaption>` portent toutes deux est une copie.
 */
export function pageCopies(view: Pick<PageView, 'norm' | 'starts' | 'zones'>, needle: string, mode: 'layout' | 'twins' = 'twins'): number {
  const { norm, starts, zones } = view;
  let sorted = SORTED_STARTS.get(starts);
  if (!sorted) SORTED_STARTS.set(starts, (sorted = [...starts].sort((a, b) => a - b)));
  /** Le début du bloc qui contient la position `at`. */
  const blockOf = (at: number) => {
    let lo = 0;
    let hi = sorted.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (sorted[mid] <= at) lo = mid;
      else hi = mid - 1;
    }
    return sorted[lo] ?? 0;
  };
  const zoneOf = (at: number) => zones.get(blockOf(at)) ?? 'b';
  const twins = (a: number, b: number) => {
    const blockA = blockOf(a);
    const blockB = blockOf(b);
    const zone = zones.get(blockA);
    if (!zone || zone === 'b' || zone !== zones.get(blockB) || blockA === blockB) return false;
    if (a - blockA !== b - blockB || blockB - blockA > TWIN_MAX_SPAN) return false;
    const end = 2 * blockB - blockA;
    return (starts.has(end) || end >= norm.length - 1) && norm.startsWith(norm.slice(blockA, blockB), blockB);
  };
  let count = 0;
  let previous = -1;
  const layouts = new Set<string>();
  const step = Math.max(1, needle.length - 1);
  for (let i = norm.indexOf(needle); i !== -1; i = norm.indexOf(needle, i + step)) {
    const zone = zoneOf(i);
    if (mode === 'layout' && zone !== 'b') layouts.add(zone);
    else if (!(mode === 'twins' && previous >= 0 && twins(previous, i))) count++;
    previous = i;
  }
  return count + layouts.size;
}

const SORTED_STARTS = new WeakMap<Set<number>, number[]>();

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
  /** Phrases présentes plus souvent en tête qu'en base (relevé). */
  duplicated: string[];
  /**
   * Doublons nouveaux (REG-228) : une phrase ou un fragment au moins deux fois
   * en tête, au plus une fois en base, et que la page ne montre pas deux fois
   * (`pageView`, `pageCopies`). Fait échouer la page : un doublon visible est
   * un Majeur.
   */
  newDuplicates: string[];
  /** Même règle pour une image (son identité à la taille près, `imageIdentity`) : un `src` par image. */
  duplicatedImages: string[];
  /**
   * Copies perdues (RD-06) : une phrase, un fragment ou une image (un `src`)
   * présent k ≥ 2 fois en base et au moins k fois visible dans la page, mais
   * moins de k fois en tête — un refrain réduit à une fois. Fait échouer la
   * page, sauf retrait accepté.
   */
  lostCopies: string[];
  /** Images de la base dont la photo (à la taille près) n'est plus en tête. */
  lostImages: string[];
  acceptedImages: { text: string; reason: string }[];
  baseLength: number;
  headLength: number;
  /** Chute de longueur de plus de 20 %. */
  lengthDrop: boolean;
  titleChanged: { base: string; head: string } | null;
  /** Quelque chose diffère. */
  changed: boolean;
  /** Perte non acceptée, `null` nouveau, image perdue, copie perdue ou doublon nouveau : bloque le commit. */
  failing: boolean;
}

export function compareExtracts(
  base: ExtractLike | null,
  head: ExtractLike | null,
  host: string,
  accepted: AcceptedMatcher = compileAccepted([]),
  /** HTML brut de la page : un doublon qu'elle montre elle-même n'en est pas un. Absent : la page n'est pas consultée. */
  page?: string,
  /** URL de la page, pour lire ses images relatives. */
  pageUrl?: string,
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
    const headImages = new Set(imageSources(head.content).map((src) => imageIdentity(src, pageUrl) ?? src));
    for (const src of imageSources(base.content)) {
      if (headImages.has(imageIdentity(src, pageUrl) ?? src)) continue;
      const rule = accepted.match(src, host);
      if (rule) acceptedImages.push({ text: src, reason: rule.reason });
      else lostImages.push(src);
    }
  }

  // Doublons nouveaux (REG-228), de texte puis d'images. La page n'est relue
  // que s'il y a un candidat.
  const newDuplicates: string[] = [];
  const duplicatedImages: string[] = [];
  const lostCopies: string[] = [];
  if (base && head) {
    let view: PageView | null | undefined;
    const shown = () => (view === undefined ? (view = page ? pageView(page, pageUrl) : null) : view);
    // Les phrases comptées en tant que phrases : « … 12 SP5 » n'est pas une
    // copie de « … 12 SP5 LTSS », ni un titre de la phrase « Voir le Pen <titre> ».
    const baseSentences = sentenceCounts(base.content);
    const headSentences = sentenceCounts(head.content);
    // Copies perdues : la page est relue si la tête en a moins que la base.
    const seenCopies = new Set<string>();
    for (const s of splitSentences(base.content)) {
      if (!isTracked(s) && !isFragment(s)) continue;
      const n = normalizeText(s);
      if (seenCopies.has(n)) continue;
      seenCopies.add(n);
      const needle = ` ${n} `;
      const k = baseSentences.get(n) ?? 0;
      // Découpée autrement en tête, une phrase s'y lit encore dans le texte.
      if (k < 2 || (headSentences.get(n) ?? 0) >= k || occurrences(headNorm, needle) >= k) continue;
      const v = shown();
      if (v && pageCopies(v, needle, 'layout') < k) continue;
      const rule = accepted.match(s, host);
      if (rule) acceptedList.push({ text: s, reason: rule.reason });
      else lostCopies.push(s);
    }
    const seenTwice = new Set<string>();
    for (const s of splitSentences(head.content)) {
      if (!isTracked(s) && !isFragment(s)) continue;
      const n = normalizeText(s);
      if (seenTwice.has(n)) continue;
      seenTwice.add(n);
      const needle = ` ${n} `;
      if ((headSentences.get(n) ?? 0) < 2 || occurrences(baseNorm, needle) > 1) continue;
      const v = shown();
      if (v && pageCopies(v, needle, 'twins') > 1) continue;
      newDuplicates.push(s);
    }
    const tally = (html: string) => {
      const counts = new Map<string, { n: number; src: string }>();
      for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
        const src = attr(m[0], 'src')?.trim();
        const identity = imageIdentity(src, pageUrl);
        if (!src || !identity) continue;
        const known = counts.get(identity);
        if (known) known.n++;
        else counts.set(identity, { n: 1, src });
      }
      return counts;
    };
    const baseImages = tally(base.content);
    const headImages = tally(head.content);
    for (const [identity, { n, src }] of headImages) {
      if (n < 2 || (baseImages.get(identity)?.n ?? 0) > 1) continue;
      const v = shown();
      if (v && (v.images.get(identity) ?? 0) > 1) continue;
      duplicatedImages.push(src);
    }
    for (const [identity, { n, src }] of baseImages) {
      if (n < 2 || (headImages.get(identity)?.n ?? 0) >= n) continue;
      const v = shown();
      if (v && (v.images.get(identity) ?? 0) < n) continue;
      const rule = accepted.match(src, host);
      if (rule) acceptedImages.push({ text: src, reason: rule.reason });
      else lostCopies.push(src);
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
    newDuplicates.length > 0 ||
    duplicatedImages.length > 0 ||
    lostCopies.length > 0 ||
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
    newDuplicates,
    duplicatedImages,
    lostCopies,
    lostImages,
    acceptedImages,
    baseLength,
    headLength,
    lengthDrop,
    titleChanged,
    changed,
    failing:
      newNull ||
      lost.length > 0 ||
      lostImages.length > 0 ||
      fragmentsWeigh(lostFragments) ||
      newDuplicates.length > 0 ||
      duplicatedImages.length > 0 ||
      lostCopies.length > 0,
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
