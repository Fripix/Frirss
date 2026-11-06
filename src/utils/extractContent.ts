import { Readability } from '@mozilla/readability';
import { useAuthStore } from '../stores/authStore';
import { dropNonVideoIframes } from '../lib/youtube';
import { absolutizeUrls } from './absolutizeUrls';
import { purifyToString, releaseDocument } from '../lib/parsedDocument';
import { markupTooComplex } from '../lib/markupBounds';
import {
  extractFailedBefore, forgetExtractFailure, isExtractableUrl, isPageRefusal, rememberExtractFailure,
} from '../lib/extractFailures';

export interface ExtractedContent {
  title: string;
  content: string;
  excerpt: string;
  byline: string;
  siteName: string;
  length: number;
}

/**
 * Assainit le HTML d'un article extrait.
 *
 * Plus permissif que `sanitizeHtml()` sur un seul point, et ce point est
 * obligatoire : les <iframe> doivent survivre, sans quoi une vidéo intégrée à
 * un article extrait disparaîtrait avant qu'`injectVideoFacades` (appelé au
 * rendu, dans `ReadingPane`) puisse la transformer en façade.
 *
 * Cette permission est refermée aussitôt sur les seules vidéos que la façade
 * sait lire. Ce qu'elle laissait passer avant n'atteignait pas l'écran —
 * `ReadingPane` repasse tout par `sanitizeHtml`, qui supprime les iframes —
 * mais le résultat est ARCHIVÉ tel quel dans IndexedDB (`putExtract`), donc
 * l'innocuité ne tenait qu'au fait que chaque consommateur pense à réassainir.
 * Un stockage qui correspond au contrat d'affichage ne dépend de personne.
 */
export function sanitizeExtracted(html: string): string {
  return dropNonVideoIframes(purifyToString(html, {
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['allow', 'allowfullscreen'],
    ALLOW_DATA_ATTR: false,
  }));
}

/**
 * Délai au-delà duquel la route serveur est abandonnée au profit du repli.
 *
 * Sans minuteur, un serveur qui accepte la connexion et ne répond jamais tient
 * l'extraction indéfiniment. Six appelants, dont quatre sont des files
 * strictement séquentielles — `warmRunner`, `warmOfflineCache` et
 * `prepareOffline` (`src/stores/feedStore.ts`) et le préchargement N+1…N+10 du
 * volet de lecture (`ReadingPane.tsx`) — où un seul article bloqué bloque tout
 * ce qui le suit. Les deux autres sont des appels uniques :
 * `revalidateIfStale` (`src/lib/extractCache.ts`), lancé sans être attendu, et
 * `handleExtract` (`ReadingPane`), celui du bouton — où le blocage ne coûte
 * rien à une file, mais laisse « Article complet » sur « Extraction… » sans
 * erreur ni sortie.
 *
 * **Le chiffre est celui de la patience d'un lecteur, pas celui d'un budget
 * serveur.** Une version antérieure affirmait que 25 s se posait « juste
 * au-dessus du plafond de corps du serveur (20 s) », donc qu'une page en cours
 * de lecture n'était jamais abandonnée : c'était faux. Le budget réel du
 * serveur additionne la résolution pré-cache (≤ 5 s, `LOOKUP_TIMEOUT_MS`), les
 * en-têtes (≤ 30 s par saut, `TIMEOUT_MS`, et 45 s redirections comprises,
 * `EXTRACT_FETCH_TIMEOUT_MS`) et le corps (≤ 20 s, `BODY_TIMEOUT_MS`) — de
 * 55 s sans redirection à ~75 s au pire. Une page dont les
 * en-têtes arrivent à 8 s et dont le corps se déroule 18 s aboutissait côté
 * serveur vers 26 s, après que le client l'eut abandonnée. Aucun délai client
 * tenable ne couvre ce budget : le placer au-dessus reviendrait à laisser un
 * lecteur devant « Extraction… » pendant une minute.
 *
 * Ce que ce chiffre achète, donc : au bout de 20 s la personne a déjà tourné
 * la page, et il vaut mieux lui rendre le texte que son propre navigateur sait
 * extraire. Ce qu'il coûte, assumé : sur une page vraiment lente, le repli
 * repart chercher la MÊME origine, soit deux requêtes chez elle pour cet
 * article-là — c'est déjà le coût connu d'un repli sur un 502 sans statut
 * d'amont (ni un 415, ni un 413, ni un refus de l'extracteur ne se replient).
 * L'extraction serveur, elle, va au bout et remplit le cache : le prochain
 * appareil, lui, sera servi tout de suite.
 *
 * `AbortController` explicite plutôt qu'`AbortSignal.timeout()` : c'est ce qui
 * rend le délai pilotable par les faux minuteurs, donc testable sans faire
 * attendre la suite de tests vingt secondes.
 */
export const SERVER_EXTRACT_TIMEOUT_MS = 20_000;

/**
 * Délai du repli — la page récupérée par `/api/proxy` puis lue par le
 * navigateur.
 *
 * Cette jambe-là n'avait AUCUN minuteur, et c'est ce qui vidait le précédent
 * de son sens : la panne qu'il vise (un backend qui accepte la connexion et ne
 * répond jamais) frappe `/api/proxy` exactement comme `/api/extract`. Le blocage
 * ne disparaissait donc pas, il se décalait d'une route — la file séquentielle
 * restait bloquée pour toujours, juste une ligne plus bas.
 *
 * Même valeur que la jambe serveur, pour la même raison (la patience du
 * lecteur). Ce que cela borne, mesuré et non estimé : **~40 s** quand les deux
 * jambes se taisent, et **~100 s** au vrai pire cas — l'attente honorée après
 * un 429 (60 s au plafond, `RATE_LIMIT_MAX_WAIT_MS`) s'ajoute alors aux deux
 * budgets. C'est ce qu'un seul article peut coûter à la file avant qu'elle
 * passe au suivant ; un test à faux minuteurs fixe le chiffre.
 *
 * Le signal couvre AUSSI la lecture du corps : un amont qui distille sa page
 * octet par octet passerait sinon entre les mailles, le minuteur ayant été
 * désarmé à l'arrivée des en-têtes.
 */
export const FALLBACK_EXTRACT_TIMEOUT_MS = 20_000;

