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

export function aroundTheList(doc: Document, list: OnlyList): { content: string; length: number; textContent: string } | null {
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
    textContent: (again.textContent || '').replace(token, () => list.text), // fonction : RX-05, voir le serveur
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

export function resolveLazyImages(root: Element): void {
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
    if (isZoomButton(button)) button.replaceWith(takeChildren(button));
  }
}

/**
 * Les enfants de `node`, dans l'ordre, déplacés un à un dans un fragment :
 * jamais en arguments, la pile déborde (RW-03, voir le serveur).
 */
function takeChildren(node: Node): DocumentFragment {
  const fragment = node.ownerDocument!.createDocumentFragment();
  while (node.firstChild) fragment.appendChild(node.firstChild);
  return fragment;
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

// ── Contrôles posés dans du code (REG-219) ───────────────────────────
// Copie de `keepCodeControlsAsText` (`server/extract.ts`, qui dit pourquoi :
// Readability retire tout `button`, `select`, `textarea`, `input`, et le
// bouton Twoslash du blog de Node.js emportait un identifiant du code).
const CODE_CONTROLS = 'button, select, textarea, input';

function controlText(control: Element): string {
  const tag = control.tagName.toLowerCase();
  if (tag === 'input') return control.getAttribute('value') || '';
  if (tag === 'select') {
    const option = control.querySelector('option[selected]') || control.querySelector('option');
    return option?.textContent || '';
  }
  return control.textContent || '';
}

function insideCode(control: Element): boolean {
  if (control.closest('code')) return true;
  const pre = control.closest('pre');
  return !!pre && !pre.querySelector('code');
}

export function keepCodeControlsAsText(root: Element): void {
  for (const control of Array.from(root.querySelectorAll(CODE_CONTROLS))) {
    if (!control.isConnected || !insideCode(control)) continue;
    const text = controlText(control);
    if (text) control.replaceWith(control.ownerDocument.createTextNode(text));
  }
}

// ── Blocs étrangers retirés avant toute passe (M-04) ─────────────────
// Copie de `stripBoilerplate` (`server/extract.ts`, qui dit pourquoi : mentions
// légales de The Verge ramassées par la seconde passe, fil d'Ariane et
// crédits de Schneier par la première ; publicités, affiliation, formulaire
// de lettre d'information, repli CodePen et colonne `#secondary` en A3).
// Règles, mots et gardes identiques — rien n'est jugé dans un `<pre>` ni un
// `<code>` (REG-219), et le sommaire de l'article reste (REG-222).
const BOILERPLATE_TAGS = new Set(['footer', 'nav', 'form']);
const BOILERPLATE_ROLES = new Set(['navigation', 'contentinfo']);
const BOILERPLATE_TOKENS = new Set([
  'related', 'comment', 'comments', 'breadcrumb', 'breadcrumbs', 'footer',
]);
/**
 * Voile de consentement d'un contenu intégré : sans citation ni média, hors
 * billet (A4-03, RX-03, voir le serveur). Seulement marqué, sur lui et ses
 * descendants, puis retiré APRÈS Readability (`withoutVeils`) : retiré avant,
 * le conteneur du message intégré, son frère, n'était plus que des liens et
 * Readability l'écartait (V2-02, voir le serveur). Son texte nu est enveloppé
 * d'un `<span>` marqué (RW-01), et la marque qu'une page porterait déjà est
 * effacée d'abord (RW-02) : voir le serveur.
 */
const CONSENT_TOKEN = 'consent';
const VEIL = 'veil';
const VEIL_ATTR = 'data-frirss-veil';
/** Ni texte brut, ni contenu étranger : un `<span>` n'y a pas sa place. */
const VEIL_TEXT_UNWRAPPED = 'script, style, textarea, title, noscript, template, svg, math';

function markVeil(el: Element): void {
  const all = [el];
  for (const inner of Array.from(el.querySelectorAll('*'))) all.push(inner);
  for (const holder of all) {
    holder.setAttribute(VEIL_ATTR, '');
    if (holder.closest(VEIL_TEXT_UNWRAPPED)) continue;
    for (const node of Array.from(holder.childNodes)) {
      if (node.nodeType !== Node.TEXT_NODE || !(node.textContent || '').trim()) continue;
      const span = holder.ownerDocument.createElement('span');
      span.setAttribute(VEIL_ATTR, '');
      holder.insertBefore(span, node);
      span.appendChild(node);
    }
  }
}

/** Le HTML rendu par Readability sans les voiles marqués, la longueur et le texte. */
function withoutVeils(content: string, length: number, textContent: string): { content: string; length: number; textContent: string } {
  if (!content.includes(VEIL_ATTR)) return { content, length, textContent };
  const doc = new DOMParser().parseFromString(content, 'text/html');
  try {
    for (const veil of Array.from(doc.body.querySelectorAll(`[${VEIL_ATTR}]`))) veil.remove();
    const text = doc.body.textContent || '';
    return { content: doc.body.innerHTML, length: text.length, textContent: text };
  } finally {
    releaseDocument(doc);
  }
}
const EMBEDDED_CONTENT = 'blockquote, img, picture, video, audio, iframe, figure';
/** Bouton « retour en haut » : un nom entier de classe ou d'id, jamais un morceau découpé (RX-02, voir le serveur). */
const BACK_TO_TOP_NAME = /^(?:top|(?:back|go|scroll)?-?to-?top|scroll-?top|back-?top)(?:-(?:button|btn|link|anchor|arrow|icon))?$/;
/** Un lien payant (A4-03, voir le serveur). */
const PAID_LINK = /[?&]utm_medium=paid/i;
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
/** Du code : rien n'y est jugé, ni lui-même (REG-219, voir le serveur). */
const CODE = new Set(['pre', 'code']);
const POWERED_BY = /^powered by\b/i;
const POWERED_BY_MAX_LENGTH = 120;
const BYLINE_SIGNALS = '[rel~="author"], [itemprop*="author"], [class*="byline"], [id*="byline"], [class*="author"], [id*="author"], [class*="dateline"], [class*="writtenby"]';
const INVISIBLE = new Set(['script', 'style', 'template', 'noscript']);

/** Texte lisible d'un billet, mesuré une fois par nettoyage (B-02, voir le serveur). */
type PostLength = (post: Element) => number;

function isBoilerplate(el: Element, insideArticle: boolean, postLength: PostLength, paid: Map<Node, LinkCounts>, headingIds: () => Set<string>): boolean | typeof VEIL {
  const tag = el.tagName.toLowerCase();
  const role = (el.getAttribute('role') || '').toLowerCase();
  if ((BOILERPLATE_TAGS.has(tag) || BOILERPLATE_ROLES.has(role)) && !isTableOfContents(el, headingIds)) return true;
  if (!insideArticle && (tag === 'aside' || role === 'complementary' || (el.getAttribute('id') || '').toLowerCase() === 'secondary')) return true;
  if (el.hasAttribute('data-slug-hash') && hasCaptionSibling(el)) return true;
  const tokens = `${withoutTaxonomy(el.getAttribute('class'))} ${el.getAttribute('id') || ''}`.toLowerCase().split(/[^a-z0-9]+/);
  // Bouton « retour en haut » (A4-03, RX-02, voir le serveur).
  if (tag === 'a' && (el.getAttribute('href') || '').startsWith('#') && isBackToTop(el)) return true;
  if (!NAMED_EXEMPT.has(tag)) {
    if (tokens.some((token) => BOILERPLATE_TOKENS.has(token))) return true;
    if (!isPostContainer(tag, role)) {
      if (tokens.includes(CONSENT_TOKEN) && !el.querySelector(EMBEDDED_CONTENT)) return VEIL;
      if (tokens.includes('newsletter') && el.querySelector(FORM_CONTROLS) && !carriesMostOfItsPost(el, postLength)) return true;
      if (tokens.some((token) => SHORT_BLOCK_TOKENS.has(token))
        && visibleTextLength(el, SHORT_BLOCK_MAX) < SHORT_BLOCK_MAX) return true;
      const counts = paid.get(el);
      if (counts && isPaidPromotion(counts) && !carriesMostOfItsPost(el, postLength, counts.text)) return true;
    }
  }
  if (el.childElementCount <= 3 && Array.from(el.children).every((child) => child.childElementCount === 0)) {
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length <= POWERED_BY_MAX_LENGTH && POWERED_BY.test(text)) return true;
  }
  return false;
}

