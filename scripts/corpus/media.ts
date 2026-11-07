/**
 * Mesure absolue des MÉDIAS de l'extraction (`compare.mts`) : ce que l'article
 * montre — images, vidéos, sons, vidéos intégrées, tweets, citations,
 * questions repliables (`<details>`), tableaux — et ce que l'extrait en rend.
 *
 * Pourquoi : le texte est mesuré (phrases, oracle du flux), les médias ne
 * l'étaient que RELATIVEMENT à la base (`lostImages`). Le contrôle en direct de
 * l'image a90032f a trouvé une famille que l'outil ne voyait pas : les
 * questions d'une FAQ de Clubic perdues (leurs réponses restaient), deux
 * photos d'un dossier de Clubic perdues (une `<picture>` paresseuse sans
 * `<img>`), les vidéos et citations du blog de DeepMind (des éléments
 * personnalisés dont les attributs portent la vidéo et la citation), une
 * vidéo YouTube de Numerama dont l'adresse n'est que dans `data-src`. La base
 * les perdait aussi : invisibles pour une comparaison entre versions.
 *
 * Logique pure, testée dans `media.test.ts`. Rien ici ne touche au disque.
 */
import { parseHTML } from 'linkedom';
import { imageIdentity } from '../../src/lib/imageIdentity.ts';
import { compileAccepted, hiddenInPage, normalizeText, type AcceptedMatcher } from './lib.ts';

export type MediaKind = 'image' | 'video' | 'audio' | 'embed' | 'tweet' | 'quote' | 'details' | 'table';
export const MEDIA_KINDS: MediaKind[] = ['image', 'video', 'audio', 'embed', 'tweet', 'quote', 'details', 'table'];

export interface MediaItem {
  kind: MediaKind;
  /** Ce qui l'identifie : variantes d'une image (à la taille près), id d'une vidéo, début d'un texte. */
  ids: string[];
  /** Pour le rapport et `accepted.json` : une adresse absolue ou un début de texte. */
  label: string;
}

/** Adresse absolue pour le rapport (la règle d'`accepted.json` porte sur elle), telle quelle sinon. */
function absoluteLabel(address: string, base?: string): string {
  try { return new URL(address, base).href; } catch { return address; }
}

/** Les médias d'un extrait, prêts à la recherche. */
export interface ExtractMedia {
  ids: Record<MediaKind, Set<string>>;
  /** Textes normalisés des citations, tableaux, et texte entier (questions). */
  quotes: string[];
  tables: string[];
  text: string;
}

// ── Lecture commune ────────────────────────────────────────────────────

/** Ce que la lecture utilise d'un nœud et d'un élément de linkedom (pas de DOM dans ce `tsconfig`). */
interface N {
  nodeType: number;
  textContent: string | null;
  childNodes: ArrayLike<N>;
}
interface El extends N {
  tagName: string;
  attributes: ArrayLike<{ name: string; value: string }>;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  parentElement: El | null;
  closest(selector: string): El | null;
  querySelector(selector: string): El | null;
  querySelectorAll(selector: string): ArrayLike<El>;
  firstElementChild: El | null;
  nextElementSibling: El | null;
  previousElementSibling: El | null;
  contains(other: El): boolean;
}
interface Doc {
  documentElement: El | null;
  title: string;
  querySelector(selector: string): El | null;
  querySelectorAll(selector: string): ArrayLike<El>;
}