/**
 * Attente maximale honorée après un 429 du backend.
 *
 * Le seau de cadence (`FRIRSS_PROXY_RATE_LIMIT`, 600/min par compte) est
 * PARTAGÉ par `/api/extract`, `/api/proxy` et le préchargement d'images. Depuis
 * que la route serveur répond à la vitesse de Redis, un second appareil peut
 * balayer `prepareOffline` bien plus vite qu'au temps où chaque article coûtait
 * une extraction complète, et atteindre le plafond. Sans ce qui suit, l'article
 * était simplement absent du jeu hors ligne, en silence (`feedStore` avale
 * l'échec) — le genre de défaut qui ne se découvre que dans l'avion.
 *
 * On honore donc `Retry-After` une fois plutôt que d'abandonner l'article, ce
 * qui cadence le balayage au lieu de le trouer. Le plafond d'une minute est
 * celui de la fenêtre du seau : au-delà, ce n'est plus une attente, c'est une
 * panne.
 *
 * ⚠️ **Ce que cela ne couvre PAS, et il faut le dire exactement.** L'attente
 * n'a lieu que si la réponse annonce un délai exploitable. Sans en-tête
 * `Retry-After`, avec un en-tête illisible, ou au-delà du plafond,
 * `retryAfterMs` rend `null` : il n'y a alors ni attente ni repli, et
 * `extractFullContent` lève `RateLimitedError` — que `feedStore` avale, donc
 * l'article est bel et bien absent du passage, en silence. Idem si le second
 * essai revient en 429. En pratique la fenêtre du seau est d'une minute et
 * `express-rate-limit` émet toujours un `Retry-After` inférieur ou égal à 60,
 * donc le cas courant est couvert — mais « on ne perd pas l'article » reste
 * faux comme énoncé général : c'est « on ne le perd pas quand le serveur dit
 * quand revenir », et le passage suivant le reprendra puisque rien n'a été mis
 * en cache.
 *
 * Et sur un 429 on ne se replie PAS sur `/api/proxy` : c'est le même seau, donc
 * un échec certain et un jeton gaspillé. Le refus tient même si la seconde
 * tentative échoue — voir le drapeau `rateLimited` plus bas.
 */
export const RATE_LIMIT_MAX_WAIT_MS = 60_000;

/** Le backend a refusé la cadence, et l'attente n'a pas suffi. */
export class RateLimitedError extends Error {
  constructor() { super('RATE_LIMITED'); this.name = 'RateLimitedError'; }
}

/**
 * Plafond du corps lu par le repli local : celui de la route serveur
 * (`MAX_HTML_BYTES`, 2 Mo). Le repli lisait la réponse ENTIÈRE en texte : un
 * article dont l'adresse est une vidéo `.mp4` y passait en entier, et Android
 * tuait l'onglet au même article à chaque préparation hors ligne.
 */
export const FALLBACK_MAX_HTML_BYTES = 2_000_000;

/** Bornes de forme du repli : celles de la route serveur (`EXTRACT_MAX_DEPTH`,
 *  `EXTRACT_MAX_ELEMENTS`, `server/extract.ts`, qui dit leur calibrage). */
export const FALLBACK_MARKUP_LIMITS = { maxDepth: 256, maxElements: 60_000 } as const;

/** Les types qu'on lit comme une page — ceux de la route serveur. */
const HTML_TYPES = /^(text\/html|application\/xhtml\+xml)\b/i;

/** La cible n'est pas une page (vidéo, PDF, image…) ou dépasse 2 Mo : rien
 *  à extraire, et aucun repli. */
export class NotAPageError extends Error {
  constructor() { super('NOT_A_PAGE'); this.name = 'NotAPageError'; }
}

/**
 * Rien n'est demandé au réseau : une vidéo YouTube (aucun article à
 * extraire), ou une page dont l'extraction a déjà échoué pendant la session
 * — voir `src/lib/extractFailures.ts` (L-03).
 */
export class NotExtractableError extends Error {
  constructor() { super('NOT_EXTRACTABLE'); this.name = 'NotExtractableError'; }
}

/**
 * Le SITE a refusé la page au serveur (502 portant `upstreamStatus`) : pas de
 * repli, `/api/proxy` irait se faire refuser par le même site, depuis la même
 * adresse — une requête perdue et un jeton du seau de cadence.
 */
export class UpstreamRefusedError extends Error {
  constructor(readonly status: number) { super(`UPSTREAM_${status}`); this.name = 'UpstreamRefusedError'; }
}

/**
 * La page est refusée pour sa COMPLEXITÉ (M-01) : imbrication ou nombre
 * d'éléments au-delà des seuils, ou mémoire du worker du serveur épuisée — une
 * page piégée. Refusée par le serveur, ou par le repli lui-même avant toute
 * analyse (`markupTooComplex`). Échec définitif : pas de repli (l'onglet
 * relirait la même page), et la page est retenue pour la session.
 */
export class PageTooComplexError extends Error {
  constructor() { super('PAGE_TOO_COMPLEX'); this.name = 'PageTooComplexError'; }
}

/**
 * L'analyse du serveur a dépassé son délai (504 portant `timedOut`). Pas une
 * page piégée (relecture 1.9.0) : un serveur chargé peut dépasser le délai sur
 * une page ordinaire. Échec ordinaire — pas retenu, « Réessayer » possible —,
 * mais sans repli : l'onglet paierait la même analyse.
 */
export class ExtractTimeoutError extends Error {
  constructor() { super('EXTRACT_TIMEOUT'); this.name = 'ExtractTimeoutError'; }
}

/**
 * La file d'analyse du serveur est pleine (503 portant `busy`). Échec
 * PASSAGER : pas retenu, « Réessayer » possible, le passage suivant reprend
 * l'article — la préparation hors ligne le redemande même dans son propre
 * passage (`src/lib/prepBusyRetry.ts`). Sans repli : l'onglet referait l'analyse que le serveur refuse,
 * sans borne de durée — 14 s de gel mesurées sur une page lente (N-2,
 * vérification 1.9.0).
 */
export class ExtractorBusyError extends Error {
  constructor() { super('EXTRACTOR_BUSY'); this.name = 'ExtractorBusyError'; }
}

/**
 * Le worker d'analyse du serveur est mort sans répondre (502 portant
 * `crashed`). Échec PASSAGER, comme une file pleine : pas retenu,
 * « Réessayer » possible, le passage suivant reprend l'article. Sans repli :
 * rendu en 502 nu jusqu'ici, il renvoyait l'onglet sur son propre extracteur,
 * qui refaisait l'analyse sans borne de durée.
 */
export class ExtractorCrashedError extends Error {
  constructor() { super('EXTRACTOR_CRASHED'); this.name = 'ExtractorCrashedError'; }
}

/** Le repli a reçu une réponse en erreur de `/api/proxy`. */
class FallbackHttpError extends Error {
  constructor(readonly status: number) { super(`HTTP ${status}`); this.name = 'FallbackHttpError'; }
}

/** Readability n'a rien trouvé de lisible : au serveur (422 sans
 *  `tooComplex`, pas de repli depuis N-2), ou ici, dans le repli. */
class NoContentError extends Error {
  constructor() { super('NO_CONTENT'); this.name = 'NoContentError'; }
}