/** Un nom entier de classe ou d'id de bouton « retour en haut » (RX-02, voir le serveur). */
function isBackToTop(el: Element): boolean {
  const names = `${el.getAttribute('class') || ''} ${el.getAttribute('id') || ''}`.toLowerCase().replace(/_/g, '-').split(/\s+/);
  return names.some((name) => BACK_TO_TOP_NAME.test(name));
}

/** Encart publicitaire : court, tous ses liens payants, l'un sur une image, moins de la moitié de son billet (A4-03, voir le serveur). */
function isPaidPromotion(counts: LinkCounts): boolean {
  return counts.text < SHORT_BLOCK_MAX && counts.links === counts.paidLinks && counts.paidImageLinks > 0;
}

/** Sous un élément : texte lisible, liens, liens payants, liens payants sur une image (RX-04, voir le serveur). */
interface LinkCounts { text: number; links: number; paidLinks: number; paidImageLinks: number; image: boolean }

/** Les ancêtres d'un lien payant, avec leurs comptes faits de bas en haut en une passe (RX-04, voir le serveur). */
function paidLinkAncestors(root: Element): Map<Node, LinkCounts> {
  const candidates = new Map<Node, LinkCounts | null>();
  for (const link of Array.from(root.querySelectorAll('a[href*="utm_medium"]'))) {
    if (!PAID_LINK.test(link.getAttribute('href') || '')) continue;
    for (let up: Node | null = link; up && up !== root && !candidates.has(up); up = up.parentNode) candidates.set(up, null);
  }
  const found = new Map<Node, LinkCounts>();
  if (!candidates.size) return found;
  const order: Element[] = [];
  const stack: Element[] = [root];
  while (stack.length) {
    const el = stack.pop()!;
    order.push(el);
    for (let child = el.firstElementChild; child; child = child.nextElementSibling) stack.push(child);
  }
  // Les enfants avant leur parent ; un compte sert une fois, puis s'oublie.
  const counts = new Map<Element, LinkCounts>();
  for (let i = order.length - 1; i >= 0; i--) {
    const el = order[i];
    const invisible = INVISIBLE.has(el.tagName.toLowerCase());
    const mine: LinkCounts = { text: 0, links: 0, paidLinks: 0, paidImageLinks: 0, image: false };
    for (let node = el.firstChild; node; node = node.nextSibling) {
      if (node.nodeType === 3) {
        if (!invisible) mine.text += (node.textContent || '').replace(/\s+/g, ' ').length;
        continue;
      }
      const below = node.nodeType === 1 ? counts.get(node as Element) : undefined;
      if (!below) continue;
      const child = node as Element;
      counts.delete(child);
      const tag = child.tagName.toLowerCase();
      if (!invisible) mine.text += below.text;
      mine.links += below.links;
      mine.paidLinks += below.paidLinks;
      mine.paidImageLinks += below.paidImageLinks;
      mine.image ||= below.image || tag === 'img';
      if (tag === 'a' && child.hasAttribute('href')) {
        mine.links++;
        if (PAID_LINK.test(child.getAttribute('href') || '')) {
          mine.paidLinks++;
          if (below.image) mine.paidImageLinks++;
        }
      }
    }
    counts.set(el, mine);
    if (candidates.has(el)) found.set(el, mine);
  }
  return found;
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
 *  Le billet n'est pas relu à chaque bloc (B-02) : `postLength` le mesure une fois ; `length`, déjà connu pour un encart payant. */
function carriesMostOfItsPost(el: Element, postLength: PostLength, length?: number): boolean {
  const post = el.parentElement?.closest('article, main, [role="main"]');
  if (!post) return false;
  const half = postLength(post) * MAIN_CONTAINER_MIN_SHARE;
  return (length ?? visibleTextLength(el, half)) >= half;
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

/** Une entrée de sommaire mène à un titre de la page : le titre lui-même, ou un repère posé dedans. */
const HEADING = 'h1, h2, h3, h4, h5, h6';
/** Un sommaire a au moins deux entrées : un lien seul (« Aller au contenu ») n'en est pas un. */
const TOC_MIN_LINKS = 2;

/**
 * Le sommaire de l'article (REG-222) : une navigation dont CHAQUE lien mène,
 * par une ancre de la page, à l'un de ses titres. Il reste : c'est le seul
 * endroit où se lit un intertitre dont l'id porte un mot que Readability juge
 * « improbable » — `<h2 id="recap-the-forwarded-header">`, retiré par
 * Readability lui-même depuis toujours ; la 1.8.0 en gardait le texte par le
 * sommaire. Un menu de site mène à d'autres pages, un « Aller au contenu » à
 * un conteneur : ni l'un ni l'autre n'est un sommaire.
 */
function isTableOfContents(el: Element, headingIds: () => Set<string>): boolean {
  if (el.tagName.toLowerCase() !== 'nav' && (el.getAttribute('role') || '').toLowerCase() !== 'navigation') return false;
  const links = Array.from(el.querySelectorAll('a[href]'));
  if (links.length < TOC_MIN_LINKS) return false;
  return links.every((link) => {
    const href = (link.getAttribute('href') || '').trim();
    if (!href.startsWith('#') || href.length < 2) return false;
    let id = href.slice(1);
    try { id = decodeURIComponent(id); } catch { /* une ancre mal encodée se lit telle quelle */ }
    return headingIds().has(id);
  });
}

/** Les ids portés par un titre ou par un élément d'un titre, lus une fois par nettoyage. */
function headingIdsUnder(root: Element): () => Set<string> {
  let ids: Set<string> | undefined;
  return () => {
    if (!ids) {
      ids = new Set();
      for (const heading of Array.from(root.querySelectorAll(HEADING))) {
        if (heading.id) ids.add(heading.id);
        for (const inner of Array.from(heading.querySelectorAll('[id]'))) ids.add(inner.id);
      }
    }
    return ids;
  };
}

/** Retire de `root` (jamais `root` lui-même) les blocs étrangers à l'article. */
export function stripBoilerplate(root: Element): void {
  // La marque du voile est à FriRSS (RW-02, voir le serveur).
  root.removeAttribute(VEIL_ATTR);
  for (const el of Array.from(root.querySelectorAll(`[${VEIL_ATTR}]`))) el.removeAttribute(VEIL_ATTR);
  const total = visibleTextLength(root);
  // Billets déjà mesurés, tenus à jour à chaque retrait (B-02, voir le serveur).
  const posts = new Map<Element, number>();
  const postLength: PostLength = (post) => {
    let length = posts.get(post);
    if (length === undefined) posts.set(post, length = visibleTextLength(post));
    return length;
  };
  // Seuls les ancêtres d'un lien payant peuvent être un encart publicitaire (A4-03).
  const paid = paidLinkAncestors(root);
  // Les cibles d'un sommaire (REG-222), relevées au premier `<nav>` rencontré.
  const headingIds = headingIdsUnder(root);
  const stack: Array<[Element, boolean]> = Array.from(root.children, (child) => [child, false]);
  while (stack.length) {
    const [el, insideArticle] = stack.pop()!;
    if (CODE.has(el.tagName.toLowerCase())) continue;
    const verdict = isBoilerplate(el, insideArticle, postLength, paid, headingIds);
    if (verdict) {
      const length = visibleTextLength(el);
      if (length < total * MAIN_CONTAINER_MIN_SHARE && !carriesByline(el)) {
        // Un voile reste jusqu’après Readability (V2-02, voir le serveur).
        if (verdict === VEIL) {
          markVeil(el);
          continue;
        }
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
    body.append(takeChildren(node));
  } else if (holders.has(node)) {
    for (const child of Array.from(node.childNodes)) pourGap(child, body, members, holders);
  } else if (isReadable(node)) {
    body.append(node);
  }
}

export function joinSplitBody(root: Element): void {
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
        body.append(takeChildren(block));
        block.remove();
      });
    }
  }
}