/** Une image plus petite que ceci (déclarée) est une icône, un logo, un avatar. */
const ICON_MAX = 100;
/** Un nom qui désigne une icône, un logo, un avatar, un pixel. */
const ICON_NAME = /(?:^|[^a-z])(?:logos?|avatars?|gravatar|icons?|icones?|emojis?|spinner|pixel|sprites?|badges?)(?:[^a-z]|$)/i;
const VIDEO_FILE = /\.(?:mp4|webm|m4v|mov|ogv)(?:[?#]|$)/i;
/** Hors de l'article même dans son conteneur : navigation, pied, formulaires, encarts. */
const OUTSIDE = new Set(['nav', 'footer', 'form', 'aside', 'script', 'style', 'template', 'head', 'button', 'select', 'textarea']);
const OUTSIDE_ROLES = new Set(['navigation', 'complementary', 'contentinfo']);
const OUTSIDE_TOKENS = new Set(['related', 'comment', 'comments', 'commentaires', 'breadcrumb', 'breadcrumbs', 'newsletter', 'share', 'sharing', 'tts']);
const QUOTE_MIN = 20;
const KEY_LENGTH = 60;

function isPlaceholder(value: string | null): boolean {
  const v = (value || '').trim();
  return !v || (/^data:/i.test(v) && !/^data:[^,]*;base64,/i.test(v)) || /^about:blank$/i.test(v);
}

function srcsetCandidates(value: string | null): string[] {
  return (value || '').split(/,\s+|,(?=\S+\s+\d)/).map((c) => c.trim().split(/\s+/)[0]).filter(Boolean);
}

function ids(addresses: Array<string | null>, base?: string): string[] {
  const out: string[] = [];
  for (const a of addresses) {
    const id = imageIdentity(a, base);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function declaredSmall(el: El): boolean {
  return ['width', 'height'].some((name) => {
    const size = parseInt(el.getAttribute(name) || '', 10);
    return Number.isFinite(size) && size > 0 && size < ICON_MAX;
  });
}

/** Taille qu'une adresse demande (`-192x192`, `w=150`, `/size/w30/`), ou `null`. */
function urlSize(address: string): number | null {
  const suffix = /-(\d{2,4})x(\d{2,4})(?=\.[a-z0-9]+(?:[?#]|$))/i.exec(address);
  if (suffix) return Math.max(Number(suffix[1]), Number(suffix[2]));
  const param = /[?&](?:w|width)=(\d{1,4})(?:&|$)/i.exec(address) ?? /\/size\/w(\d{1,4})\//i.exec(address);
  return param ? Number(param[1]) : null;
}

/** Sous cette taille demandée par TOUTES ses adresses, une image est une vignette (carte, avatar). */
const THUMB_MAX = 250;

/** Une image déclarée au moins aussi grande que ceci n'est jamais une icône ni une vignette (RM-06). */
const LARGE_MIN = 300;

function declaredSize(el: El): number | null {
  const sizes = ['width', 'height'].map((name) => parseInt(el.getAttribute(name) || '', 10)).filter((n) => Number.isFinite(n) && n > 0);
  return sizes.length ? Math.max(...sizes) : null;
}

function iconLike(el: El, addresses: string[]): boolean {
  const first = addresses[0];
  if (/\.svg(?:[?#]|$)/i.test(first) || /^data:image\/svg/i.test(first)) return true;
  if (declaredSmall(el)) return true;
  // Une grande image déclarée est une photo, quels que soient son nom et sa requête (RM-06 :
  // « Pixel 10 », « nouveau logo », un `?w=240` sur une image de 1536 px).
  const declared = declaredSize(el);
  if (declared !== null && declared >= LARGE_MIN) return false;
  if (addresses.every((a) => { const size = urlSize(a); return size !== null && size < THUMB_MAX; })) return true;
  // Le nom ne juge que la classe, d'une image petite ou sans taille.
  return ICON_NAME.test(el.getAttribute('class') || '');
}

/** Le bloc de la signature : un nom de classe ou d'id fait d'« author » ou de « byline » (pas un mot du milieu). */
const BYLINE_TOKEN = /^(?:[a-z]+[-_])?(?:author|authors|byline)(?:[-_](?:bio|box|info|avatar|photo|image|img|picture|name|meta|card|profile|wrapper|block|details))?$/i;
/** Au-delà de ce texte, un bloc qui s'appelle « author-box » est un conteneur, pas une signature. */
const BYLINE_TEXT_MAX = 600;

/** Identifiant d'une vidéo intégrée (YouTube, Vimeo, Dailymotion), ou `null`. */
export function embedId(address: string | null): string | null {
  const a = (address || '').trim();
  let m = /(?:youtube(?:-nocookie)?\.com\/(?:embed|v|shorts)\/|youtu\.be\/|youtube\.com\/watch\?(?:[^#]*&)?v=)([A-Za-z0-9_-]{11})/i.exec(a);
  if (m) return `youtube:${m[1]}`;
  m = /player\.vimeo\.com\/video\/(\d+)|vimeo\.com\/(\d+)/i.exec(a);
  if (m) return `vimeo:${m[1] ?? m[2]}`;
  m = /dailymotion\.com\/(?:embed\/)?video\/([a-z0-9]+)|dai\.ly\/([a-z0-9]+)/i.exec(a);
  if (m) return `dailymotion:${m[1] ?? m[2]}`;
  return null;
}

function tweetId(el: El): string | null {
  for (const a of Array.from(el.querySelectorAll('a[href]')) as El[]) {
    const m = /(?:twitter|x)\.com\/[^/]+\/status(?:es)?\/(\d+)/i.exec(a.getAttribute('href') || '');
    if (m) return `tweet:${m[1]}`;
  }
  return null;
}

function isTweet(el: El): boolean {
  return /(?:^|\s)(?:twitter-tweet|twitter-video)(?:\s|$)/i.test(el.getAttribute('class') || '');
}

/** Une intégration d'un autre réseau (Instagram, TikTok…) : pas une citation. */
function isSocialEmbed(el: El): boolean {
  return /instagram|tiktok|bluesky|mastodon|threads|reddit|facebook/i.test(`${el.getAttribute('class') || ''} ${el.getAttribute('data-instgrm-permalink') || ''} ${el.getAttribute('cite') || ''}`);
}

const textKey = (text: string) => normalizeText(text).slice(0, KEY_LENGTH).trim();

/** Le texte lu d'un élément : ni script, ni style, ni gabarit, ni dessin. */
function readText(el: El): string {
  let out = '';
  // `null` : la fin d'un élément de bloc, qui sépare deux textes (« …Royaume-Uni » puis « Mon forfait… »).
  const stack: Array<N | null> = [el];
  while (stack.length) {
    const node = stack.pop();
    if (node === null) { out += ' '; continue; }
    if (node!.nodeType === 3) { out += node!.textContent || ''; continue; }
    if (node!.nodeType !== 1 || ['script', 'style', 'template', 'svg', 'noscript'].includes((node as El).tagName.toLowerCase())) continue;
    if (!INLINE.has((node as El).tagName.toLowerCase())) { out += ' '; stack.push(null); }
    const children = Array.from(node!.childNodes);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Éléments en ligne : leur texte se colle à celui de leurs voisins. */
const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'dfn', 'em', 'i', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr', 'font']);

/** Une vidéo de fond : lecture automatique en boucle, sans contrôles — `isDecorativeVideo` de l'extraction (RM-07). */
export function isDecorativeVideo(el: El): boolean {
  return el.hasAttribute('autoplay') && el.hasAttribute('loop') && !el.hasAttribute('controls');
}

// ── Le conteneur de l'article dans la page ─────────────────────────────

function textLength(root: El): number {
  let n = 0;
  const stack: N[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.nodeType === 3) { n += (node.textContent || '').replace(/\s+/g, ' ').trim().length; continue; }
    if (node.nodeType !== 1) continue;
    const el = node as El;
    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'template', 'noscript', 'head'].includes(tag) || (el !== root && hiddenInPage(el as never))) continue;
    for (const c of Array.from(el.childNodes)) stack.push(c);
  }
  return n;
}

function outermost(found: El[], selector: string): El[] {
  return found.filter((el) => !el.parentElement?.closest(selector));
}

/**
 * Le conteneur de l'article, comme `articleContainer` de l'extraction : un
 * `[itemprop=articleBody]` dominant, sinon un `<article>` de premier niveau
 * qui porte 35 % du texte et deux fois le suivant, sinon un `<main>` ou un
 * `[role=main]` unique. `null` : pas de mesure (page de liste, page nue).
 */
export function mediaContainer(document: Doc): El | null {
  const root = document.documentElement as unknown as El | null;
  if (!root) return null;
  const sorted = (list: El[]) => list.map((el) => ({ el, n: textLength(el) })).sort((a, b) => b.n - a.n);
  const sel = '[itemprop~="articleBody"]';
  const bodies = sorted(outermost(Array.from(root.querySelectorAll(sel)) as El[], sel)).filter((b) => b.n >= 200);
  if (bodies.length) return bodies[0].n >= 2 * (bodies[1]?.n ?? 0) ? bodies[0].el : null;
  const articles = sorted(outermost(Array.from(root.querySelectorAll('article')) as El[], 'article'));
  if (articles.length && articles[0].n > 0 && articles[0].n >= 0.35 * textLength(root) && articles[0].n >= 2 * (articles[1]?.n ?? 0)) return articles[0].el;
  for (const selector of ['main', '[role="main"]']) {
    const found = root.querySelectorAll(selector);
    if (found.length === 1) return found[0] as El;
  }
  return null;
}

/** Le `<h1>` du titre de la page (`og:title`, sinon `<title>`), hors du conteneur. */
function titleOutside(document: Doc, container: El): El | null {
  const named = normalizeText((document.querySelector('meta[property="og:title"]')?.getAttribute('content') || document.title || ''));
  if (!named) return null;
  for (const h1 of Array.from(document.querySelectorAll('h1')) as El[]) {
    if (container.contains(h1)) return null;
    const t = normalizeText(h1.textContent || '');
    if (t && (named.includes(t) || t.includes(named))) return h1;
  }
  return null;
}

/** La signature de l'auteur : `rel=author`, `itemprop=author`, ou un bloc court nommé comme elle (RM-06). */
function isBylineBlock(el: El): boolean {
  if (/(?:^|\s)author(?:\s|$)/i.test(el.getAttribute('rel') || '') || /author/i.test(el.getAttribute('itemprop') || '')) return true;
  const tokens = `${el.getAttribute('class') || ''} ${el.getAttribute('id') || ''}`.split(/\s+/).filter(Boolean);
  return tokens.some((t) => BYLINE_TOKEN.test(t)) && textLength(el) <= BYLINE_TEXT_MAX;
}

// ── Les médias d'un arbre ──────────────────────────────────────────────

interface Walk {
  /** Lire la page (conteneur, masqués, adresses de réserve) ou un extrait (ce que le lecteur montre). */
  page: boolean;
  base?: string;
}

function imageItem(img: El, w: Walk): MediaItem | null {
  const own: Array<string | null> = [];
  const src = img.getAttribute('src');
  if (!isPlaceholder(src)) own.push(src);
  own.push(...srcsetCandidates(img.getAttribute('srcset')));
  const picture = img.parentElement?.tagName.toLowerCase() === 'picture' ? img.parentElement : null;
  if (picture) for (const s of Array.from(picture.querySelectorAll('source')) as El[]) own.push(...srcsetCandidates(s.getAttribute('srcset')));
  if (w.page) {
    for (const name of ['data-src', 'data-lazy-src', 'data-original', 'data-url']) own.push(img.getAttribute(name));
    own.push(...srcsetCandidates(img.getAttribute('data-srcset')));
    if (picture) for (const s of Array.from(picture.querySelectorAll('source')) as El[]) own.push(...srcsetCandidates(s.getAttribute('data-srcset')));
  }
  const usable = own.filter((a): a is string => !!a && !isPlaceholder(a));
  if (!usable.length || iconLike(img, usable)) return null;
  const found = ids(usable, w.base);
  const shown = usable.find((a) => imageIdentity(a, w.base));
  return found.length && shown ? { kind: 'image', ids: found, label: absoluteLabel(shown, w.base) } : null;
}

function videoItem(video: El, w: Walk): MediaItem | null {
  if (w.page && isDecorativeVideo(video)) return null;
  const addresses: Array<string | null> = [video.getAttribute('src')];
  for (const s of Array.from(video.querySelectorAll('source')) as El[]) addresses.push(s.getAttribute('src'));
  if (w.page) {
    addresses.push(video.getAttribute('data-src'));
    for (const s of Array.from(video.querySelectorAll('source')) as El[]) addresses.push(s.getAttribute('data-src'));
  }
  const usable = addresses.filter((a): a is string => !!a && !isPlaceholder(a));
  const found = ids(usable, w.base);
  if (found.length) return { kind: video.tagName.toLowerCase() === 'audio' ? 'audio' : 'video', ids: found, label: absoluteLabel(usable[0], w.base) };
  return null;
}

/** Une vidéo qu'un élément personnalisé porte dans un attribut (`or-mp4-video-url` du blog de Google). */
function attributeVideo(el: El, w: Walk): MediaItem | null {
  const tag = el.tagName.toLowerCase();
  if (!tag.includes('-')) return null;
  for (const attr of Array.from(el.attributes)) {
    if (/^(?:href|src|poster|data-src)$/i.test(attr.name)) continue;
    if (VIDEO_FILE.test(attr.value.trim()) && /^(?:https?:)?\/\//i.test(attr.value.trim())) {
      const found = ids([attr.value], w.base);
      if (found.length) return { kind: 'video', ids: found, label: absoluteLabel(attr.value.trim(), w.base) };
    }
  }
  return null;
}

function quoteKeyOf(text: string): string | null {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length >= QUOTE_MIN ? textKey(t) : null;
}

/**
 * Les médias sous `root`, dans l'ordre, sans doublon (une même photo écrite
 * deux fois par la page n'est qu'un média). `from` / `until` : ne compter
 * qu'à partir de ce nœud (le titre) et jusqu'à la fin de celui-ci (le
 * conteneur), quand on lit un ancêtre remonté jusqu'au titre.
 */
function collect(root: El, w: Walk, from?: El | null, until?: El | null): MediaItem[] {
  const out: MediaItem[] = [];
  const push = (item: MediaItem | null) => {
    if (!item) return;
    const twin = out.find((o) => o.kind === item.kind && o.ids.some((id) => item.ids.includes(id)));
    if (twin) { for (const id of item.ids) if (!twin.ids.includes(id)) twin.ids.push(id); return; }
    out.push(item);
  };
  let counting = !from;
  let done = false;
  const visit = (el: El, inNoscript: boolean) => {
    if (done) return;
    if (from && el === from) counting = true;
    const tag = el.tagName.toLowerCase();
    if (w.page) {
      if (el !== root && hiddenInPage(el as never)) return;
      if (OUTSIDE.has(tag) || OUTSIDE_ROLES.has((el.getAttribute('role') || '').toLowerCase())) return;
      const tokens = `${el.getAttribute('class') || ''} ${el.getAttribute('id') || ''}`.toLowerCase().split(/[^a-z0-9]+/);
      if (el !== root && tokens.some((t) => OUTSIDE_TOKENS.has(t))) return;
      // La signature de l'auteur (sa photo), comme `BYLINE_SIGNALS` de l'extraction.
      if (el !== root && isBylineBlock(el)) return;
    } else if (['script', 'style', 'template', 'noscript'].includes(tag)) {
      return;
    }
    if (inNoscript && !w.page) return;
    if (counting) {
      if (tag === 'img') {
        push(imageItem(el, w));
      } else if (tag === 'noscript') {
        // L'image de repli ne compte que si rien à côté ne montre d'image : une
        // `<picture>` paresseuse sans `<img>` (Clubic) n'a qu'elle.
        const parent = el.parentElement;
        const shown = parent && (Array.from(parent.querySelectorAll('img')) as El[]).some((img) => !img.closest('noscript'));
        const before = el.previousElementSibling;
        if (shown || (before && (before.tagName.toLowerCase() === 'img' || before.querySelector('img')))) return;
      } else if (tag === 'video' || tag === 'audio') {
        push(videoItem(el, w));
        return;
      } else if (tag === 'iframe') {
        const id = embedId(el.getAttribute('src')) ?? (w.page ? embedId(el.getAttribute('data-src') || el.getAttribute('data-lazy-src')) : null);
        if (id) push({ kind: 'embed', ids: [id], label: id });
        return;
      } else if (tag === 'blockquote') {
        if (isTweet(el) || (!w.page && tweetId(el))) {
          const id = tweetId(el);
          if (id) push({ kind: 'tweet', ids: [id], label: id });
          return;
        }
        if (!isSocialEmbed(el) && !el.parentElement?.closest('blockquote')) {
          const key = quoteKeyOf(readText(el));
          if (key) push({ kind: 'quote', ids: [key], label: readText(el).slice(0, 80) });
        }
      } else if (tag === 'details') {
        const summary = el.querySelector('summary');
        const text = summary ? readText(summary) : '';
        if (text.length >= 3) push({ kind: 'details', ids: [normalizeText(text)], label: text.slice(0, 80) });
      } else if (tag === 'table') {
        if (!el.parentElement?.closest('table') && el.getAttribute('role') !== 'presentation' && el.querySelectorAll('tr').length >= 2) {
          const key = quoteKeyOf(readText(el));
          if (key) push({ kind: 'table', ids: [key], label: readText(el).slice(0, 80) });
        }
      } else if (w.page && tag.includes('-')) {
        push(attributeVideo(el, w));
        const quote = el.getAttribute('quote');
        const key = quote ? quoteKeyOf(quote) : null;
        if (key) push({ kind: 'quote', ids: [key], label: quote!.replace(/\s+/g, ' ').trim().slice(0, 80) });
      }
    }
    for (let c = el.firstElementChild; c; c = c.nextElementSibling) visit(c, inNoscript || tag === 'noscript');
    if (until && el === until) done = true;
  };
  visit(root, false);
  return out;
}

/**
 * Les médias que la page montre dans l'article, ou `null` sans conteneur
 * (pas de mesure). Le conteneur remonte jusqu'au titre de la page quand il ne
 * le contient pas (l'image d'en-tête vit souvent au-dessus du corps), sans ce
 * qui suit le conteneur.
 */
export function pageMedia(html: string, base?: string): MediaItem[] | null {
  const { document } = parseHTML(html);
  const container = mediaContainer(document as unknown as Doc);
  if (!container) return null;
  const title = titleOutside(document as unknown as Doc, container);
  if (title) {
    let up = container.parentElement;
    while (up && !up.contains(title)) up = up.parentElement;
    if (up && !['body', 'html'].includes(up.tagName.toLowerCase()) && textLength(up) <= 1.25 * textLength(container) + 1500) {
      return collect(up, { page: true, base }, title, container);
    }
  }
  return collect(container, { page: true, base });
}

/** Les médias qu'un extrait MONTRE : adresses `src` / `srcset` seulement (le volet retire les `data-*`). */
export function extractMedia(html: string, base?: string): ExtractMedia {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const body = document.body as unknown as El;
  const found = collect(body, { page: false, base });
  const out: ExtractMedia = {
    ids: Object.fromEntries(MEDIA_KINDS.map((k) => [k, new Set<string>()])) as Record<MediaKind, Set<string>>,
    quotes: (Array.from(body.querySelectorAll('blockquote')) as El[]).map((q) => ` ${normalizeText(readText(q))} `),
    tables: (Array.from(body.querySelectorAll('table')) as El[]).map((t) => ` ${normalizeText(readText(t))} `),
    text: ` ${normalizeText(readText(body))} `,
  };
  for (const item of found) for (const id of item.ids) out.ids[item.kind].add(id);
  return out;
}

/** L'extrait montre-t-il ce média de la page ? */
export function shows(extract: ExtractMedia, item: MediaItem): boolean {
  const key = item.ids[0];
  switch (item.kind) {
    case 'quote':
      return extract.quotes.some((q) => q.includes(` ${key}`)) || extract.ids.quote.has(key);
    case 'table':
      return extract.tables.some((t) => t.includes(` ${key}`));
    case 'details':
      return extract.text.includes(` ${key} `);
    default:
      return item.ids.some((id) => extract.ids[item.kind].has(id));
  }
}

export interface MediaVerdict {
  /** Médias que la page montre dans l'article, par sorte. */
  page: Record<MediaKind, number>;
  /** Médias de la page écartés par `accepted.json` (habillage : publicité, lecteur de synthèse vocale). */
  accepted: Array<MediaItem & { reason: string }>;
  /** Manquants de la base et de la tête (`null` : extrait absent). */
  baseMissing: MediaItem[] | null;
  headMissing: MediaItem[] | null;
  /** Montrés par la base, plus par la tête : un échec. */
  regressions: MediaItem[];
}

export function judgeMedia(
  all: MediaItem[],
  base: string | null | undefined,
  head: string | null | undefined,
  url?: string,
  acceptedRules: AcceptedMatcher = compileAccepted([]),
  host = '',
): MediaVerdict {
  const accepted: MediaVerdict['accepted'] = [];
  const page = all.filter((item) => {
    const rule = acceptedRules.match(item.label, host);
    if (rule) accepted.push({ ...item, reason: rule.reason });
    return !rule;
  });
  const counts = Object.fromEntries(MEDIA_KINDS.map((k) => [k, 0])) as Record<MediaKind, number>;
  for (const item of page) counts[item.kind]++;
  const missing = (html: string | null | undefined) => {
    if (html == null) return null;
    const m = extractMedia(html, url);
    return page.filter((item) => !shows(m, item));
  };
  const baseMissing = missing(base);
  const headMissing = missing(head);
  const regressions = baseMissing && headMissing ? headMissing.filter((item) => !baseMissing.includes(item)) : [];
  return { page: counts, accepted, baseMissing, headMissing, regressions };
}