/** La page dépasse le plafond du repli. */
class PageTooLargeError extends Error {
  constructor() { super('Page too large'); this.name = 'PageTooLargeError'; }
}

/**
 * L'échec tient-il à la PAGE ? Seul celui-là est retenu pour la session : une
 * cadence dépassée (429), un délai, une panne réseau, un 5xx du site ou du
 * proxy ne disent rien d'elle, et le passage suivant peut réussir. Un refus
 * du site n'est retenu que s'il est propre à la page (`isPageRefusal`) : un
 * 503 passager excluait sinon la page de l'automatique jusqu'au
 * rechargement. Un 401/403 de `/api/proxy` peut être celui de FriRSS (session
 * expirée) : jamais retenu.
 */
function isPageFailure(err: unknown): boolean {
  if (err instanceof NotAPageError || err instanceof NoContentError || err instanceof PageTooLargeError) return true;
  if (err instanceof PageTooComplexError) return true;
  if (err instanceof UpstreamRefusedError) return isPageRefusal(err.status, 'site');
  if (err instanceof FallbackHttpError) return isPageRefusal(err.status, 'proxy');
  return false;
}

export { forgetExtractFailures } from '../lib/extractFailures';

/**
 * Lit au plus `maxBytes` du corps d'une page. Un type annoncé qui n'est pas du
 * HTML est refusé sans lire un octet ; un type absent est lu, borné.
 */