// ── Garde de non-perte (REG-220 à REG-222) ───────────────────────────
// Copie de la garde de `server/extract.ts`, qui dit pourquoi : le nettoyage et
// la réunion du corps réparti changent le bloc que choisit Readability, et le
// chapeau, l'image ou la légende d'en-tête, frères du corps, sortaient (The
// Verge, Ars Technica, blog de Google). Le résultat est comparé à un témoin —
// la page lue intacte à 50, comme en 1.8.0 — et ce que le témoin garde dans le
// conteneur de l'article NETTOYÉ, avant l'ouverture du résultat (après aussi,
// quand le résultat est sous le seuil), y est remis, en suite contiguë et à sa
// place dans la page.
// Règles, seuils et bornes identiques ; toute modification de l'une va avec
// l'autre, et avec `EXTRACT_VERSION`.
const READABILITY_CHAR_THRESHOLD = 500;

/** Seuil du témoin : celui de la 1.8.0, dont le corpus mesure les pertes. */
const WITNESS_CHAR_THRESHOLD = 50;

/**
 * Le témoin est lu sauf si la page intacte coûte à la fois plus de ce multiple
 * de la page nettoyée ET plus de `WITNESS_COST_FLOOR` (`readingCost`, RG-05) :
 * quand le nettoyage a retiré une part coûteuse (un pied de chaînes
 * imbriquées : 0,67 s de Readability contre 47 ms), la garde y renonce plutôt
 * que de payer la page entière une seconde fois. Le rapport seul ne suffit
 * pas : mesuré sur 470 pages (2026-11-07), 228 dépassent 2 — menus et pieds
 * de The Verge (2,04), du blog de Google (4,09) — pour un coût dérisoire.
 */
const WITNESS_MAX_COST_RATIO = 2;
/**
 * En deçà, le témoin coûte ce que coûte une vraie page : la plus coûteuse du
 * corpus (Wikipédia, 3 Mo, 0,5 s) pèse 5,7 millions ; le pied piégé de la
 * relecture, 160 millions.
 */
const WITNESS_COST_FLOOR = 8_000_000;

/** Un bloc de texte ou de média, lu dans la page ou dans un résultat. */
class Unit {
  private normCache?: string;
  private trackedCache?: string[];
  /**
   * `blocks` : le texte lisible, par bloc. `images` : une liste d'adresses par
   * image (`src`, puis, dans la page, les variantes qu'elle a en réserve).
   * `byline` : le bloc est, dans la page, sous la signature de l'auteur
   * (`BYLINE_SIGNALS`) — la garde ne le remet jamais (RG-04).
   */
  constructor(readonly el: Element, private readonly blocks: string[], readonly images: string[][], readonly byline = false) {}
  /** Longueur du texte brut. */
  get size(): number {
    let length = 0;
    for (const block of this.blocks) length += block.length + 1;
    return length;
  }
  /** Texte normalisé, encadré d'espaces (`normalized`) — calculé à la première lecture. */
  get norm(): string {
    return this.normCache ??= ` ${normalized(this.blocks.join(' '))} `;
  }
  /** Phrases suivies, normalisées — calculées à la première lecture. */
  get tracked(): string[] {
    return this.trackedCache ??= this.blocks.flatMap(sentencesOf).filter(isTracked);
  }
}

type FrameUnits = Unit[];

/** Éléments lus comme un seul bloc. */
const UNIT_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'dl', 'blockquote', 'pre', 'table', 'figure', 'picture', 'img']);
/** Ce qui ne se lit pas : scripts, textes de repli des médias, contrôles. */
const UNREAD = new Set(['script', 'style', 'template', 'noscript', 'audio', 'video', 'object', 'iframe', 'svg', 'canvas', 'button', 'select', 'textarea']);
/** Fins de bloc, pour découper les phrases comme le corpus. */
const BLOCK_ENDS = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'blockquote', 'figcaption', 'br', 'div', 'tr', 'dt', 'dd', 'pre', 'figure', 'section', 'article', 'header', 'footer', 'aside', 'ul', 'ol', 'dl', 'table', 'caption']);
/** Un élément de bloc : un texte qui le contient n'est pas un paragraphe à lui seul. */
const BLOCKS = new Set([...UNIT_TAGS, ...BLOCK_ENDS].filter((tag) => tag !== 'br' && tag !== 'img'));
const SPACED_ENDS = new Set(['.', '!', '?', '…', '؟']);
const WIDE_ENDS = new Set(['。', '！', '？']);
const CLOSERS = new Set(['"', "'", '”', '’', '»', ')', ']', '）', '」', '』', '》', '〉', '】']);
const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/gu;
/** Une phrase plus courte ne compte pas (dates, rubriques, « Credit: ») — la règle du corpus. */
const TRACKED_MIN = 25;
const TRACKED_MIN_NO_SPACE = 8;
/**
 * Bornes de la recherche de l'ouverture (`openingIn`) : une page faite de la
 * même phrase répétée ne coûte pas le carré de sa taille. Seize occurrences et
 * huit blocs suffisent à séparer un chapeau répété du début du corps.
 */
const OPENING_CANDIDATES = 16;
const OPENING_LOOKAHEAD = 8;

/** Forme comparable : NFKC, minuscules, ponctuation et blancs réduits à une espace. */
function normalized(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[\p{P}\s\u00ad\u200b]+/gu, ' ').trim();
}

/** `needle` (normalisé) se lit-il, mots entiers, dans `haystack` (normalisé, encadré d'espaces) ? */
function reads(haystack: string, needle: string): boolean {
  return haystack.includes(` ${needle} `);
}

function isTracked(sentence: string): boolean {
  if (sentence.length < TRACKED_MIN_NO_SPACE) return false;
  // Au-delà du double du seuil, même tout en paires de substitution, la phrase compte.
  if (sentence.length >= 2 * TRACKED_MIN) return true;
  const letters = sentence.match(/\p{L}/gu)?.length ?? 0;
  const wide = sentence.match(NO_SPACE_SCRIPT)?.length ?? 0;
  return [...sentence].length >= (letters && wide / letters >= 0.3 ? TRACKED_MIN_NO_SPACE : TRACKED_MIN);
}

/** Les phrases d'un bloc de texte : ponctuation forte (comme le corpus). */
function sentencesOf(block: string): string[] {
  // Par unité de code : toutes les ponctuations cherchées sont du plan de base.
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < block.length;) {
    if (!WIDE_ENDS.has(block[i]) && !SPACED_ENDS.has(block[i])) { i++; continue; }
    const wide = WIDE_ENDS.has(block[i]);
    let j = i + 1;
    while (j < block.length && (WIDE_ENDS.has(block[j]) || SPACED_ENDS.has(block[j]))) j++;
    while (j < block.length && CLOSERS.has(block[j])) j++;
    if (wide || j >= block.length || /\s/.test(block[j])) {
      out.push(block.slice(start, j));
      start = j;
    }
    i = j;
  }
  out.push(block.slice(start));
  return out.map(normalized).filter(Boolean);
}