async function readPageText(response: Response, maxBytes: number): Promise<string> {
  const ctype = response.headers.get('content-type');
  if (ctype && !HTML_TYPES.test(ctype)) {
    await response.body?.cancel().catch(() => {});
    throw new NotAPageError();
  }
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let seen = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += value.byteLength;
    if (seen > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new PageTooLargeError();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** Exécute `run` sous un signal d'abandon armé pour `timeoutMs`. */
async function withTimeout<T>(timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Délai d'attente annoncé par un 429, en millisecondes, ou `null` si la
 * réponse n'en annonce aucun exploitable.
 *
 * `Retry-After` en secondes (ce qu'émet `express-rate-limit`) ou en date HTTP.
 * Une valeur négative devient zéro, une valeur au-delà du plafond est refusée
 * plutôt que tronquée : attendre moins que demandé, c'est retomber sur un 429.
 */
export function retryAfterMs(headers: Headers, now = Date.now()): number | null {
  const raw = headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw.trim());
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - now;
  if (!Number.isFinite(ms)) return null;
  if (ms > RATE_LIMIT_MAX_WAIT_MS) return null;
  return Math.max(0, ms);
}

/** Extractions en cours, par URL : une page demandée par deux files à la fois
 *  (réchauffage de la vue, préchargement, ouverture) ne part qu'une fois. */
const inFlight = new Map<string, Promise<ExtractedContent>>();

/**
 * Fetch the full article content from its original URL,
 * parse it with Mozilla Readability, and sanitize with DOMPurify.
 *
 * Returns { title, content, excerpt, byline, siteName, length } or throws.
 *
 * L-03 : une vidéo YouTube n'est jamais envoyée (`NotExtractableError`, sans
 * réseau) ; une page dont l'extraction a échoué POUR ELLE-MÊME n'est pas
 * redemandée de la session, sauf `retry` — la demande explicite du lecteur ;
 * deux demandes simultanées de la même page partagent la même requête.
 */
export function extractFullContent(url: string, opts: { retry?: boolean } = {}): Promise<ExtractedContent> {
  if (!isExtractableUrl(url)) return Promise.reject(new NotExtractableError());
  if (!opts.retry && extractFailedBefore(url)) return Promise.reject(new NotExtractableError());
  const shared = inFlight.get(url);
  if (shared) return shared;
  const run = (async () => {
    try {
      const result = await extractOnce(url);
      forgetExtractFailure(url);
      return result;
    } catch (err) {
      if (isPageFailure(err)) rememberExtractFailure(url);
      throw err;
    } finally {
      inFlight.delete(url);
    }
  })();
  inFlight.set(url, run);
  return run;
}

// ── Conteneur principal explicite (A-1) ──────────────────────────────
// Copie de la règle de `server/extract.ts` (le serveur et le navigateur ne
// partagent pas de code) : constantes et sélecteurs identiques, le pourquoi
// est écrit là-bas. Toute modification de l'une va avec l'autre, et avec
// `EXTRACT_VERSION`.
const MAIN_CONTAINER_MIN_SHARE = 0.5;
/** Seconde passe retenue seulement si elle rend 1,5 fois plus de texte (N-1). */
const MAIN_CONTAINER_MIN_GAIN = 1.5;
// `linkDensityModifier` existe dans Readability 0.6.0 mais pas dans ses types.
const MAIN_CONTAINER_OPTIONS = { charThreshold: 500, linkDensityModifier: 0.5 };

const normalizedLength = (text: string) => text.replace(/\s+/g, ' ').trim().length;

function findMainContainer(doc: Document): Element | null {
  for (const selector of ['article', '[role="main"]', 'main']) {
    const found = doc.querySelectorAll(selector);
    if (found.length === 1) return found[0];
    if (found.length > 1 && selector === 'article') return null;
  }
  return null;
}

function mainContainerTextLength(doc: Document): number | null {
  const container = findMainContainer(doc);
  if (!container) return null;
  const length = normalizedLength(container.textContent || '');
  return length >= 500 ? length : null;
}

function keptTooLittle(kept: string, mainLength: number): boolean {
  return normalizedLength(kept) < mainLength * MAIN_CONTAINER_MIN_SHARE;
}

function recoveredMore(second: string, first: string): boolean {
  return normalizedLength(second) >= normalizedLength(first) * MAIN_CONTAINER_MIN_GAIN;
}

function keepOnlyMainContainer(doc: Document): boolean {
  const container = findMainContainer(doc);
  if (!container || !doc.body) return false;
  doc.body.replaceChildren(container);
  return true;
}

// ── Une liste n'est pas un article (A4-02) ───────────────────────────
// Copie de `onlyAList` / `aroundTheList` (`server/extract.ts`, qui dit
// pourquoi : un gros avis du CERT-FR réduit à sa liste de références).
const ONLY_A_LIST_SHARE = 0.9;
const ONLY_A_LIST_MIN_ITEMS = 10;

interface OnlyList { html: string; text: string; first: string; items: number }

const squeezed = (text: string | null) => (text || '').replace(/\s+/g, '');

function onlyAList(content: string): OnlyList | null {
  const doc = new DOMParser().parseFromString(content, 'text/html');
  try {
    const total = normalizedLength(doc.body.textContent || '');
    let best: Element | null = null;
    let bestLength = 0;
    for (const list of Array.from(doc.body.querySelectorAll('ul, ol'))) {
      const length = normalizedLength(list.textContent || '');
      if (length > bestLength) { best = list; bestLength = length; }
    }
    if (!best || !total || bestLength < total * ONLY_A_LIST_SHARE) return null;
    const items = Array.from(best.children).filter((child) => child.tagName === 'LI');
    if (items.length < ONLY_A_LIST_MIN_ITEMS) return null;
    return { html: best.outerHTML, text: best.textContent || '', first: squeezed(items[0].textContent), items: items.length };
  } finally {
    releaseDocument(doc);
  }
}

function aroundTheList(doc: Document, list: OnlyList): { content: string; length: number; textContent: string } | null {
  const source = Array.from(doc.querySelectorAll('ul, ol')).find((candidate) => {
    const items = Array.from(candidate.children).filter((child) => child.tagName === 'LI');
    return items.length >= list.items && squeezed(items[0].textContent) === list.first;
  });
  if (!source) return null;
  const token = `frirss-list-${Math.random().toString(36).slice(2)}`;
  const marker = doc.createElement('p');
  marker.textContent = token;
  source.replaceWith(marker);
  const again = new Readability(doc, { charThreshold: 500 }).parse();
  const placed = new RegExp(`<p[^>]*>\\s*${token}\\s*</p>`);
  if (!again?.content || !placed.test(again.content)) return null;
  return {
    content: again.content.replace(placed, () => list.html),
    length: (again.length || 0) - token.length + list.text.length,
    textContent: (again.textContent || '').replace(token, list.text),
  };
}

// ── Images paresseuses (A1) ──────────────────────────────────────────
// Copie de `resolveLazyImages` (`server/extract.ts`, qui dit pourquoi : cadres
// blancs de Numerama, boutons d'agrandissement de Zoomit). Ici elle compte
// double : `sanitizeExtracted` retire ensuite tous les attributs `data-*`.
// Appelée AVANT `absolutizeUrls`, pour qu'une adresse `data-src` relative soit
// résolue contre l'article comme les autres.
function isPlaceholderSource(value: string | null): boolean {
  if (!value || !value.trim()) return true;
  return /^\s*data:/i.test(value) && !/^\s*data:[^,]*;base64,/i.test(value);
}

function webAddress(value: string | null): string | null {
  const v = value?.trim();
  if (!v) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(v)?.[1].toLowerCase();
  return !scheme || scheme === 'http' || scheme === 'https' ? v : null;
}

function onlyImage(el: Element): Element | null {
  if ((el.textContent || '').trim()) return null;
  const images = el.querySelectorAll('img');
  return images.length === 1 ? images[0] : null;
}

function resolveLazyImages(root: Element): void {
  for (const img of Array.from(root.querySelectorAll('img'))) {
    if (!isPlaceholderSource(img.getAttribute('src'))) continue;
    const src = webAddress(img.getAttribute('data-src'));
    const srcset = webAddress(img.getAttribute('data-srcset'));
    if (src) img.setAttribute('src', src);
    if (srcset && isPlaceholderSource(img.getAttribute('srcset'))) img.setAttribute('srcset', srcset);
    if (src || srcset) continue;
    const holder = img.parentElement?.tagName.toLowerCase() === 'picture' ? img.parentElement : img;
    const next = holder.nextElementSibling;
    const real = next?.tagName.toLowerCase() === 'noscript' ? onlyImage(next) : null;
    if (real && webAddress(real.getAttribute('src'))) {
      holder.replaceWith(real);
      next!.remove();
    }
  }
  for (const source of Array.from(root.querySelectorAll('source[data-srcset]'))) {
    const srcset = webAddress(source.getAttribute('data-srcset'));
    if (srcset && isPlaceholderSource(source.getAttribute('srcset'))) source.setAttribute('srcset', srcset);
  }
  for (const button of Array.from(root.querySelectorAll('button'))) {
    if (isZoomButton(button)) button.replaceWith(...Array.from(button.childNodes));
  }
}

// Seuls les boutons d'agrandissement sont déballés, jamais une icône (copie
// de `isZoomButton`, `server/extract.ts`, qui dit pourquoi).
const ZOOM_HINT = /zoom|lightbox|enlarge|expand|fullscreen|full-screen|agrandi|plein écran|vergr[öo]ß|vergroot|ampliar|ingrand|powi[eę]ksz|збільш|放大|بزرگ/i;
const ICON_MAX_SIZE = 64;

function isIcon(img: Element): boolean {
  const src = (img.getAttribute('src') || '').trim();
  if (/^data:image\/svg/i.test(src) || /\.svg(?:[?#]|$)/i.test(src)) return true;
  return ['width', 'height'].some((name) => {
    const size = parseInt(img.getAttribute(name) || '', 10);
    return Number.isFinite(size) && size < ICON_MAX_SIZE;
  });
}

function isZoomButton(button: Element): boolean {
  const img = onlyImage(button);
  if (!img || isIcon(img)) return false;
  const label = button.getAttribute('aria-label') || '';
  const hints = `${label} ${button.getAttribute('class') || ''} ${button.getAttribute('title') || ''}`;
  if (ZOOM_HINT.test(hints)) return true;
  const alt = (img.getAttribute('alt') || '').trim();
  return alt.length > 0 && label.includes(alt);
}

// ── Blocs étrangers retirés avant toute passe (M-04) ─────────────────
// Copie de `stripBoilerplate` (`server/extract.ts`, qui dit pourquoi : mentions
// légales de The Verge ramassées par la seconde passe, fil d'Ariane et
// crédits de Schneier par la première ; publicités, affiliation, formulaire
// de lettre d'information, repli CodePen et colonne `#secondary` en A3).
// Règles, mots et gardes identiques.
const BOILERPLATE_TAGS = new Set(['footer', 'nav', 'form']);
const BOILERPLATE_ROLES = new Set(['navigation', 'contentinfo']);
const BOILERPLATE_TOKENS = new Set([
  'related', 'comment', 'comments', 'breadcrumb', 'breadcrumbs', 'footer',
]);
/** Seulement sur un bloc court : la règle « share » de Readability (relecture 1.9.0), étendue en A3. */
const SHORT_BLOCK_TOKENS = new Set([
  'share', 'sharing', 'newsletter',
  'ad', 'ads', 'advert', 'advertisement', 'sponsor', 'sponsored', 'affiliate', 'disclaimer', 'pwa',
]);
/** Un bloc `newsletter` qui porte un champ de saisie est un formulaire, quelle que soit sa longueur (A3). */
const FORM_CONTROLS = 'input, select, textarea';
const SHORT_BLOCK_MAX = 500;
const NAMED_EXEMPT = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'span', 'b', 'i', 'em', 'strong', 'code', 'small', 'sup', 'sub',
  'time', 'abbr', 'label', 'img', 'figcaption',
]);
const POWERED_BY = /^powered by\b/i;
const POWERED_BY_MAX_LENGTH = 120;
const BYLINE_SIGNALS = '[rel~="author"], [itemprop*="author"], [class*="byline"], [id*="byline"], [class*="author"], [id*="author"], [class*="dateline"], [class*="writtenby"]';
const INVISIBLE = new Set(['script', 'style', 'template', 'noscript']);

/** Texte lisible d'un billet, mesuré une fois par nettoyage (B-02, voir le serveur). */
type PostLength = (post: Element) => number;

function isBoilerplate(el: Element, insideArticle: boolean, postLength: PostLength): boolean {
  const tag = el.tagName.toLowerCase();
  const role = (el.getAttribute('role') || '').toLowerCase();
  if (BOILERPLATE_TAGS.has(tag) || BOILERPLATE_ROLES.has(role)) return true;
  if (!insideArticle && (tag === 'aside' || role === 'complementary' || (el.getAttribute('id') || '').toLowerCase() === 'secondary')) return true;
  if (el.hasAttribute('data-slug-hash') && hasCaptionSibling(el)) return true;
  if (!NAMED_EXEMPT.has(tag)) {
    const tokens = `${withoutTaxonomy(el.getAttribute('class'))} ${el.getAttribute('id') || ''}`.toLowerCase().split(/[^a-z0-9]+/);
    if (tokens.some((token) => BOILERPLATE_TOKENS.has(token))) return true;
    if (!isPostContainer(tag, role)) {
      if (tokens.includes('newsletter') && el.querySelector(FORM_CONTROLS) && !carriesMostOfItsPost(el, postLength)) return true;
      if (tokens.some((token) => SHORT_BLOCK_TOKENS.has(token))
        && visibleTextLength(el, SHORT_BLOCK_MAX) < SHORT_BLOCK_MAX) return true;
    }
  }
  if (el.childElementCount <= 3 && Array.from(el.children).every((child) => child.childElementCount === 0)) {
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length <= POWERED_BY_MAX_LENGTH && POWERED_BY.test(text)) return true;
  }
  return false;
}

/** Repli d'une démo CodePen : retiré seulement quand une légende le répète (A3). */
/** Termes de taxonomie de WordPress (`tag-pwa`, `category-ads`) : les sujets du billet, pas la nature du bloc. */
function withoutTaxonomy(className: string | null): string {
  return (className || '').split(/\s+/).filter((name) => !/^(tag|category)-/i.test(name)).join(' ');
}

/** Le billet ou le conteneur principal : jamais « court » ni « formulaire ». */
function isPostContainer(tag: string, role: string): boolean {
  return tag === 'article' || tag === 'main' || role === 'main';
}

/** Moitié du texte de son billet ou plus : le corps d'une lettre publiée comme billet.
 *  Le billet n'est pas relu à chaque bloc (B-02) : `postLength` le mesure une fois. */
function carriesMostOfItsPost(el: Element, postLength: PostLength): boolean {
  const post = el.parentElement?.closest('article, main, [role="main"]');
  if (!post) return false;
  const half = postLength(post) * MAIN_CONTAINER_MIN_SHARE;
  return visibleTextLength(el, half) >= half;
}

function hasCaptionSibling(el: Element): boolean {
  for (let sibling = el.parentElement?.firstElementChild; sibling; sibling = sibling.nextElementSibling) {
    if (sibling !== el && sibling.tagName.toLowerCase() === 'figcaption') return true;
  }
  return false;
}

function carriesByline(el: Element): boolean {
  return el.matches(BYLINE_SIGNALS) || !!el.querySelector(BYLINE_SIGNALS);
}

function visibleTextLength(root: Element, stopAt = Infinity): number {
  let length = 0;
  const stack: Node[] = [root];
  while (stack.length && length < stopAt) {
    const node = stack.pop()!;
    if (node.nodeType === Node.TEXT_NODE) {
      length += (node.textContent || '').replace(/\s+/g, ' ').length;
    } else if (node.nodeType === Node.ELEMENT_NODE && !INVISIBLE.has((node as Element).tagName.toLowerCase())) {
      for (let child = node.firstChild; child; child = child.nextSibling) stack.push(child);
    }
  }
  return length;
}

/** Retire de `root` (jamais `root` lui-même) les blocs étrangers à l'article. */
function stripBoilerplate(root: Element): void {
  const total = visibleTextLength(root);
  // Billets déjà mesurés, tenus à jour à chaque retrait (B-02, voir le serveur).
  const posts = new Map<Element, number>();
  const postLength: PostLength = (post) => {
    let length = posts.get(post);
    if (length === undefined) posts.set(post, length = visibleTextLength(post));
    return length;
  };
  const stack: Array<[Element, boolean]> = Array.from(root.children, (child) => [child, false]);
  while (stack.length) {
    const [el, insideArticle] = stack.pop()!;
    if (isBoilerplate(el, insideArticle, postLength)) {
      const length = visibleTextLength(el);
      if (length < total * MAIN_CONTAINER_MIN_SHARE && !carriesByline(el)) {
        if (posts.size) forgetText(posts, el, length);
        el.remove();
        continue;
      }
    }
    const inArticle = insideArticle || el.tagName.toLowerCase() === 'article';
    for (let child = el.firstElementChild; child; child = child.nextElementSibling) stack.push([child, inArticle]);
  }
}

/** Les billets mesurés qui contiennent `el` perdent son texte — sauf sous un élément dont le texte n'est pas lu. */
function forgetText(posts: Map<Element, number>, el: Element, length: number): void {
  let unread = false;
  for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (INVISIBLE.has(ancestor.tagName.toLowerCase())) unread = true;
    const measured = posts.get(ancestor);
    if (measured !== undefined && !unread) posts.set(ancestor, measured - length);
  }
}

// ── Corps réparti en plusieurs blocs (troisième round) ───────────────
// Copie de `joinSplitBody` (`server/extract.ts`, qui dit pourquoi : le corps
// d'Ars Technica coupé en `div.post-content` cousins, dont Readability ne
// gardait qu'un — chapeau perdu — ou que la seconde passe rattrapait avec la
// notice de l'auteur). Règles et gardes identiques : même classe, nom
// favorable pour Readability, un paragraphe et du texte, même `<article>`,
// rien de lisible entre deux blocs ; l'ordre du texte ne change jamais. Tout
// ou rien : un groupe qu'une image ou un texte coupe n'est pas réuni du tout
// (Clubic, R3V-01) ; une cellule de tableau est son propre cadre, comme un
// `<article>`. Un bloc invisible pour Readability — lui-même ou par un
// ancêtre — n'est pas un corps (B-01).
const POSITIVE_NAME = /article|body|content|entry|hentry|h-entry|main|page|pagination|post|text|blog|story/i;
const NEGATIVE_NAME = /-ad-|hidden|^hid$| hid$| hid |^hid |banner|combx|comment|com-|contact|footer|gdpr|masthead|media|meta|outbrain|promo|related|scroll|share|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|widget/i;
const MEDIA = 'img, picture, video, audio, iframe, object, embed';
const SCOPE = 'article, td, th';

function isReadable(node: Node): boolean {
  const stack: Node[] = [node];
  while (stack.length) {
    const current = stack.pop()!;
    if (current.nodeType === Node.TEXT_NODE) {
      if ((current.textContent || '').trim()) return true;
    } else if (current.nodeType === Node.ELEMENT_NODE) {
      const el = current as Element;
      if (INVISIBLE.has(el.tagName.toLowerCase())) continue;
      if (el.matches(MEDIA)) return true;
      for (let child = el.firstChild; child; child = child.nextSibling) stack.push(child);
    }
  }
  return false;
}

/** Écarté par Readability avec son contenu (voir le serveur, B-01). */
function hiddenForReadability(el: Element): boolean {
  if (INVISIBLE.has(el.tagName.toLowerCase()) || el.hasAttribute('hidden')) return true;
  if (el.getAttribute('aria-hidden') === 'true' && !(el.getAttribute('class') || '').includes('fallback-image')) return true;
  if (el.getAttribute('aria-modal') === 'true' && el.getAttribute('role') === 'dialog') return true;
  if (!el.hasAttribute('style')) return false;
  const style = (el as HTMLElement).style;
  return !!style && (style.display === 'none' || style.visibility === 'hidden');
}

/** `el` ou un ancêtre invisible pour Readability ; mémorisé dans `memo`. */
function insideHidden(el: Element, memo: Map<Element, boolean>): boolean {
  const path: Element[] = [];
  let hidden = false;
  for (let current: Element | null = el; current; current = current.parentElement) {
    const known = memo.get(current);
    if (known !== undefined) { hidden = known; break; }
    path.push(current);
    if (hiddenForReadability(current)) { hidden = true; break; }
  }
  for (const node of path) memo.set(node, hidden);
  return hidden;
}

function nextOutside(node: Node): Node | null {
  for (let current: Node | null = node; current; current = current.parentNode) {
    if (current.nextSibling) return current.nextSibling;
  }
  return null;
}

interface Budget { left: number }

/** Ce qui se lit entre `a` et `b`, dans l'ordre, ou `null` si quelque chose coupe le corps (voir le serveur, A4-01). */
function readableBetween(a: Element, b: Element, members: Set<Element>, budget: Budget): Node[] | null {
  const found: Node[] = [];
  let node = nextOutside(a);
  while (node && node !== b) {
    if (--budget.left < 0) return null;
    if (node.contains(b)) {
      node = node.firstChild;
      continue;
    }
    if (isReadable(node)) {
      if (!partOfBody(node, members, budget)) return null;
      found.push(node);
    }
    node = nextOutside(node);
  }
  return found;
}

/** Un autre bloc du groupe, une image légendée, une citation ou un message intégré : du corps (A4-01). */
function partOfBody(node: Node, members: Set<Element>, budget: Budget): boolean {
  const stack: Node[] = [node];
  while (stack.length) {
    if (--budget.left < 0) return false;
    const current = stack.pop()!;
    if (current.nodeType === Node.TEXT_NODE) {
      if ((current.textContent || '').trim()) return false;
      continue;
    }
    if (current.nodeType !== Node.ELEMENT_NODE) continue;
    const el = current as Element;
    const tag = el.tagName.toLowerCase();
    if (INVISIBLE.has(tag) || members.has(el) || tag === 'figcaption' || tag === 'blockquote') continue;
    if (tag === 'a') {
      if (isReadable(el)) return false;
      continue;
    }
    if (el.matches(MEDIA)) continue;
    for (let child = el.firstChild; child; child = child.nextSibling) stack.push(child);
  }
  return true;
}

/** Verse un intercalaire dans le corps : le contenu d'un bloc du groupe, sans ses gabarits (voir le serveur). */
function pourGap(node: Node, body: Element, members: Set<Element>, holders: Set<Node>): void {
  if (members.has(node as Element)) {
    body.append(...Array.from(node.childNodes));
  } else if (holders.has(node)) {
    for (const child of Array.from(node.childNodes)) pourGap(child, body, members, holders);
  } else if (isReadable(node)) {
    body.append(node);
  }
}

function joinSplitBody(root: Element): void {
  const groups = new Map<string, Element[]>();
  for (const el of Array.from(root.querySelectorAll('[class]'))) {
    const name = (el.getAttribute('class') || '').replace(/\s+/g, ' ').trim();
    if (!name || !POSITIVE_NAME.test(name) || NEGATIVE_NAME.test(name)) continue;
    const group = groups.get(name);
    if (group) group.push(el);
    else groups.set(name, [el]);
  }
  const hidden = new Map<Element, boolean>();
  // Parcours bornés au total (A4-01, voir le serveur).
  const budget: Budget = { left: 8 * root.getElementsByTagName('*').length + 10_000 };
  for (const group of groups.values()) {
    const blocks: Element[] = [];
    for (const el of group) {
      const last = blocks[blocks.length - 1];
      if (!last || !last.contains(el)) blocks.push(el);
    }
    const members = new Set(blocks.filter((block) => !insideHidden(block, hidden)));
    const holders = new Set<Node>();
    for (const member of members) {
      for (let up = member.parentNode; up && up !== root && !holders.has(up); up = up.parentNode) holders.add(up);
    }
    const runs = new Map<Element | null, Element[]>();
    for (const block of blocks) {
      // Sans texte, pas un corps — et la borne du coût (voir le serveur). Ni
      // un bloc que Readability écartera (B-01).
      if (!block.querySelector('p') || !isReadable(block) || insideHidden(block, hidden)) continue;
      const scope = block.closest(SCOPE);
      const run = runs.get(scope);
      if (run) run.push(block);
      else runs.set(scope, [block]);
    }
    for (const run of runs.values()) {
      // Tout ou rien par cadre (R3V-01) ; les intercalaires du corps sont
      // versés avec les blocs, à leur place (A4-01, voir le serveur).
      const gaps: Node[][] = [];
      for (let i = 1; i < run.length; i++) {
        const gap = readableBetween(run[i - 1], run[i], members, budget);
        if (!gap) break;
        gaps.push(gap);
      }
      if (gaps.length < run.length - 1) continue;
      let body = run[0];
      run.slice(1).forEach((block, i) => {
        if (block.parentElement === body.parentElement) {
          body = block;
          return;
        }
        for (const node of gaps[i]) pourGap(node, body, members, holders);
        body.append(...Array.from(block.childNodes));
        block.remove();
      });
    }
  }
}

async function extractOnce(url: string): Promise<ExtractedContent> {
  const { backendToken } = useAuthStore.getState();

  // Le serveur fait autorité quand il répond : il extrait une fois pour toute
  // l'instance et, quand Redis est là, partage le résultat entre appareils et
  // entre comptes. L'extraction locale ci-dessous n'est qu'un filet pour les
  // cas où le serveur n'a PAS PU ESSAYER : route absente (serveur plus
  // ancien, 404, ou toute réponse inattendue), FriRSS injoignable ou muet
  // (erreur réseau, délai du client), page que le serveur n'a pas pu joindre
  // (502 sans statut d'amont ni `crashed`, 504 sans `timedOut`, 503 de son
  // résolveur).
  //
  // Quand le serveur a eu le HTML et l'a refusé, le repli relirait la même
  // page dans l'onglet, analyse comprise, sur le fil principal — décision de
  // la vérification 1.9.0 (N-2) : pas de repli. Ni sur un 415 (la cible n'est
  // pas une page) ou un 413 (plus de 2 Mo, le plafond du repli aussi) ; ni
  // sur un 422, `tooComplex` (page piégée, M-01) ou non (rien de lisible) ;
  // ni sur un 504 portant `timedOut` (l'analyse a dépassé son délai) ; ni sur
  // un 503 portant `busy` (file d'analyse pleine : 14 s de gel mesurées quand
  // l'onglet prenait le relais). Ni sur un 502 portant `upstreamStatus` (le
  // site a refusé la page, il la refuserait au proxy) ou `crashed` (le worker
  // d'analyse est mort sans répondre : passager, comme `busy`).
  //
  // Ce repli ne couvre PAS l'absence de Redis : sans cache, la route extrait
  // quand même et répond 200 — elle ne garde simplement rien, et le prochain
  // appareil repaiera l'extraction.
  //
  // Le HTML rendu par la route est BRUT, délibérément : `createDOMPurify` sur
  // `linkedom` ne filtre rien (pas de `NodeFilter`, donc DOMPurify bascule sans
  // bruit en mode « environnement non supporté » et rend l'entrée telle
  // quelle). C'est donc ICI qu'il est assaini, avant d'être rendu à l'appelant
  // et donc avant d'être archivé dans IndexedDB (`putExtract`) : sauter cette
  // étape publie une XSS stockée, atteignable depuis n'importe quel flux dont
  // la page d'origine porte un `onclick` ou un `onerror`.
  const auth: Record<string, string> = backendToken ? { Authorization: `Bearer ${backendToken}` } : {};

  // Une tentative, bornée : le contenu quand la route répond utilement, le
  // marqueur `RATE_LIMITED` sur un 429, `null` dans tous les autres cas (repli).
  const RATE_LIMITED = Symbol('rate-limited');
  const askServer = () => withTimeout(SERVER_EXTRACT_TIMEOUT_MS, async (signal) => {
    const served = await fetch(`/api/extract?url=${encodeURIComponent(url)}`, { headers: auth, signal });
    if (served.status === 429) return { limited: RATE_LIMITED, wait: retryAfterMs(served.headers) } as const;
    // 415 : le serveur a lu la cible, ce n'est pas une page. 413 : elle
    // dépasse 2 Mo, le plafond du repli aussi. Le repli relirait la même
    // réponse pour échouer — en entier, avant la 1.8.0.
    if (served.status === 415 || served.status === 413) throw new NotAPageError();
    // 502 portant `upstreamStatus` : le serveur a joint le site, qui a
    // refusé la page. Le repli irait se faire refuser de même. Un 502 sans
    // lui (site injoignable depuis le serveur) garde le repli.
    // 422 portant `tooComplex` : page piégée, refusée par le serveur (M-01).
    // Un 422 sans lui : le serveur n'y a rien trouvé de lisible. Ni l'un ni
    // l'autre ne se replient (N-2) — l'onglet relirait le même HTML —, et les
    // deux sont retenus pour la session.
    if (served.status === 422) {
      const body = (await served.json().catch(() => null)) as { tooComplex?: unknown } | null;
      if (body?.tooComplex === true) throw new PageTooComplexError();
      throw new NoContentError();
    }
    // 503 portant `busy` : file d'analyse du serveur pleine (N-2). Passager,
    // pas retenu, sans repli. Un 503 sans lui (résolveur du serveur muet)
    // garde le repli : le serveur n'a pas essayé.
    if (served.status === 503) {
      const body = (await served.json().catch(() => null)) as { busy?: unknown } | null;
      if (body?.busy === true) throw new ExtractorBusyError();
      return null;
    }
    // 504 portant `timedOut` : l'analyse du serveur a dépassé son délai.
    // Pas de repli (l'onglet paierait la même analyse), pas de mémoire non
    // plus : un serveur chargé peut le dépasser sur une page ordinaire. Un
    // 504 sans lui (site trop lent pour le serveur) garde le repli.
    if (served.status === 504) {
      const body = (await served.json().catch(() => null)) as { timedOut?: unknown } | null;
      if (body?.timedOut === true) throw new ExtractTimeoutError();
      return null;
    }
    // 502 portant `crashed` : le worker d'analyse du serveur est mort sans
    // répondre. Passager, comme `busy` : pas retenu, sans repli — l'onglet
    // referait l'analyse sans borne de durée. Un 502 sans aucun des deux
    // drapeaux (site injoignable depuis le serveur) garde le repli.
    if (served.status === 502) {
      const body = (await served.json().catch(() => null)) as { upstreamStatus?: unknown; crashed?: unknown } | null;
      if (typeof body?.upstreamStatus === 'number') throw new UpstreamRefusedError(body.upstreamStatus);
      if (body?.crashed === true) throw new ExtractorCrashedError();
      return null;
    }
    if (!served.ok) return null;
    const data = (await served.json()) as Partial<ExtractedContent>;
    // Champ par champ, exactement comme le chemin local plus bas. Un
    // `{ ...data }` recopierait dans IndexedDB (`putExtract`) toute clé que
    // la route viendrait à ajouter, et laisserait passer un `title` absent —
    // `ExtractRecord extends ExtractedContent` ne vaudrait alors que ce que
    // vaut le JSON reçu.
    if (data && typeof data.content === 'string' && data.content) {
      return {
        title: data.title || '',
        content: sanitizeExtracted(data.content),
        excerpt: data.excerpt || '',
        byline: data.byline || '',
        siteName: data.siteName || '',
        length: data.length || 0,
      };
    }
    return null;
  });

  // Le drapeau est posé dès le PREMIER 429 et il survit à l'échec de la
  // seconde tentative : sans cela, une seconde tentative qui LÈVE — abandon au
  // bout de `SERVER_EXTRACT_TIMEOUT_MS`, panne réseau — était avalée par le
  // `catch` du repli, et `/api/proxy` recevait la requête que ce chemin existe
  // justement pour éviter. Seule une seconde réponse qui n'est PLUS un 429 le
  // lève : le seau a laissé passer, le navigateur peut retenter sa chance.
  let rateLimited = false;
  try {
    let served = await askServer();
    if (served && 'limited' in served) {
      rateLimited = true;
      // Cadence dépassée : on attend ce que le backend demande, une fois,
      // plutôt que de laisser tomber l'article — voir `RATE_LIMIT_MAX_WAIT_MS`.
      // Sans délai exploitable (`retryAfterMs` rend alors `null`), il n'y a
      // rien à attendre : l'article est abandonné pour ce passage.
      if (served.wait != null) {
        const wait = served.wait;
        await new Promise((resolve) => setTimeout(resolve, wait));
        served = await askServer();
        rateLimited = !!(served && 'limited' in served);
      }
    }
    if (served && !('limited' in served)) return served;
  } catch (err) {
    if (err instanceof NotAPageError || err instanceof UpstreamRefusedError || err instanceof PageTooComplexError
      || err instanceof ExtractTimeoutError || err instanceof ExtractorBusyError || err instanceof ExtractorCrashedError
      || err instanceof NoContentError) throw err;
    /* repli */
  }

  // Le seau est partagé avec `/api/proxy` : y aller après un 429 est un échec
  // certain, doublé d'un jeton gaspillé.
  if (rateLimited) throw new RateLimitedError();

  // Fetch through the same-origin backend proxy (avoids CORS; the target is
  // passed in a header, auth via the FriRSS JWT).
  //
  // Borné lui aussi (`FALLBACK_EXTRACT_TIMEOUT_MS`) : un backend coincé coince
  // cette route-ci exactement comme la précédente, et ne minuter que la
  // première ne faisait que déplacer le blocage d'une ligne.
  const html = await withTimeout(FALLBACK_EXTRACT_TIMEOUT_MS, async (signal) => {
    const response = await fetch('/api/proxy', {
      headers: {
        'X-Proxy-Target': url,
        'X-Proxy-Accept': 'text/html',
        ...auth,
      },
      signal,
    });
    if (!response.ok) throw new FallbackHttpError(response.status);
    // Le corps est lu SOUS le signal : sans cela le minuteur retomberait à
    // l'arrivée des en-têtes, et une page distillée octet par octet tiendrait
    // encore la file.
    return await readPageText(response, FALLBACK_MAX_HTML_BYTES);
  });

  // Page piégée : refusée sur son texte, avant toute analyse — les seuils du
  // serveur (`EXTRACT_MAX_DEPTH`, `EXTRACT_MAX_ELEMENTS`, `server/extract.ts`).
  // Readability coûte le cube de la profondeur : sans cette borne, une page
  // que le serveur n'a pas pu refuser (route absente, serveur injoignable)
  // gelait l'onglet (relecture 1.9.0). Retenue pour la session. Cette borne
  // est de FORME, pas de durée : une page lente sous les seuils coûte encore
  // son analyse à l'onglet — d'où l'absence de repli sur les refus du
  // serveur (N-2).
  if (markupTooComplex(html, FALLBACK_MARKUP_LIMITS)) throw new PageTooComplexError();

  // Parse into a DOM document that Readability can work with. Rendre les URLs
  // absolues AVANT Readability, qui résout sinon contre `doc.baseURI` —
  // l'origine de FriRSS pour un document de `DOMParser`. Un `<base>` injecté
  // ici ne sert à rien : la CSP (`base-uri 'self'`) le refuse, et l'échec
  // n'apparaît que dans la console. Voir `absolutizeUrls`.
  const load = () => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    // Images paresseuses d'abord : leurs adresses `data-src` relatives sont
    // ensuite résolues avec les autres (A1).
    resolveLazyImages(parsed.documentElement);
    absolutizeUrls(parsed, url);
    // Les blocs étrangers à l'article sortent avant toute passe (M-04).
    stripBoilerplate(parsed.documentElement);
    // Puis le corps réparti en blocs cousins est réuni (troisième round).
    joinSplitBody(parsed.documentElement);
    return parsed;
  };

  // Extract readable content. Chaque document est vidé ensuite : Chrome le
  // garderait sinon en mémoire s'il porte une vidéo (`parsedDocument.ts`).
  let result: ReturnType<Readability['parse']>;
  const doc = load();
  let mainLength: number | null = null;
  try {
    // Mesuré AVANT Readability, qui modifie le document qu'il lit.
    mainLength = mainContainerTextLength(doc);
    // 500, la valeur par défaut de Readability et celle de la route serveur
    // (`READABILITY_CHAR_THRESHOLD`, `server/extract.ts`, qui dit pourquoi) :
    // à 50, une courte section restée après la première passe passait pour
    // l'article entier (L-04).
    result = new Readability(doc, { charThreshold: 500 }).parse();
  } finally {
    releaseDocument(doc);
  }

  // A4-02 : une liste n'est pas un article. Si Readability n'a gardé qu'elle,
  // le conteneur principal est relu sans elle, puis elle y est remise à sa
  // place (voir le serveur).
  const list = result?.content ? onlyAList(result.content) : null;
  if (result && list) {
    const retry = load();
    try {
      const around = keepOnlyMainContainer(retry) ? aroundTheList(retry, list) : null;
      if (around) result = { ...result, ...around };
    } finally {
      releaseDocument(retry);
    }
  }

  // A-1 : même seconde passe que la route serveur (`server/extract.ts`, qui
  // dit pourquoi) quand Readability n'a gardé qu'un fragment du conteneur que
  // la page désigne elle-même. Seul le corps est repris ; titre, auteur et
  // chapeau restent ceux de la passe normale.
  if (result?.content && mainLength != null && keptTooLittle(result.textContent || '', mainLength)) {
    const retry = load();
    try {
      if (keepOnlyMainContainer(retry)) {
        const again = new Readability(retry, MAIN_CONTAINER_OPTIONS).parse();
        if (again?.content && recoveredMore(again.textContent || '', result.textContent || '')) {
          result = { ...result, content: again.content, length: again.length };
        }
      }
    } finally {
      releaseDocument(retry);
    }
  }

  if (!result || !result.content) {
    throw new NoContentError();
  }

  const cleanContent = sanitizeExtracted(result.content);

  return {
    title: result.title || '',
    content: cleanContent,
    excerpt: result.excerpt || '',
    byline: result.byline || '',
    siteName: result.siteName || '',
    length: result.length || 0,
  };
}