/** Le texte lisible de `el`, découpé en blocs (fins de bloc, textes de repli exclus). */
function blocksOf(el: Element): string[] {
  const blocks: string[] = [];
  let current = '';
  const stack: Array<Node | null> = [el];
  while (stack.length) {
    const node = stack.pop();
    // `null` : la fin d'un bloc.
    if (node === null) { blocks.push(current); current = ''; continue; }
    if (node!.nodeType === 3) { current += node!.textContent || ''; continue; }
    if (node!.nodeType !== 1) continue;
    const tag = (node as Element).tagName.toLowerCase();
    if (UNREAD.has(tag)) continue;
    if (BLOCK_ENDS.has(tag)) { blocks.push(current); current = ''; stack.push(null); }
    const children = Array.from(node!.childNodes);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  blocks.push(current);
  return blocks.map((block) => block.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** Adresse absolue, ou `null` (une image en ligne `data:` n'en a pas). */
function absolute(value: string | null, base: string): string | null {
  const v = value?.trim();
  if (!v || /^data:/i.test(v)) return null;
  try { return new URL(v, base).href; } catch { return null; }
}

/** Les adresses d'une image : `src`, puis, dans la page (`lenient`), celles qu'elle a en réserve. */
function imageAddresses(img: Element, base: string, lenient: boolean): string[] {
  const values = [img.getAttribute('src')];
  if (lenient) {
    values.push(img.getAttribute('data-src'));
    for (const holder of [img, ...(img.parentElement?.tagName.toLowerCase() === 'picture' ? Array.from(img.parentElement.children) : [])]) {
      for (const attr of ['srcset', 'data-srcset']) {
        for (const candidate of (holder.getAttribute(attr) || '').split(',')) values.push(candidate.trim().split(/\s+/)[0]);
      }
    }
  }
  return values.map((value) => absolute(value, base)).filter((value): value is string => !!value);
}

function unitOf(el: Element, base: string, lenient: boolean, byline = false): Unit {
  const images: string[][] = [];
  const imgs = el.tagName.toLowerCase() === 'img' ? [el] : Array.from(el.querySelectorAll('img')) as Element[];
  for (const img of imgs) {
    if (isIcon(img)) continue;
    const addresses = imageAddresses(img, base, lenient);
    if (addresses.length) images.push(addresses);
  }
  return new Unit(el, blocksOf(el), images, byline);
}

/**
 * Un élément qui porte lui-même du texte et aucun bloc : un paragraphe écrit
 * sans `<p>` (`<div><span>texte</span></div>`), que Readability changera en
 * paragraphe.
 */
function looseText(el: Element): boolean {
  let text = false;
  for (let node = el.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 3) text ||= !!(node.textContent || '').trim();
    else if (node.nodeType === 1 && BLOCKS.has((node as Element).tagName.toLowerCase())) return false;
  }
  return text;
}

/** Les blocs de `root`, dans l'ordre. `lenient` : une image se reconnaît à toutes ses adresses (page). */
function unitsOf(root: Element, base: string, lenient = false): Unit[] {
  const units: Unit[] = [];
  const stack: Array<[Element, boolean]> = [[root, false]];
  while (stack.length) {
    const [el, inByline] = stack.pop()!;
    // Dans la page, un voile de consentement n'est pas de l'article (V2-02).
    if (lenient && el.hasAttribute(VEIL_ATTR)) continue;
    const byline = inByline || (lenient && el !== root && el.matches(BYLINE_SIGNALS));
    const tag = el.tagName.toLowerCase();
    if (el !== root && (UNIT_TAGS.has(tag) || looseText(el))) { units.push(unitOf(el, base, lenient, byline)); continue; }
    if (UNREAD.has(tag)) continue;
    for (let child = el.lastElementChild; child; child = child.previousElementSibling) stack.push([child, byline]);
  }
  return units;
}

/** Les blocs du conteneur de l'article, lus dans la page avant Readability (`null` sans conteneur). */
function frameOf(container: Element | null, base: string): FrameUnits | null {
  return container ? unitsOf(container, base, true) : null;
}

/** Ce que garde un résultat : ses phrases, son texte normalisé, ses images. */
interface Kept { sentences: Set<string>; norm: string; images: Set<string> }

function keptOf(root: Element, base: string): Kept {
  const images = new Set<string>();
  for (const img of Array.from(root.querySelectorAll('img')) as Element[]) {
    const src = absolute(img.getAttribute('src'), base);
    if (src) images.add(src);
  }
  const blocks = blocksOf(root);
  return { sentences: new Set(blocks.flatMap(sentencesOf)), norm: ` ${normalized(blocks.join(' '))} `, images };
}

/**
 * Caractères que la garde peut encore relire en cherchant une phrase dans un
 * texte (`holds`, `placed`). Une phrase se trouve d'abord entière, dans un
 * index ; la recherche dans le texte ne sert qu'aux phrases découpées
 * autrement. Sur une page faite pour cela — des milliers de phrases absentes,
 * chacune cherchée dans 2 Mo —, ce budget épuisé, la garde s'abstient :
 * le résultat reste celui de la passe nettoyée.
 */
interface Scan { left: number }
/** Le budget : ce multiple du texte lu (conteneur et résultat), plus une part fixe pour les petites pages. */
const SCAN_FACTOR = 32;
const SCAN_FLOOR = 8_000_000;

/** `reads`, en décomptant du budget ce que la recherche a parcouru. */
function scanned(haystack: string, needle: string, scan: Scan): boolean {
  const found = haystack.indexOf(` ${needle} `);
  scan.left -= found < 0 ? haystack.length : found + needle.length;
  return found >= 0;
}

/** Le résultat lit-il cette phrase ? Budget épuisé : oui — la garde n'y touche plus. */
function holds(kept: Kept, sentence: string, scan: Scan): boolean {
  if (kept.sentences.has(sentence)) return true;
  if (scan.left <= 0) return true;
  return scanned(kept.norm, sentence, scan);
}

/**
 * Le bloc du conteneur où commence le résultat : parmi ceux qui portent sa
 * première phrase, celui qui ouvre la plus longue suite de blocs que le
 * résultat garde. Une phrase répétée (un chapeau repris en premier paragraphe,
 * un titre répété dans la page) ne déplace donc pas l'ouverture. -1 si aucun.
 */
function openingIn(frame: FrameUnits, opening: string, missing: (unit: Unit) => boolean): number {
  let best = -1;
  let bestRun = -1;
  let candidates = 0;
  for (let i = 0; i < frame.length && candidates < OPENING_CANDIDATES; i++) {
    if (!reads(frame[i].norm, opening)) continue;
    candidates++;
    const end = Math.min(frame.length, i + OPENING_LOOKAHEAD);
    let j = i;
    while (j < end && !missing(frame[j])) j++;
    // Une suite entière : c'est l'ouverture, sans lire plus loin.
    if (j === end) return i;
    if (j - i > bestRun) { best = i; bestRun = j - i; }
  }
  return best;
}

/** La première phrase suivie de `root`, sans lire au-delà. */
function firstTracked(root: Element): string | undefined {
  const stack: Element[] = [root];
  while (stack.length) {
    const el = stack.pop()!;
    const tag = el.tagName.toLowerCase();
    if (el !== root && (UNIT_TAGS.has(tag) || looseText(el))) {
      const found = blocksOf(el).flatMap(sentencesOf).find(isTracked);
      if (found) return found;
      continue;
    }
    if (UNREAD.has(tag)) continue;
    for (let child = el.lastElementChild; child; child = child.previousElementSibling) stack.push(child);
  }
  return undefined;
}

/** Longueur du texte brut du conteneur — pour le budget, sans normaliser. */
function frameLength(frame: FrameUnits): number {
  let length = 0;
  for (const unit of frame) length += unit.size;
  return length;
}

/**
 * Où se lisent, dans le conteneur, chaque phrase, chaque bloc court (son
 * texte entier) et chaque image, relevé une fois. `placeable` et `shortBlocks`
 * ne comptent pas les blocs de la signature de l'auteur, que la garde ne remet
 * jamais ; `all` et `allBlocks` les comptent (pour situer le résultat).
 */
interface FrameIndex {
  placeable: Map<string, number[]>;
  all: Map<string, number[]>;
  shortBlocks: Map<string, number[]>;
  allBlocks: Map<string, number[]>;
  images: Map<string, number[]>;
}

function indexOf(frame: FrameUnits): FrameIndex {
  const placeable = new Map<string, number[]>();
  const all = new Map<string, number[]>();
  const shortBlocks = new Map<string, number[]>();
  const allBlocks = new Map<string, number[]>();
  const images = new Map<string, number[]>();
  const note = (map: Map<string, number[]>, key: string, i: number) => {
    const at = map.get(key);
    if (!at) map.set(key, [i]);
    else if (at[at.length - 1] !== i) at.push(i);
  };
  frame.forEach((unit, i) => {
    for (const s of unit.tracked) {
      note(all, s, i);
      if (!unit.byline) note(placeable, s, i);
    }
    if (!unit.tracked.length) {
      const text = unit.norm.trim();
      if (text) {
        note(allBlocks, text, i);
        if (!unit.byline) note(shortBlocks, text, i);
      }
    }
    if (!unit.byline) for (const variants of unit.images) for (const address of variants) note(images, address, i);
  });
  return { placeable, all, shortBlocks, allBlocks, images };
}

/**
 * Le premier bloc du conteneur, entre `from` (inclus) et `to` (exclu) et hors
 * de la signature de l'auteur, qui lit la phrase `needle` ; -1 si aucun.
 */
function placeIn(frame: FrameUnits, index: FrameIndex, needle: string, from: number, to: number, scan: Scan): number {
  const known = index.placeable.get(needle)?.find((i) => i >= from && i < to);
  if (known !== undefined) return known;
  for (let i = from; i < to; i++) {
    if (scan.left <= 0) return -1;
    if (!frame[i].byline && scanned(frame[i].norm, needle, scan)) return i;
  }
  return -1;
}

/** Blocs de texte terminaux : ceux qu'un bloc remis perd quand le résultat les lit déjà. */
const LEAF_BLOCKS = 'p, li, figcaption, h1, h2, h3, h4, h5, h6, blockquote, dt, dd, td, th, caption, div';

/**
 * Retire de `el` (jamais `el` lui-même) chaque bloc terminal que le résultat
 * lisait déjà (RG-02 : la légende d'une image perdue, une entrée de liste déjà
 * lue). Un paragraphe qui mêle une phrase lue et une phrase perdue reste
 * entier : un doublon plutôt qu'une perte.
 */
function withoutWhatIsRead(el: Element, base: string, alreadyRead: (unit: Unit) => boolean): void {
  for (const leaf of Array.from(el.querySelectorAll(LEAF_BLOCKS)) as Element[]) {
    if (!leaf.isConnected || Array.from(leaf.children).some((child) => BLOCKS.has(child.tagName.toLowerCase()))) continue;
    if (alreadyRead(unitOf(leaf, base, false))) leaf.remove();
  }
}

/**
 * Verse les blocs remis dans le résultat, chacun à sa place dans l'ordre de
 * la page (RG-03) : avant le premier bloc du résultat qui le suit dans le
 * conteneur, sinon après le dernier qui le précède.
 */
function placeInResult(root: Element, picked: Array<{ unit: Unit; place: number }>, index: FrameIndex, base: string): void {
  const page = root.children.length === 1 ? root.firstElementChild! : root;
  const own: Array<{ el: Element; place: number }> = [];
  for (const unit of unitsOf(page, base)) {
    let place = -1;
    for (const s of unit.tracked) {
      const at = index.all.get(s);
      if (at) { place = at[0]; break; }
    }
    if (place < 0 && !unit.tracked.length) place = index.allBlocks.get(unit.norm.trim())?.[0] ?? -1;
    if (place < 0) {
      for (const addresses of unit.images) {
        const at = index.images.get(addresses[0]);
        if (at) { place = at[0]; break; }
      }
    }
    if (place >= 0) own.push({ el: unit.el, place });
  }
  /** Le dernier bloc versé après un bloc du résultat : le suivant va après lui. */
  let tail: { after: Element; inserted: Element } | null = null;
  for (const { unit, place } of picked) {
    const html = unit.el.outerHTML;
    const next = own.find((mine) => mine.place > place);
    if (next) {
      next.el.insertAdjacentHTML('beforebegin', html);
      continue;
    }
    const previous = [...own].reverse().find((mine) => mine.place <= place);
    const ref: Element | null = tail && tail.after === previous?.el ? tail.inserted : previous?.el ?? null;
    if (ref) {
      ref.insertAdjacentHTML('afterend', html);
      tail = { after: previous!.el, inserted: ref.nextElementSibling! };
    } else {
      page.insertAdjacentHTML('beforeend', html);
    }
  }
}

/** Le résultat de la passe nettoyée, sans perte de ce que garde le témoin (voir plus haut). */
function withoutLoss(strict: Pass, witness: () => string | null, parse: (html: string) => Element, base: string): ExtractedContent {
  const frame = strict.frame;
  if (!frame?.length || !strict.affordable) return strict.article;
  const root = parse(strict.article.content);
  const kept = keptOf(root, base);
  const title = ` ${normalized(strict.article.title)} `;
  const opening = firstTracked(root);
  if (!opening) return strict.article;
  const scan: Scan = { left: SCAN_FACTOR * (kept.norm.length + frameLength(frame)) + SCAN_FLOOR };
  // Ce que le résultat n'a pas (le titre, que le lecteur affiche à part, mis à part).
  const absent = (s: string) => !holds(kept, s, scan) && !reads(title, s);
  const absentImage = (addresses: string[]) => !addresses.some((src) => kept.images.has(src));
  const missing = (unit: Unit) => unit.tracked.some(absent) || unit.images.some(absentImage);
  const at = openingIn(frame, opening, missing);
  if (at < 0) return strict.article;
  const short = normalizedLength(strict.textContent) < READABILITY_CHAR_THRESHOLD;
  // Rien d'absent à l'endroit visé : pas de témoin, pas de passe de plus.
  if (!frame.slice(0, at).some(missing) && !(short && frame.slice(at + 1).some(missing))) return strict.article;
  const html = witness();
  if (!html) return strict.article;
  const units = unitsOf(parse(html), base);
  // Le témoin englobe-t-il le résultat ? Alors ce qui précède son ouverture est l'en-tête.
  const anchor = units.findIndex((unit) => reads(unit.norm, opening));
  const index = indexOf(frame);
  // Ce que lisait le résultat avant toute remise (RG-02).
  const before: Kept = { sentences: new Set(kept.sentences), norm: kept.norm, images: new Set(kept.images) };
  /** Le bloc est-il tout entier déjà lu (par `reader`), ou vide ? */
  const readBy = (reader: Kept) => (unit: Unit) => {
    if (unit.tracked.some((s) => !holds(reader, s, scan) && !reads(title, s))) return false;
    if (unit.images.some((addresses) => !addresses.some((src) => reader.images.has(src)))) return false;
    const text = unit.norm.trim();
    return !text ? !unit.images.length : unit.tracked.length > 0 || reads(reader.norm, text) || reads(title, text);
  };
  const read = readBy(kept);
  /** Où le bloc du témoin se lit dans le conteneur, entre `from` et `to` ; -1 s'il n'y est pas tout entier. */
  const placeOf = (unit: Unit, from: number, to: number) => {
    const places: number[] = [];
    for (const s of unit.tracked.filter(absent)) places.push(placeIn(frame, index, s, from, to, scan));
    for (const addresses of unit.images.filter(absentImage)) places.push(index.images.get(addresses[0])?.find((i) => i >= from && i < to) ?? -1);
    // Un bloc court, sans phrase suivie absente : un bloc du conteneur au même
    // texte exactement (« by Brad Bourque » ne se place pas dans « See all by
    // Brad Bourque »).
    if (!places.length) places.push(index.shortBlocks.get(unit.norm.trim())?.find((i) => i >= from && i < to) ?? -1);
    return places.some((place) => place < 0) ? -1 : Math.min(...places);
  };
  /**
   * La suite du témoin à remettre, entre les blocs `first` (inclus) et `last`
   * (exclu), d'un côté de l'ouverture : du premier au dernier bloc qui porte
   * une phrase suivie ou une image absente et se lit dans le conteneur
   * (RG-01), les blocs courts d'entre eux compris — sauf ce qui est déjà lu,
   * hors du conteneur, ou dans la signature de l'auteur (RG-04).
   */
  const run = (first: number, last: number, from: number, to: number) => {
    const picked: Array<{ unit: Unit; place: number }> = [];
    let start = -1;
    let end = -1;
    for (let i = first; i < last; i++) {
      if (missing(units[i]) && placeOf(units[i], from, to) >= 0) {
        if (start < 0) start = i;
        end = i;
      }
    }
    for (let i = start; start >= 0 && i <= end; i++) {
      const unit = units[i];
      if (read(unit)) continue;
      const place = placeOf(unit, from, to);
      if (place < 0) continue;
      picked.push({ unit, place });
      // Un bloc remis est lu : son double plus loin (un chapeau doublé pour mobile) ne revient pas.
      for (const s of unit.tracked) kept.sentences.add(s);
      for (const addresses of unit.images) kept.images.add(addresses[0]);
      kept.norm += `${unit.norm.trim()} `;
    }
    return picked;
  };
  const picked = [
    ...(anchor >= 0 ? run(0, anchor, 0, at) : []),
    ...(short ? run(anchor + 1, units.length, at + 1, frame.length) : []),
  ];
  // Budget épuisé en chemin : la garde s'abstient en entier plutôt qu'à moitié.
  if (!picked.length || scan.left <= 0) return strict.article;
  const readBefore = readBy(before);
  for (const { unit } of picked) withoutWhatIsRead(unit.el, base, readBefore);
  placeInResult(root, picked, index, base);
  return { ...strict.article, content: root.innerHTML, length: (root.textContent || '').length };
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
  const article = extractFromPage(url, html);
  return { ...article, content: sanitizeExtracted(article.content) };
}

/**
 * L'extraction d'une page déjà lue, garde de non-perte comprise (`guard`,
 * vrai par défaut ; faux pour les tests qui vérifient qu'elle ne change rien).
 * Le contenu rendu n'est PAS assaini : `extractOnce` le fait.
 */
export function extractFromPage(url: string, html: string, guard = true): ExtractedContent {
  const strict = pagePass(url, html, { mode: 'strip', frame: true });
  if (!strict) throw new NoContentError();
  if (!guard) return strict.article;
  // La garde de non-perte (REG-220, voir le serveur).
  const witness = () => pagePass(url, html, { mode: 'raw', single: true, threshold: WITNESS_CHAR_THRESHOLD })?.article.content ?? null;
  // La garde ne fait jamais échouer une extraction (voir le serveur).
  try {
    return withFragments((parse) => withoutLoss(strict, witness, parse, url));
  } catch {
    return strict.article;
  }
}

/** Une passe d'extraction, et ce qu'elle a mesuré de la page (voir le serveur). */
interface Pass { article: ExtractedContent; textContent: string; frame: FrameUnits | null; affordable: boolean }

interface PassOptions {
  /** `strip` : nettoyage et réunion avant toute passe ; `raw` : la page intacte (le témoin). */
  mode: 'strip' | 'raw';
  frame?: boolean;
  single?: boolean;
  threshold?: number;
}

function pagePass(url: string, html: string, options: PassOptions): Pass | null {
  const { mode, threshold = 500 } = options;
  const load = () => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    // Images paresseuses d'abord : leurs adresses `data-src` relatives sont
    // ensuite résolues avec les autres (A1).
    resolveLazyImages(parsed.documentElement);
    // Les contrôles posés dans du code deviennent texte (REG-219).
    keepCodeControlsAsText(parsed.documentElement);
    absolutizeUrls(parsed, url);
    return parsed;
  };
  const clean = (parsed: Document) => {
    if (mode === 'strip') {
      // Les blocs étrangers à l'article sortent avant toute passe (M-04).
      stripBoilerplate(parsed.documentElement);
      // Puis le corps réparti en blocs cousins est réuni (troisième round).
      joinSplitBody(parsed.documentElement);
    }
    return parsed;
  };

  // Extract readable content. Chaque document est vidé ensuite : Chrome le
  // garderait sinon en mémoire s'il porte une vidéo (`parsedDocument.ts`).
  let result: ReturnType<Readability['parse']>;
  const doc = load();
  // Le coût de lecture de la page intacte, puis nettoyée (RG-05, voir le serveur).
  const intactCost = options.frame ? readingCost(doc) : 0;
  clean(doc);
  const affordable = !options.frame || intactCost <= WITNESS_COST_FLOOR || intactCost <= WITNESS_MAX_COST_RATIO * readingCost(doc);
  let mainLength: number | null = null;
  let frame: FrameUnits | null = null;
  try {
    // Mesurés AVANT Readability, qui modifie le document qu'il lit.
    mainLength = options.single ? null : mainContainerTextLength(doc);
    frame = options.frame ? frameOf(findMainContainer(doc), url) : null;
    // 500, la valeur par défaut de Readability et celle de la route serveur
    // (`READABILITY_CHAR_THRESHOLD`, `server/extract.ts`, qui dit pourquoi) :
    // à 50, une courte section restée après la première passe passait pour
    // l'article entier (L-04). Le témoin lit à 50, comme la 1.8.0.
    result = new Readability(doc, { charThreshold: threshold }).parse();
  } finally {
    releaseDocument(doc);
  }

  // A4-02 : une liste n'est pas un article. Si Readability n'a gardé qu'elle,
  // le conteneur principal est relu sans elle, puis elle y est remise à sa
  // place (voir le serveur).
  const list = result?.content && !options.single ? onlyAList(result.content) : null;
  if (result && list) {
    const retry = clean(load());
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
    const retry = clean(load());
    try {
      if (keepOnlyMainContainer(retry)) {
        const again = new Readability(retry, MAIN_CONTAINER_OPTIONS).parse();
        if (again?.content && recoveredMore(again.textContent || '', result.textContent || '')) {
          result = { ...result, content: again.content, length: again.length, textContent: again.textContent };
        }
      }
    } finally {
      releaseDocument(retry);
    }
  }

  if (!result || !result.content) return null;

  // Les voiles de consentement sortent ici, après toutes les passes (V2-02).
  const unveiled = withoutVeils(result.content, result.length || 0, result.textContent || '');
  return {
    article: {
      title: result.title || '',
      content: unveiled.content,
      excerpt: result.excerpt || '',
      byline: result.byline || '',
      siteName: result.siteName || '',
      length: unveiled.length,
    },
    textContent: unveiled.textContent,
    frame,
    affordable,
  };
}

/** Le coût de lecture d'un document par Readability, estimé (voir le serveur). */
function readingCost(doc: Document): number {
  const root = doc.documentElement;
  if (!root) return 0;
  let cost = 0;
  const stack: Array<[Element, number]> = [[root, 1]];
  while (stack.length) {
    const [el, depth] = stack.pop()!;
    cost += depth * depth;
    for (let child = el.firstElementChild; child; child = child.nextElementSibling) stack.push([child, depth + 1]);
  }
  return cost;
}

/**
 * `run` reçoit de quoi relire un HTML dans un document neuf (son `<body>`) ;
 * chacun de ces documents est vidé à la fin (`parsedDocument.ts`).
 */
function withFragments<T>(run: (parse: (html: string) => Element) => T): T {
  const docs: Document[] = [];
  try {
    return run((html) => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      docs.push(doc);
      return doc.body;
    });
  } finally {
    for (const doc of docs) releaseDocument(doc);
  }
}

/**
 * La garde appliquée à des morceaux donnés (tests de ses règles, sans
 * dépendre du choix de Readability), comme `guardForTests` du serveur.
 */
export function guardForTests(input: { page: string; result: string; witness: string | null; title?: string; base?: string }): { content: string; asked: boolean } {
  const base = input.base ?? 'https://example.com/a';
  return withFragments((parse) => {
    const page = new DOMParser().parseFromString(input.page, 'text/html');
    try {
      const root = parse(input.result);
      const pass: Pass = {
        article: { title: input.title ?? '', content: input.result, excerpt: '', byline: '', siteName: '', length: (root.textContent || '').length },
        textContent: root.textContent || '',
        frame: frameOf(findMainContainer(page), base),
        affordable: true,
      };
      let asked = false;
      const content = withoutLoss(pass, () => { asked = true; return input.witness; }, parse, base).content;
      return { content, asked };
    } finally {
      releaseDocument(page);
    }
  });
}
