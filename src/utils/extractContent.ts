import { Readability } from '@mozilla/readability';
import { useAuthStore } from '../stores/authStore';
import { dropNonVideoIframes } from '../lib/youtube';
import { absolutizeUrls } from './absolutizeUrls';
import { purifyToString, releaseDocument } from '../lib/parsedDocument';
import { markupTooComplex } from '../lib/markupBounds';
import { imageIdentity } from '../lib/imageIdentity';
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
  // Le navigateur ôte les tabulations et retours de ligne d'une adresse avant
  // d'en lire le schéma : `java&#9;script:` est `javascript:` (RC-09).
  const v = value?.replace(/[\t\n\r]/g, '').trim();
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
  // Une vidéo paresseuse (REG-233, voir le serveur).
  for (const media of Array.from(root.querySelectorAll('video[data-src], audio[data-src], source[data-src]'))) {
    const src = webAddress(media.getAttribute('data-src'));
    if (src && isPlaceholderSource(media.getAttribute('src'))) media.setAttribute('src', src);
  }
  for (const video of Array.from(root.querySelectorAll('video[data-poster]'))) {
    const poster = webAddress(video.getAttribute('data-poster'));
    if (poster && isPlaceholderSource(video.getAttribute('poster'))) video.setAttribute('poster', poster);
  }
  for (const button of Array.from(root.querySelectorAll('button'))) {
    if (isZoomButton(button)) button.replaceWith(takeChildren(button));
  }
  resolveLazyMedia(root);
}

// ── Médias de l'article (1.9.0, REG-240 à REG-243) ─────────────────────
// Copie de `resolveLazyMedia` (`server/extract.ts`, qui dit pourquoi :
// `<picture>` sans `<img>` de Clubic, aperçu flou et éléments personnalisés
// du blog de Google, vidéo intégrée derrière un voile chez Numerama).

/** Plus grande variante prise pour l'adresse d'un aperçu (au-delà, la plus petite qui la dépasse). */
const PREVIEW_MAX_WIDTH = 1600;
/** Un fichier vidéo, tel qu'un attribut le donne. */
const VIDEO_FILE = /\.(?:mp4|webm|m4v|mov|ogv)(?:[?#]|$)/i;
/** Un fichier d'image d'affiche. */
const POSTER_FILE = /\.(?:jpe?g|png|gif|webp|avif)(?:[?#]|$)/i;
/** Au moins ce texte pour qu'un attribut `quote` soit une citation. */
const QUOTE_ATTR_MIN = 25;

/** Le candidat d'un `srcset` à largeurs (`450w`) retenu pour `src`, ou `null`. */
function largestUpTo(srcset: string): string | null {
  const candidates = srcset.split(',').map((c) => c.trim().split(/\s+/)).filter((parts) => parts[0]);
  const widths = candidates.map(([address, size]) => ({ address, width: /^(\d+)w$/i.exec(size || '')?.[1] }));
  if (!widths.length || widths.some((c) => !c.width)) return null;
  const sized = widths.map((c) => ({ address: c.address, width: Number(c.width) })).sort((a, b) => a.width - b.width);
  const within = sized.filter((c) => c.width <= PREVIEW_MAX_WIDTH);
  return webAddress((within.length ? within[within.length - 1] : sized[0]).address);
}

/** Une vidéo de fond : lecture automatique en boucle, sans contrôles. */
function isDecorativeVideo(el: Element): boolean {
  return el.hasAttribute('autoplay') && el.hasAttribute('loop') && !el.hasAttribute('controls');
}

export function resolveLazyMedia(root: Element): void {
  const doc = root.ownerDocument!;
  // Une `<picture>` sans `<img>` : celle de son `<noscript>`.
  for (const picture of Array.from(root.querySelectorAll('picture')) as Element[]) {
    if ((Array.from(picture.querySelectorAll('img')) as Element[]).some((img) => !img.closest('noscript'))) continue;
    const noscript = Array.from(picture.children).find((child) => child.tagName.toLowerCase() === 'noscript') as Element | undefined;
    const real = noscript ? onlyImage(noscript) : null;
    if (real && webAddress(real.getAttribute('src'))) noscript!.replaceWith(real);
  }
  // Un aperçu flou : la photo est dans `data-srcset`.
  for (const img of Array.from(root.querySelectorAll('img[data-srcset]')) as Element[]) {
    if (!isPlaceholderSource(img.getAttribute('srcset'))) continue;
    const srcset = webAddress(img.getAttribute('data-srcset'));
    if (!srcset) continue;
    img.setAttribute('srcset', srcset);
    const sizes = img.getAttribute('data-sizes');
    if (sizes && !img.hasAttribute('sizes')) img.setAttribute('sizes', sizes);
    const best = largestUpTo(srcset);
    if (best) img.setAttribute('src', best);
  }
  // Une vidéo intégrée derrière un voile : son `data-src`.
  for (const frame of Array.from(root.querySelectorAll('iframe[data-src], iframe[data-lazy-src]')) as Element[]) {
    const current = frame.getAttribute('src');
    if (current && !isPlaceholderSource(current) && !/^\s*about:blank\s*$/i.test(current)) continue;
    const src = webAddress(frame.getAttribute('data-src') || frame.getAttribute('data-lazy-src'));
    if (src && VIDEO_FRAME.test(src)) frame.setAttribute('src', src);
  }
  // Une vidéo chargée au clic (WP Rocket : `div.rll-youtube-player[data-src]`,
  // le lecteur réel dans un `<noscript>` voisin) : l'iframe du `<noscript>`,
  // quand c'est une vidéo et que rien à côté n'en montre une.
  for (const noscript of Array.from(root.querySelectorAll('noscript')) as Element[]) {
    const frames = Array.from(noscript.querySelectorAll('iframe')) as Element[];
    if (frames.length !== 1 || noscript.children.length !== 1 || (noscript.textContent || '').trim()) continue;
    const src = webAddress(frames[0].getAttribute('src'));
    const parent = noscript.parentElement;
    if (!src || !VIDEO_FRAME.test(src) || !parent) continue;
    if ((Array.from(parent.querySelectorAll('iframe')) as Element[]).some((frame) => !frame.closest('noscript'))) continue;
    noscript.replaceWith(frames[0]);
  }
  // Un élément personnalisé qui porte une vidéo ou une citation.
  for (const el of Array.from(root.querySelectorAll('*')) as Element[]) {
    const tag = el.tagName.toLowerCase();
    if (!tag.includes('-') || el.closest('video, audio')) continue;
    let video: string | null = null;
    let poster: string | null = null;
    for (const attr of Array.from(el.attributes)) {
      const value = webAddress(attr.value);
      if (!value || !/^(?:https?:)?\/\//i.test(value)) continue;
      if (!video && VIDEO_FILE.test(value)) video = value;
      else if (!poster && /poster/i.test(attr.name) && POSTER_FILE.test(value)) poster = value;
    }
    if (video && !isDecorativeVideo(el) && !el.querySelector('video')) {
      const player = doc.createElement('video');
      player.setAttribute('controls', '');
      player.setAttribute('preload', 'metadata');
      player.setAttribute('src', video);
      if (poster) player.setAttribute('poster', poster);
      el.insertBefore(player, el.firstChild);
    }
    const quote = (el.getAttribute('quote') || '').replace(/\s+/g, ' ').trim();
    if (quote.length >= QUOTE_ATTR_MIN && !el.querySelector('blockquote')) {
      const block = doc.createElement('blockquote');
      const said = doc.createElement('p');
      said.textContent = quote;
      block.appendChild(said);
      const who = ['author-name', 'author-title'].map((name) => (el.getAttribute(name) || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
      if (who.length) {
        const by = doc.createElement('p');
        by.textContent = `— ${who.join(', ')}`;
        block.appendChild(by);
      }
      el.appendChild(block);
    }
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

function isBoilerplate(el: Element, insideArticle: boolean, postLength: PostLength, paid: Map<Node, LinkCounts>, headingIds: () => Set<string>, inFlow: (el: Element) => boolean): boolean | typeof VEIL {
  const tag = el.tagName.toLowerCase();
  const role = (el.getAttribute('role') || '').toLowerCase();
  if ((BOILERPLATE_TAGS.has(tag) || BOILERPLATE_ROLES.has(role)) && !isTableOfContents(el, headingIds)) return true;
  if (!insideArticle && (el.getAttribute('id') || '').toLowerCase() === 'secondary') return true;
  // Un encadré dans le fil du texte reste (REG-232, voir le serveur).
  if (!insideArticle && (tag === 'aside' || role === 'complementary') && !inFlow(el)) return true;
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

/** Un paragraphe frère de cette longueur dit qu'un encadré est dans le fil du texte (REG-232). */
const TEXT_FLOW_MIN = 80;

/** Un encadré DANS le fil du texte : un frère est un paragraphe d'au moins `TEXT_FLOW_MIN` caractères (voir le serveur). */
function inTextFlow(el: Element): boolean {
  for (let sibling = el.parentElement?.firstElementChild; sibling; sibling = sibling.nextElementSibling) {
    if (sibling.tagName.toLowerCase() === 'p' && visibleTextLength(sibling, TEXT_FLOW_MIN) >= TEXT_FLOW_MIN) return true;
  }
  return false;
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
  // Le fil du texte d'un parent, jugé une fois (voir le serveur).
  const flows = new Map<Element | null, boolean>();
  const inFlow = (el: Element) => {
    let known = flows.get(el.parentElement);
    if (known === undefined) flows.set(el.parentElement, known = inTextFlow(el));
    return known;
  };
  const stack: Array<[Element, boolean]> = Array.from(root.children, (child) => [child, false]);
  while (stack.length) {
    const [el, insideArticle] = stack.pop()!;
    if (CODE.has(el.tagName.toLowerCase())) continue;
    const verdict = isBoilerplate(el, insideArticle, postLength, paid, headingIds, inFlow);
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

/** Classes de masquage des bibliothèques courantes (voir le serveur, REG-225). */
const HIDING_CLASSES = new Set(['hidden', 'invisible', 'd-none', 'is-hidden', 'sr-only', 'visually-hidden', 'screen-reader-text']);
/** Une classe qui RE-montre l'élément à une taille d'écran : `md:block`, `d-lg-flex`. */
const SHOWN_AT_SOME_SIZE = /^(?:[a-z0-9-]+:)+(?:block|flex|grid|inline|inline-block|inline-flex|inline-grid|table|table-cell|table-row|contents|flow-root|list-item|visible|not-sr-only)$|^d-(?:sm|md|lg|xl|xxl)-(?:block|flex|grid|inline|inline-block|inline-flex|table|table-cell|table-row)$/;

/** La page masque-t-elle cet élément (voir le serveur, REG-225) ? La garde ne le remet jamais. */
function hiddenOnPage(el: Element): boolean {
  if (hiddenForReadability(el)) return true;
  const tokens = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
  return tokens.some((token) => HIDING_CLASSES.has(token)) && !tokens.some((token) => SHOWN_AT_SOME_SIZE.test(token));
}

/** `el` ou un ancêtre invisible (pour Readability, par défaut, ou selon `hiddenTest`) ; mémorisé dans `memo`. */
function insideHidden(el: Element, memo: Map<Element, boolean>, hiddenTest: (el: Element) => boolean = hiddenForReadability): boolean {
  const path: Element[] = [];
  let hidden = false;
  for (let current: Element | null = el; current; current = current.parentElement) {
    const known = memo.get(current);
    if (known !== undefined) { hidden = known; break; }
    path.push(current);
    if (hiddenTest(current)) { hidden = true; break; }
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

// ── Garde de non-perte : la page vérifie Readability (REG-229) ────────
// Copie de la garde de `server/extract.ts`, qui dit pourquoi : Readability
// choisit et nettoie, la page vérifie. Les blocs du conteneur de l'article
// (lu dans la page nettoyée, avant Readability) que le résultat ne lit pas
// sont remis à leur place sur preuve (JSON-LD, description), dans l'en-tête,
// dans un trou du corps, dans la suite de même gabarit, ou après un résultat
// court ; jamais ce qui est masqué, la signature, les commentaires, un panneau
// de réglages, ni ce que le résultat lit déjà. Règles, seuils et bornes
// identiques ; toute modification de l'une va avec l'autre, et avec
// `EXTRACT_VERSION`.
const READABILITY_CHAR_THRESHOLD = 500;

/**
 * Un bloc de texte ou de média, lu dans la page ou dans un résultat.
 * `excluded` : dans la page, sous la signature de l'auteur (`BYLINE_SIGNALS`),
 * dans les commentaires (`isComments`) ou un panneau de réglages
 * (`controlPanels`) — la garde ne le remet jamais.
 */
class Unit {
  private normCache?: string;
  private trackedCache?: string[];
  private shortCache?: string[];
  /**
   * `blocks` : le texte lisible, par bloc. `images` : une liste d'adresses par
   * image ou média (`src`, puis, dans la page, les variantes en réserve).
   */
  constructor(readonly el: Element, private readonly blocks: string[], readonly images: string[][], readonly excluded = false) {}
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
  /** Ses blocs (coupés aux fins de bloc et aux `<br>`), normalisés. */
  get parts(): string[] {
    return this.blocks.map(normalized).filter(Boolean);
  }
  /** Phrases suivies, normalisées — calculées à la première lecture. */
  get tracked(): string[] {
    return this.trackedCache ??= this.blocks.flatMap(sentencesOf).filter(isTracked);
  }
  /**
   * Le texte (normalisé) de chaque entrée courte d'un bloc qui en contient —
   * une entrée de liste, une cellule sans phrase suivie (« Price: 499 € ») :
   * le bloc n'est lu que si elles le sont aussi (RC-04).
   */
  get shortLeaves(): string[] {
    if (this.shortCache) return this.shortCache;
    const out: string[] = [];
    if (!this.el.firstElementChild) return this.shortCache = out;
    for (const leaf of Array.from(this.el.querySelectorAll(LEAF_BLOCKS)) as Element[]) {
      if (Array.from(leaf.children).some((child) => BLOCKS.has(child.tagName.toLowerCase()))) continue;
      const blocks = blocksOf(leaf);
      if (blocks.flatMap(sentencesOf).some(isTracked)) continue;
      const text = normalized(blocks.join(' '));
      if (text) out.push(text);
    }
    return this.shortCache = out;
  }
}

/** Le conteneur de l'article, découpé en blocs, et les phrases que la page certifie. */
interface Frame { root: Element; units: Unit[]; evidence: string[] }

/** Éléments lus comme un seul bloc. */
const UNIT_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'dl', 'blockquote', 'pre', 'table', 'figure', 'picture', 'img', 'video', 'audio', 'iframe']);
/** Médias : un bloc à eux seuls, sans texte lisible (le texte de repli ne se lit pas). */
const MEDIA_TAGS = 'video, audio, iframe';
const MEDIA_UNITS = new Set(['video', 'audio', 'iframe']);
/** Ce qui reste d'un média remis : ses sources et ses pistes. */
const MEDIA_PARTS = new Set(['source', 'track']);
/**
 * Un cadre intégré qui est une vidéo : `allowedVideoRegex` de Readability
 * 0.6.0, ce qu'il garde lui-même. Un autre cadre (CodePen, publicité,
 * formulaire) ne se remet pas : le lecteur le retire de toute façon.
 */
const VIDEO_FRAME = /\/\/(www\.)?((dailymotion|youtube|youtube-nocookie|player\.vimeo|v\.qq|bilibili|live\.bilibili)\.com|(archive|upload\.wikimedia)\.org|player\.twitch\.tv)/i;

/** Un média qui se lit : une vidéo, un son, ou un cadre qui est une vidéo. */
function isMedia(el: Element): boolean {
  return el.tagName.toLowerCase() !== 'iframe' || VIDEO_FRAME.test(el.getAttribute('src') || '');
}
/** Ce qui ne se lit pas : scripts, textes de repli des médias, contrôles. */
const UNREAD = new Set(['script', 'style', 'template', 'noscript', 'audio', 'video', 'object', 'iframe', 'svg', 'canvas', 'button', 'select', 'textarea']);
/** Fins de bloc, pour découper les phrases comme le corpus. */
const BLOCK_ENDS = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'blockquote', 'figcaption', 'br', 'div', 'tr', 'dt', 'dd', 'pre', 'figure', 'section', 'article', 'header', 'footer', 'aside', 'ul', 'ol', 'dl', 'table', 'caption']);
/** Un élément de bloc : un texte qui le contient n'est pas un paragraphe à lui seul. */
const BLOCKS = new Set([...UNIT_TAGS, ...BLOCK_ENDS].filter((tag) => tag !== 'br' && tag !== 'img' && !MEDIA_UNITS.has(tag)));
const SPACED_ENDS = new Set(['.', '!', '?', '…', '؟']);
const WIDE_ENDS = new Set(['。', '！', '？']);
const CLOSERS = new Set(['"', "'", '”', '’', '»', ')', ']', '）', '」', '』', '》', '〉', '】']);
const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/gu;
/** Une phrase plus courte ne compte pas (dates, rubriques, « Credit: ») — la règle du corpus. */
const TRACKED_MIN = 25;
const TRACKED_MIN_NO_SPACE = 8;

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

/** Une adresse de fichier image, telle qu'une page la range dans un attribut `data-*`. */
const IMAGE_FILE = /\.(?:jpe?g|png|gif|webp|avif)(?:[?#]|$)/i;

/** Les candidats d'un `srcset` : leurs adresses, sans les largeurs. */
function srcsetAddresses(value: string | null): string[] {
  return (value || '').split(',').map((candidate) => candidate.trim().split(/\s+/)[0]).filter(Boolean);
}

/** Les adresses d'une image : `src`, `srcset`, puis, dans la page (`lenient`), celles qu'elle a en réserve. */
function imageAddresses(img: Element, base: string, lenient: boolean): string[] {
  const values: Array<string | null> = [img.getAttribute('src'), ...srcsetAddresses(img.getAttribute('srcset'))];
  if (lenient) {
    for (const attr of Array.from(img.attributes)) {
      if (!attr.name.startsWith('data-')) continue;
      for (const candidate of srcsetAddresses(attr.value)) if (IMAGE_FILE.test(candidate)) values.push(candidate);
    }
    if (img.parentElement?.tagName.toLowerCase() === 'picture') {
      for (const source of Array.from(img.parentElement.children)) {
        for (const attr of ['srcset', 'data-srcset']) values.push(...srcsetAddresses(source.getAttribute(attr)));
      }
    }
  }
  return values.map((value) => absolute(value, base)).filter((value): value is string => !!value);
}

/** Les adresses d'un média (`video`, `audio`, `iframe`) : le sien, puis celles de ses `<source>`. */
function mediaAddresses(media: Element, base: string): string[] {
  const values: Array<string | null> = [media.getAttribute('src')];
  for (const source of Array.from(media.querySelectorAll('source'))) values.push(source.getAttribute('src'));
  return values.map((value) => absolute(value, base)).filter((value): value is string => !!value);
}

function unitOf(el: Element, base: string, lenient: boolean, excluded = false): Unit {
  const images: string[][] = [];
  const tag = el.tagName.toLowerCase();
  const leaf = !el.firstElementChild;
  const imgs = tag === 'img' ? [el] : leaf ? [] : Array.from(el.querySelectorAll('img')) as Element[];
  for (const img of imgs) {
    if (isIcon(img)) continue;
    const addresses = imageAddresses(img, base, lenient);
    if (addresses.length) images.push(addresses);
  }
  const media = MEDIA_UNITS.has(tag) ? [el] : leaf ? [] : Array.from(el.querySelectorAll(MEDIA_TAGS)) as Element[];
  for (const one of media) {
    if (!isMedia(one) || (lenient && one.tagName.toLowerCase() === 'video' && isDecorativeVideo(one))) continue;
    const addresses = mediaAddresses(one, base);
    if (addresses.length) images.push(addresses);
  }
  return new Unit(el, blocksOf(el), images, excluded);
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

/** `el.matches(BYLINE_SIGNALS)`, lu sur les attributs : un sélecteur par élément coûte sa compilation. */
function isByline(el: Element): boolean {
  if (/(?:^|\s)author(?:\s|$)/i.test(el.getAttribute('rel') || '')) return true;
  if ((el.getAttribute('itemprop') || '').includes('author')) return true;
  const name = el.getAttribute('class') || '';
  const id = el.getAttribute('id') || '';
  return ['byline', 'author', 'dateline', 'writtenby'].some((word) => name.includes(word)) || ['byline', 'author'].some((word) => id.includes(word));
}

/** Mots d'une classe ou d'un id qui désignent les commentaires (jamais remis). */
const COMMENT_TOKENS = new Set(['comment', 'comments', 'commentaire', 'commentaires', 'disqus', 'respond']);

/** Les commentaires d'un billet, ou leur compteur : par leur nom, ou par schema.org. */
function isComments(el: Element): boolean {
  const tokens = `${el.getAttribute('class') || ''} ${el.getAttribute('id') || ''}`.toLowerCase().split(/[^a-z0-9]+/);
  if (tokens.some((token) => COMMENT_TOKENS.has(token))) return true;
  return /comment/i.test(el.getAttribute('itemtype') || '') || /(?:^|\s)comments?(?:\s|$)/i.test(el.getAttribute('itemprop') || '');
}

/**
 * Les blocs de `root`, dans l'ordre. `lenient` (la page) : une image se
 * reconnaît à toutes ses adresses, et ni un voile (V2-02), ni ce que la page
 * masque (REG-225) n'est un bloc ; la signature de l'auteur, les
 * commentaires et les panneaux de réglages (`controlPanels`) sont marqués
 * (`excluded`).
 */
function unitsOf(root: Element, base: string, lenient = false): Unit[] {
  const units: Unit[] = [];
  const panels = lenient ? controlPanels(root) : new Set<Element>();
  const stack: Array<[Element, boolean]> = [[root, false]];
  while (stack.length) {
    const [el, inExcluded] = stack.pop()!;
    if (lenient && (el.hasAttribute(VEIL_ATTR) || (el !== root && hiddenOnPage(el)))) continue;
    const tag = el.tagName.toLowerCase();
    // Ni un contrôle, ni le libellé d'un contrôle : ce n'est pas du texte d'article.
    if (el !== root && ((UNREAD.has(tag) && !(MEDIA_UNITS.has(tag) && isMedia(el))) || (lenient && tag === 'label'))) continue;
    // Ni une vidéo de fond (lecture automatique en boucle, sans contrôles) : un décor (REG-242).
    if (lenient && el !== root && tag === 'video' && isDecorativeVideo(el)) continue;
    const excluded = inExcluded || (lenient && el !== root && (panels.has(el) || isByline(el) || isComments(el) || el.hasAttribute('data-nosnippet')));
    if (el !== root && (UNIT_TAGS.has(tag) || looseText(el))) {
      const unit = unitOf(el, base, lenient, excluded);
      if (unit.norm.trim() || unit.images.length) units.push(unit);
      continue;
    }
    for (let child = el.lastElementChild; child; child = child.previousElementSibling) stack.push([child, excluded]);
  }
  return units;
}

/** Un champ de saisie ou une liste de choix (pas un champ caché). */
const CONTROL_TAGS = new Set(['select', 'textarea', 'input']);
/** Un bloc qui porte un contrôle et moins de texte que ceci est un panneau de réglages. */
const PANEL_TEXT_MAX = 300;

/**
 * Les panneaux de réglages sous `root` : un bloc qui porte un champ ou une
 * liste de choix, et peu de texte (le réglage du texte d'Ars Technica, « Story
 * text », « * Subscribers only »). Ce n'est pas de l'article : la garde ne
 * le remet jamais. Une passe, des enfants vers les parents.
 */
function controlPanels(root: Element): Set<Element> {
  const order: Element[] = [];
  const stack: Element[] = [root];
  while (stack.length) {
    const el = stack.pop()!;
    order.push(el);
    for (let child = el.firstElementChild; child; child = child.nextElementSibling) stack.push(child);
  }
  const below = new Map<Element, { control: boolean; text: number }>();
  const panels = new Set<Element>();
  for (let i = order.length - 1; i >= 0; i--) {
    const el = order[i];
    const tag = el.tagName.toLowerCase();
    let control = CONTROL_TAGS.has(tag) && !(tag === 'input' && (el.getAttribute('type') || '').trim().toLowerCase() === 'hidden');
    let text = 0;
    for (let node = el.firstChild; node; node = node.nextSibling) {
      if (node.nodeType === 3) {
        if (!UNREAD.has(tag)) text += (node.textContent || '').replace(/\s+/g, ' ').trim().length;
        continue;
      }
      const child = node.nodeType === 1 ? below.get(node as Element) : undefined;
      if (!child) continue;
      below.delete(node as Element);
      control ||= child.control;
      if (!UNREAD.has(tag)) text += child.text;
    }
    below.set(el, { control, text });
    if (control && text < PANEL_TEXT_MAX && el !== root) panels.add(el);
  }
  return panels;
}

// ── Le conteneur que la page désigne ─────────────────────────────────

/** Un `[itemprop=articleBody]` plus court n'est pas un corps. */
const ITEMPROP_MIN = 200;
/** Un `<article>` qui porte moins de cette part du texte de la page n'est pas l'article. */
const ARTICLE_MIN_SHARE = 0.35;
/** Des `<article>` qui portent ensemble cette part du `<main>` en font une page de liste. */
const LIST_SHARE = 0.5;
/** Le conteneur retenu porte au moins ce multiple du texte du suivant. */
const DOMINANCE = 2;
/** Remonté jusqu'au titre seulement si l'ancêtre porte au plus 1,25 fois le texte, plus 1 500 caractères. */
const CLIMB_GROWTH = 1.25;
const CLIMB_SLACK = 1500;

/** Longueur du texte lisible de `root` : ni script, ni style, ni ce que la page masque. */
function readableLength(root: Element): number {
  let length = 0;
  const stack: Node[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.nodeType === 3) {
      length += (node.textContent || '').replace(/\s+/g, ' ').trim().length;
      continue;
    }
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    if (INVISIBLE.has(el.tagName.toLowerCase()) || (el !== root && hiddenOnPage(el))) continue;
    for (let child = el.firstChild; child; child = child.nextSibling) stack.push(child);
  }
  return length;
}

/** Les éléments de `found` qui ne sont dans aucun autre de même sélecteur. */
function outermost(found: Element[], selector: string): Element[] {
  return found.filter((el) => !el.parentElement?.closest(selector));
}

/** Les éléments de `found`, du plus long texte au plus court. */
function byLength(found: Element[]): Array<{ el: Element; length: number }> {
  return found.map((el) => ({ el, length: readableLength(el) })).sort((a, b) => b.length - a.length);
}

/**
 * Le conteneur de l'article : un `[itemprop=articleBody]` dominant, sinon un
 * `<article>` de premier niveau qui porte au moins 35 % du texte de la page
 * et deux fois le suivant, sinon un `<main>` ou un `[role=main]` unique.
 * `null` sur une page de liste — plusieurs `<article>` sans dominant, qui
 * portent ensemble au moins la moitié du texte du `<main>` : elle ne désigne
 * aucun article. Quelques cartes « à lire aussi » en `<article>` sous le
 * corps (DeepMind) ne font pas une page de liste.
 */
function articleContainer(doc: Document): Element | null {
  const root = doc.documentElement;
  if (!root) return null;
  const itemprop = '[itemprop~="articleBody"]';
  const bodies = byLength(outermost(Array.from(root.querySelectorAll(itemprop)) as Element[], itemprop)).filter((body) => body.length >= ITEMPROP_MIN);
  if (bodies.length) return bodies[0].length >= DOMINANCE * (bodies[1]?.length ?? 0) ? bodies[0].el : null;
  const articles = byLength(outermost(Array.from(root.querySelectorAll('article')) as Element[], 'article'));
  if (articles.length) {
    const [first, second] = articles;
    if (first.length > 0 && first.length >= ARTICLE_MIN_SHARE * readableLength(root) && first.length >= DOMINANCE * (second?.length ?? 0)) return first.el;
  }
  let main: Element | null = null;
  for (const selector of ['main', '[role="main"]']) {
    const found = root.querySelectorAll(selector);
    if (found.length === 1) { main = found[0] as Element; break; }
  }
  if (!main || articles.length < 2) return main;
  let listed = 0;
  for (const article of articles) listed += article.length;
  return listed < LIST_SHARE * readableLength(main) ? main : null;
}

/**
 * Une copie du conteneur, remontée jusqu'au titre de l'article (le premier
 * `<h1>` que la page montre) quand il ne le contient pas et que l'ancêtre
 * commun grossit peu : c'est là que vivent le chapeau et l'image d'en-tête.
 */
function withItsTitle(doc: Document, container: Element): Element {
  const own = () => container.cloneNode(true) as Element;
  const memo = new Map<Element, boolean>();
  // Le titre que la page se donne (`og:title`, sinon `<title>`) : seul un
  // `<h1>` qui le porte est celui de l'article — pas le logo du site (RC-08).
  const named = ((doc.querySelector('meta[property="og:title"]') as unknown as Element | null)?.getAttribute('content') || doc.title || '');
  const pageTitle = ` ${normalized(named)} `;
  const titles = Array.from(doc.querySelectorAll('h1'))
    .filter((h1) => (h1.textContent || '').trim() && !insideHidden(h1, memo, hiddenOnPage));
  if (titles.some((h1) => container.contains(h1))) return own();
  const title = titles.find((h1) => titleLike(normalized(h1.textContent || ''), pageTitle));
  if (!title) return own();
  let up = container.parentElement;
  while (up && !up.contains(title)) up = up.parentElement;
  if (!up || ['body', 'html'].includes(up.tagName.toLowerCase())) return own();
  // L'ancêtre commun, sans ce qui suit le conteneur : l'en-tête est AVANT le
  // corps, et ce qui le suit dans l'ancêtre (les commentaires de Clubic, des
  // vidéos, une lettre) n'est pas de l'article.
  const path: number[] = [];
  for (let el: Element = container; el !== up; el = el.parentElement!) path.push(Array.from(el.parentElement!.childNodes).indexOf(el));
  const copy = up.cloneNode(true) as Element;
  let node: Node = copy;
  for (let k = path.length - 1; k >= 0; k--) {
    const child = node.childNodes[path[k]];
    while (child.nextSibling) child.nextSibling.remove();
    node = child;
  }
  return readableLength(copy) <= CLIMB_GROWTH * readableLength(container) + CLIMB_SLACK ? copy : own();
}

/**
 * Le conteneur de l'article, lu dans la page avant Readability (qui modifie le
 * document) : une copie, ses blocs, et les phrases que la page certifie.
 * `null` sans conteneur, ou s'il est masqué.
 */
function frameOf(doc: Document, base: string): Frame | null {
  const found = articleContainer(doc);
  if (!found || insideHidden(found, new Map(), hiddenOnPage)) return null;
  const root = withItsTitle(doc, found);
  const units = unitsOf(root, base, true);
  if (!units.length) return null;
  return { root, units, evidence: evidenceOf(doc) };
}

// ── Les preuves : ce que la page certifie être l'article ─────────────

/** Un objet schema.org de ce type porte l'article. */
const ARTICLE_TYPE = /article|posting|report/i;
/** Au-delà, une preuve n'est plus lue (une page faite pour coûter). */
const EVIDENCE_MAX = 200_000;
/** Profondeur d'un objet JSON-LD au-delà de laquelle il n'est plus lu. */
const EVIDENCE_DEPTH = 6;
/** Les `<meta>` qui résument l'article. */
const SUMMARY_META = new Set(['og:description', 'description', 'twitter:description']);

/** Les textes d'un objet JSON-LD de type article : `articleBody`, `description`. */
function ldTexts(data: unknown, out: string[], depth = 0): void {
  if (!data || typeof data !== 'object' || depth > EVIDENCE_DEPTH) return;
  if (Array.isArray(data)) {
    for (const item of data) ldTexts(item, out, depth + 1);
    return;
  }
  const o = data as Record<string, unknown>;
  const types = ([] as unknown[]).concat(o['@type'] ?? []).map(String);
  if (types.some((type) => ARTICLE_TYPE.test(type)) || typeof o.articleBody === 'string') {
    for (const key of ['articleBody', 'description']) if (typeof o[key] === 'string') out.push(o[key] as string);
  }
  // Pas `itemListElement` : la liste d'autres billets d'une page n'est pas l'article.
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage']) ldTexts(o[key], out, depth + 1);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Les phrases d'un texte brut : retours à la ligne, balises, « fin.Début » collés. */
function plainSentences(text: string): string[] {
  const decoded = text
    .replace(/<[^>]*>/g, '\n')
    .replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]{2,6}));/gi, (whole, dec, hex, name) => {
      const code = dec ? parseInt(dec, 10) : hex ? parseInt(hex, 16) : -1;
      if (code >= 0) return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      return ENTITIES[name.toLowerCase()] ?? whole;
    });
  return decoded
    .split(/\r?\n+/)
    .flatMap((line) => line.replace(/([.!?…:»”"])(?=[\p{Lu}«“])/gu, '$1\n').split('\n'))
    .flatMap(sentencesOf)
    .filter(isTracked);
}

/** Les phrases que la page certifie être l'article (JSON-LD, `<meta>` de résumé), sans doublon. */
function evidenceOf(doc: Document): string[] {
  const texts: string[] = [];
  for (const script of Array.from(doc.querySelectorAll('script'))) {
    if ((script.getAttribute('type') || '').trim().toLowerCase() !== 'application/ld+json') continue;
    const raw = (script.textContent || '').trim().replace(/^<!\[CDATA\[|\]\]>$/g, '');
    if (!raw || raw.length > EVIDENCE_MAX) continue;
    try { ldTexts(JSON.parse(raw), texts); } catch { /* un JSON-LD illisible ne prouve rien */ }
  }
  for (const meta of Array.from(doc.querySelectorAll('meta'))) {
    const name = (meta.getAttribute('property') || meta.getAttribute('name') || '').trim().toLowerCase();
    const content = meta.getAttribute('content');
    if (SUMMARY_META.has(name) && content) texts.push(content);
  }
  let left = EVIDENCE_MAX;
  const sentences = new Set<string>();
  for (const text of texts) {
    if (left <= 0) break;
    const part = text.slice(0, left);
    left -= part.length;
    for (const sentence of plainSentences(part)) sentences.add(sentence);
  }
  return [...sentences];
}

// ── La remise ────────────────────────────────────────────────────────

/**
 * Ce que garde un résultat : ses phrases, ses blocs, son texte normalisé
 * (`text`), ses images et médias — par leur identité à la taille près
 * (`imageIdentity`, REG-225) : la photo que le résultat montre en 1200 × 675
 * n'est pas absente parce que la page la lit en 2400.
 */
interface Kept { sentences: Set<string>; blocks: Set<string>; text: KeptText; images: Set<string> }

/**
 * Le texte normalisé d'un résultat, et où s'y lit chaque mot et chaque paire
 * de mots, relevé à la demande. Il est fait de MORCEAUX — le résultat, puis
 * chaque bloc remis —, chacun relevé une fois et jamais recollé aux autres :
 * mille blocs remis ne font pas relire mille fois un texte qui grossit (RC-01,
 * relecture de REG-229 : une page de 1,7 Mo dépassait le délai du worker).
 * Chercher un texte ne relit que les occurrences de l'un de ses mots :
 * - quatre mots ou plus : par la plus rare de ses paires de mots intérieurs,
 *   des mots entiers du résultat (le premier et le dernier peuvent y être
 *   collés à un voisin) — mille phrases qui commencent pareil ne se relisent
 *   pas l'une l'autre ;
 * - moins de quatre : par son premier mot, en mots ENTIERS, dans le texte
 *   coupé à chaque bord d'élément (`splitText`) — « écran » ne se lit pas dans
 *   « écrans », « 2 gb » pas dans « 2 gbps » (RC-02), mais deux `<span>` collés
 *   (« Foire aux questions » puis « Contenu… ») se lisent chacun.
 */
class KeptText {
  /** Morceaux du texte entier (mots collés compris), et du texte coupé aux bords d'éléments. */
  private whole: string[] = [];
  private split: string[] = [];
  private wholeDone = 0;
  private splitDone = 0;
  private pairs = new Map<string, number[]>();
  private words = new Map<string, number[]>();
  /** Où commence chaque bloc du premier morceau (le résultat) : un morceau ajouté est un seul bloc. */
  private starts: number[] = [];
  /** `blocks` : les blocs du résultat, normalisés ; `split` : son texte coupé aux bords d'éléments. */
  constructor(blocks: string[], split: string) {
    let at = 1;
    for (const block of blocks) { this.starts.push(at); at += block.length + 1; }
    this.append(blocks.join(' '), split);
  }
  /** Ajoute un morceau (normalisé, sans espaces au bord). */
  append(whole: string, split: string): void {
    this.whole.push(` ${whole} `);
    this.split.push(` ${split} `);
  }
  /** Le rang du bloc du résultat qui porte la position `at` du premier morceau. */
  private blockAt(at: number): number {
    let lo = 0;
    let hi = this.starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.starts[mid] <= at) lo = mid + 1;
      else hi = mid;
    }
    return lo - 1;
  }
  /** Le texte normalisé `needle` se lit-il dans le résultat ? */
  find(needle: string, scan: Scan): boolean {
    const words = needle.split(' ');
    if (words.length < 4) {
      this.indexSplit(scan);
      for (const position of this.words.get(words[0]) ?? []) {
        if (scan.left <= 0) return true;
        scan.left -= needle.length;
        const [chunk, offset] = decode(position);
        if (this.split[chunk].startsWith(`${needle} `, offset)) return true;
      }
      return false;
    }
    return this.findWhole(needle, words, scan, (chunk, start) => this.whole[chunk].startsWith(needle, start));
  }
  /**
   * `head` puis `tail` se lisent-ils dans un même bloc du résultat, dans cet
   * ordre, à moins de `span` caractères l'un de l'autre (RC-05) ?
   */
  near(head: string, tail: string, span: number, scan: Scan): boolean {
    const words = head.split(' ');
    if (words.length < 4) return false;
    return this.findWhole(head, words, scan, (chunk, start) => {
      if (!this.whole[chunk].startsWith(head, start)) return false;
      scan.left -= span;
      const found = this.whole[chunk].slice(start + head.length, start + span).indexOf(tail);
      if (found < 0) return false;
      // Dans le même bloc : le début et la fin d'un même paragraphe.
      return chunk > 0 || this.blockAt(start) === this.blockAt(start + head.length + found + tail.length - 1);
    });
  }
  private findWhole(needle: string, words: string[], scan: Scan, test: (chunk: number, start: number) => boolean): boolean {
    this.indexWhole(scan);
    // La plus rare de ses paires de mots entiers (ni le premier ni le dernier).
    let before = words[0].length + 1;
    let at: number[] = [];
    let offset = 0;
    for (let k = 1; k + 1 < words.length - 1; k++) {
      const here = this.pairs.get(`${words[k]} ${words[k + 1]}`) ?? [];
      if (k === 1 || here.length < at.length) { at = here; offset = before; }
      if (!here.length) break;
      before += words[k].length + 1;
    }
    for (const position of at) {
      // Budget épuisé : lu — la garde n'y touche plus, et s'abstiendra.
      if (scan.left <= 0) return true;
      scan.left -= needle.length;
      const [chunk, start] = decode(position);
      if (start - offset >= 0 && test(chunk, start - offset)) return true;
    }
    return false;
  }
  private indexWhole(scan: Scan): void {
    for (; this.wholeDone < this.whole.length; this.wholeDone++) {
      const chunk = this.whole[this.wholeDone];
      scan.left -= chunk.length;
      let previous = -1;
      let previousWord = '';
      for (let i = 0; i < chunk.length - 1;) {
        const end = chunk.indexOf(' ', i + 1);
        if (end < 0) break;
        const word = chunk.slice(i + 1, end);
        if (previous >= 0) note(this.pairs, `${previousWord} ${word}`, encode(this.wholeDone, previous));
        previous = i + 1;
        previousWord = word;
        i = end;
      }
    }
  }
  private indexSplit(scan: Scan): void {
    for (; this.splitDone < this.split.length; this.splitDone++) {
      const chunk = this.split[this.splitDone];
      scan.left -= chunk.length;
      for (let i = 0; i < chunk.length - 1;) {
        const end = chunk.indexOf(' ', i + 1);
        if (end < 0) break;
        note(this.words, chunk.slice(i + 1, end), encode(this.splitDone, i + 1));
        i = end;
      }
    }
  }
}

/** Une position : le morceau et le rang dans le morceau, en un nombre. */
const CHUNK_SPAN = 2 ** 24;
const encode = (chunk: number, offset: number) => chunk * CHUNK_SPAN + offset;
const decode = (position: number): [number, number] => [Math.floor(position / CHUNK_SPAN), position % CHUNK_SPAN];

function note(map: Map<string, number[]>, key: string, position: number): void {
  const at = map.get(key);
  if (at) at.push(position);
  else map.set(key, [position]);
}

/**
 * Le texte de `el` coupé à chaque bord d'élément, normalisé : deux `<span>`
 * collés y sont deux mots (textes de repli et contrôles exclus).
 */
function splitText(el: Element): string {
  const parts: string[] = [];
  // `null` : la fin d'un élément.
  const stack: Array<Node | null> = [el];
  while (stack.length) {
    const node = stack.pop();
    if (node === null || node === undefined) { parts.push(' '); continue; }
    if (node.nodeType === 3) { parts.push(node.textContent || ''); continue; }
    if (node.nodeType !== 1 || UNREAD.has((node as Element).tagName.toLowerCase())) continue;
    parts.push(' ');
    stack.push(null);
    for (let child = node.lastChild; child; child = child.previousSibling) stack.push(child);
  }
  return normalized(parts.join(''));
}
/** L'identité d'une adresse absolue (`imageIdentity`), ou l'adresse elle-même. */
const sameImage = (address: string) => imageIdentity(address) ?? address;

function keptOf(root: Element, base: string): Kept {
  const images = new Set<string>();
  for (const img of Array.from(root.querySelectorAll('img')) as Element[]) {
    for (const address of imageAddresses(img, base, false)) images.add(sameImage(address));
  }
  for (const media of Array.from(root.querySelectorAll(MEDIA_TAGS)) as Element[]) {
    for (const address of mediaAddresses(media, base)) images.add(sameImage(address));
  }
  const blocks = blocksOf(root);
  return {
    sentences: new Set(blocks.flatMap(sentencesOf)),
    blocks: new Set(blocks.map(normalized)),
    text: new KeptText(blocks.map(normalized).filter(Boolean), splitText(root)),
    images,
  };
}

/**
 * Caractères que la garde peut encore relire en cherchant une phrase dans un
 * texte (`holds`, `placeIn`). Une phrase se trouve d'abord entière, dans un
 * index ; la recherche dans le texte ne sert qu'aux phrases découpées
 * autrement. Sur une page faite pour cela — des milliers de phrases absentes,
 * chacune cherchée dans 2 Mo —, ce budget épuisé, la garde s'abstient :
 * le résultat reste celui de Readability.
 */
interface Scan { left: number }
/** Le budget : ce multiple du texte lu (conteneur et résultat), plus une part fixe pour les petites pages. */
const SCAN_FACTOR = 32;
const SCAN_FLOOR = 8_000_000;

/**
 * `needle` se lit-il dans `haystack`, en décomptant du budget ce que la
 * recherche a parcouru ? Sans exiger des mots entiers : deux `<span>` collés
 * (« Foire aux questions » puis « Contenu… ») se lisent d'un seul tenant dans
 * le résultat, et un bloc qu'on y croirait absent serait remis en double.
 */
function scanned(haystack: string, needle: string, scan: Scan): boolean {
  const found = haystack.indexOf(needle);
  scan.left -= found < 0 ? haystack.length : found + needle.length;
  return found >= 0;
}

/** Le résultat lit-il ce texte normalisé ? Budget épuisé : oui — la garde n'y touche plus. */
function readsWithin(kept: Kept, text: string, scan: Scan): boolean {
  if (kept.blocks.has(text)) return true;
  if (scan.left <= 0) return true;
  return kept.text.find(text, scan);
}

/** Le résultat lit-il cette phrase ? */
function holds(kept: Kept, sentence: string, scan: Scan): boolean {
  return kept.sentences.has(sentence) || readsWithin(kept, sentence, scan);
}

/** Longueur du texte brut du conteneur — pour le budget, sans normaliser. */
function frameLength(units: Unit[]): number {
  let length = 0;
  for (const unit of units) length += unit.size;
  return length;
}

/**
 * Où se lisent, dans le conteneur, chaque phrase, chaque bloc court (son
 * texte entier) et chaque image, relevé une fois. `placeable` ne compte pas
 * les blocs exclus (signature, commentaires), que la garde ne remet jamais ;
 * `all`, `allBlocks` et `images` les comptent (pour situer le résultat).
 */
interface FrameIndex {
  placeable: Map<string, number[]>;
  all: Map<string, number[]>;
  allBlocks: Map<string, number[]>;
  images: Map<string, number[]>;
}

function indexOf(units: Unit[]): FrameIndex {
  const placeable = new Map<string, number[]>();
  const all = new Map<string, number[]>();
  const allBlocks = new Map<string, number[]>();
  const images = new Map<string, number[]>();
  const note = (map: Map<string, number[]>, key: string, i: number) => {
    const at = map.get(key);
    if (!at) map.set(key, [i]);
    else if (at[at.length - 1] !== i) at.push(i);
  };
  units.forEach((unit, i) => {
    for (const s of unit.tracked) {
      note(all, s, i);
      if (!unit.excluded) note(placeable, s, i);
    }
    if (!unit.tracked.length) {
      const text = unit.norm.trim();
      if (text) note(allBlocks, text, i);
    }
    for (const variants of unit.images) for (const address of variants) note(images, sameImage(address), i);
  });
  return { placeable, all, allBlocks, images };
}

/** Le premier bloc du conteneur, hors des blocs exclus, qui lit la phrase `needle` ; -1 si aucun. */
function placeIn(units: Unit[], index: FrameIndex, needle: string, scan: Scan): number {
  const known = index.placeable.get(needle)?.[0];
  if (known !== undefined) return known;
  for (let i = 0; i < units.length; i++) {
    if (scan.left <= 0) return -1;
    if (!units[i].excluded && scanned(units[i].norm, needle, scan)) return i;
  }
  return -1;
}

/** Au-delà de cette part de texte en liens, un bloc n'est remis que sur preuve. */
const LINK_SHARE_MAX = 0.5;

/**
 * Une image seule dans un lien d'agrandissement — le lien mène au fichier de
 * l'image, ou se dit visionneuse (`lightbox`, `pswp`, `zoom`…) : l'image
 * d'en-tête d'Ars Technica et de Numerama (REG-244). Ce n'est pas un bloc
 * « de liens » : elle revient (sans le lien, `remittable` ne copie que
 * l'image). Une vignette liée vers une autre page reste un lien.
 */
function zoomedImage(el: Element, link: Element): boolean {
  if ((el.textContent || '').trim() || !(el.tagName.toLowerCase() === 'img' || el.querySelector('img'))) return false;
  const href = (link.getAttribute('href') || '').trim();
  if (IMAGE_FILE.test(href)) return true;
  const hints = `${link.getAttribute('class') || ''} ${link.getAttribute('rel') || ''} ${Array.from(link.attributes).map((a) => a.name).join(' ')}`;
  return /lightbox|pswp|fancybox|zoom/i.test(hints);
}

/** Le bloc est-il fait à plus de moitié de liens (ou dans un lien) ? */
function mostlyLinks(el: Element): boolean {
  const link = el.closest('a');
  if (link) return !zoomedImage(el, link);
  let all = 0;
  let linked = 0;
  const stack: Array<[Node, boolean]> = [[el, false]];
  while (stack.length) {
    const [node, inLink] = stack.pop()!;
    if (node.nodeType === 3) {
      const length = (node.textContent || '').replace(/\s+/g, ' ').trim().length;
      all += length;
      if (inLink) linked += length;
      continue;
    }
    if (node.nodeType !== 1 || UNREAD.has((node as Element).tagName.toLowerCase())) continue;
    const link = inLink || (node as Element).tagName.toLowerCase() === 'a';
    for (let child = node.firstChild; child; child = child.nextSibling) stack.push([child, link]);
  }
  return all > 0 && linked > LINK_SHARE_MAX * all;
}

/** La SUITE du corps a le gabarit de l'un de ses derniers blocs lus. */
const SUITE_BOUNDS = 3;

/** Une carte : au plus ce texte, à au plus tant de niveaux au-dessus du bloc. */
const CARD_TEXT_MAX = 600;
const CARD_DEPTH = 3;
const CARD_NODES = 400;
/** Le titre d'une carte : un intertitre qui mène ailleurs. */
const CARD_HEADING = 'h2 a[href], h3 a[href], h4 a[href], a[href] h2, a[href] h3, a[href] h4';

/**
 * Le bloc est-il dans une carte — un court ensemble que titre un intertitre
 * menant à une autre page (RC-07) ? Une ancre vers la page même (`#…`) n'en
 * fait pas une.
 */
function inCard(el: Element, root: Element, memo: Map<Element, boolean>): boolean {
  let depth = 0;
  for (let up = el.parentElement; up && up !== root && depth < CARD_DEPTH; up = up.parentElement, depth++) {
    let known = memo.get(up);
    if (known === undefined) {
      // Court d'abord (au plus `CARD_NODES` nœuds lus) : un grand bloc n'est pas une carte.
      known = shortBlock(up) && (Array.from(up.querySelectorAll(CARD_HEADING)) as Element[])
        .some((found) => !((found.closest('a') ?? found.querySelector('a'))?.getAttribute('href') || '').trim().startsWith('#'));
      memo.set(up, known);
    }
    if (known) return true;
  }
  return false;
}

/** Le bloc porte-t-il au plus `CARD_TEXT_MAX` caractères, lus en au plus `CARD_NODES` nœuds ? */
function shortBlock(root: Element): boolean {
  let length = 0;
  let nodes = 0;
  const stack: Node[] = [root];
  while (stack.length) {
    if (++nodes > CARD_NODES) return false;
    const node = stack.pop()!;
    if (node.nodeType === 3) {
      length += (node.textContent || '').replace(/\s+/g, ' ').trim().length;
      if (length > CARD_TEXT_MAX) return false;
      continue;
    }
    if (node.nodeType !== 1 || INVISIBLE.has((node as Element).tagName.toLowerCase())) continue;
    for (let child = node.firstChild; child; child = child.nextSibling) stack.push(child);
  }
  return true;
}

/** Le texte hors lien qu'une entrée doit porter pour qu'une liste soit du corps (RC-03). */
const ENTRY_TEXT_MIN = 5;

/** Chaque entrée de la liste porte-t-elle du texte hors de ses liens ? */
function entriesCarryText(list: Element): boolean {
  const entries = Array.from(list.children).filter((child) => child.tagName.toLowerCase() === 'li');
  return entries.length > 0 && entries.every((entry) => {
    let own = 0;
    const stack: Node[] = [entry];
    while (stack.length) {
      const node = stack.pop()!;
      if (node.nodeType === 3) own += (node.textContent || '').replace(/\s+/g, '').length;
      else if (node.nodeType === 1 && !['a', ...UNREAD].includes((node as Element).tagName.toLowerCase())) {
        for (let child = node.firstChild; child; child = child.nextSibling) stack.push(child);
      }
    }
    return own >= ENTRY_TEXT_MIN;
  });
}

/** Ce que Readability retire d'un bloc, et que la copie remise ne porte donc pas non plus. */
const NOT_REMITTED_TAGS = new Set(['script', 'style', 'noscript', 'template', 'button', 'input', 'select', 'textarea', 'label', 'link', 'meta', 'dialog', 'form', 'object', 'embed']);
/** Attributs de présentation que Readability retire (`_cleanStyles`), et la classe (`_cleanClasses`). */
const PRESENTATION = ['class', 'style', 'align', 'background', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'frame', 'hspace', 'rules', 'valign', 'vspace'];

/** Un `src` d'image qui ne montre rien : absent, cadre `data:` non base64, ou petit `data:` base64. */
function placeholderImage(src: string | null): boolean {
  return isPlaceholderSource(src) || (/^\s*data:/i.test(src!) && src!.length < 200);
}

/**
 * La copie d'un bloc de la page, nettoyée comme Readability nettoie le sien :
 * sans script, contrôle ni voile, sans ce que la page masque, sans classe ni
 * style (une classe de masquage de la page masquerait le texte dans le
 * lecteur), adresses absolues, image paresseuse résolue (`_fixLazyImages`).
 */
function remittable(el: Element, base: string): Element {
  const copy = el.cloneNode(true) as Element;
  const inside = copy.firstElementChild ? Array.from(copy.querySelectorAll('*')) as Element[] : [];
  for (const inner of inside) {
    // Ni un contrôle, un script, un voile ; ni ce que la page masque, ni un
    // compteur de commentaires glissé dans le bloc, ni ce que la page soustrait
    // aux extraits des moteurs (RC-10).
    if (NOT_REMITTED_TAGS.has(inner.tagName.toLowerCase()) || inner.hasAttribute(VEIL_ATTR)
      || hiddenOnPage(inner) || isComments(inner) || inner.hasAttribute('data-nosnippet')) inner.remove();
  }
  for (const node of [copy, ...inside.filter((inner) => copy.contains(inner))]) {
    // Le repli d'un média ne se montre pas (« CodePen Embed Fallback », « Your
    // browser does not support the audio element ») : seules ses sources restent.
    if (MEDIA_UNITS.has(node.tagName.toLowerCase())) {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType !== 1 || !MEDIA_PARTS.has((child as Element).tagName.toLowerCase())) child.remove();
      }
    }
    for (const name of PRESENTATION) node.removeAttribute(name);
    for (const name of ['href', 'src', 'poster']) {
      const value = node.getAttribute(name);
      const resolved = value && !/^\s*#/.test(value) ? absolute(value, base) : null;
      if (resolved) node.setAttribute(name, resolved);
    }
    const srcset = node.getAttribute('srcset');
    if (srcset) {
      node.setAttribute('srcset', srcset.split(',').map((candidate) => {
        const [address, ...size] = candidate.trim().split(/\s+/);
        return [absolute(address, base) ?? address, ...size].join(' ');
      }).join(', '));
    }
    if (node.tagName.toLowerCase() === 'img' && placeholderImage(node.getAttribute('src'))) {
      for (const attr of Array.from(node.attributes)) {
        if (!attr.name.startsWith('data-')) continue;
        const candidates = srcsetAddresses(attr.value);
        if (!candidates.length || !IMAGE_FILE.test(candidates[0])) continue;
        const resolved = absolute(candidates[0], base);
        if (!resolved) continue;
        node.setAttribute('src', resolved);
        break;
      }
    }
  }
  return copy;
}

/** Blocs de texte terminaux : ceux qu'un bloc remis perd quand le résultat les lit déjà. */
const LEAF_BLOCKS = 'p, li, figcaption, h1, h2, h3, h4, h5, h6, blockquote, dt, dd, td, th, caption, div';

/** Un bloc enfant qui porte encore quelque chose à lire (un bloc vidé ne compte plus). */
function readableBlock(child: Element): boolean {
  return BLOCKS.has(child.tagName.toLowerCase()) && (!!(child.textContent || '').trim() || !!child.querySelector('img, ' + MEDIA_TAGS));
}

/**
 * Retire de `el` (jamais `el` lui-même) chaque bloc terminal que le résultat
 * lit déjà (RG-02 : la légende d'une image perdue, une entrée de liste déjà
 * lue), des plus profonds aux englobants — une entrée dont les sous-entrées
 * sont lues est jugée sur son propre texte (une bibliographie de Wikipédia) —,
 * puis chaque image que le résultat montre déjà (la figure remise pour sa
 * légende n'en double pas la photo). Un paragraphe qui mêle une phrase lue et
 * une phrase perdue reste entier : un doublon plutôt qu'une perte.
 */
function withoutWhatIsRead(el: Element, base: string, alreadyRead: (unit: Unit) => boolean, images: Set<string>): void {
  // `alreadyRead` : lue TELLE QUELLE — ses phrases comme phrases du résultat,
  // ou son texte comme un bloc du résultat (RC-02 : « 4 GB » lu dans « 4 GB of
  // RAM », l'entrée d'un avis lue dans son résumé, sortaient de la copie).
  if (!el.firstElementChild) return;
  const leaves = Array.from(el.querySelectorAll(LEAF_BLOCKS)) as Element[];
  for (let i = leaves.length - 1; i >= 0; i--) {
    const leaf = leaves[i];
    if (!el.contains(leaf)) continue;
    if (!Array.from(leaf.children).some(readableBlock)) {
      if (alreadyRead(unitOf(leaf, base, false))) leaf.remove();
      continue;
    }
    // Un bloc mêlé (« Les alliés : » puis la légende en paragraphes) : son
    // propre texte, hors de ses blocs, sort s'il est déjà lu.
    const own = Array.from(leaf.childNodes).filter((node) => node.nodeType === 3
      || (node.nodeType === 1 && !BLOCKS.has((node as Element).tagName.toLowerCase()) && !(node as Element).matches('img, ' + MEDIA_TAGS) && !(node as Element).querySelector('img, ' + MEDIA_TAGS)));
    const text = own.map((node) => node.textContent || '').join('').replace(/\s+/g, ' ').trim();
    if (text && alreadyRead(new Unit(leaf, [text], []))) for (const node of own) node.parentNode?.removeChild(node);
  }
  for (const img of Array.from(el.querySelectorAll('img')) as Element[]) {
    if (!imageAddresses(img, base, false).some((address) => images.has(sameImage(address)))) continue;
    const holder = img.parentElement?.tagName.toLowerCase() === 'picture' && img.parentElement !== el ? img.parentElement : img;
    if (holder !== el) holder.remove();
  }
}

/** Phrases d'un bloc du résultat, et occurrences de chacune, qui votent pour sa place. */
const PLACE_SENTENCES = 8;
const PLACE_CANDIDATES = 16;

/** Un bloc du résultat et le bloc du conteneur où il se situe (-1 : introuvable). */
interface Placed { el: Element; place: number }

/** Le bloc qui porte le résultat de Readability (`div.page`), ou la racine. */
const resultPage = (root: Element) => (root.children.length === 1 ? root.firstElementChild! : root);

/** Chaque bloc du résultat, dans son ordre, et sa place dans le conteneur. */
function locate(root: Element, index: FrameIndex, base: string): Placed[] {
  const placed: Placed[] = [];
  let previous = -1;
  for (const unit of unitsOf(resultPage(root), base)) {
    // Le bloc du conteneur qui porte le plus de ses phrases ; à égalité, le
    // premier après le bloc précédent (RC-06 : une phrase reprise dans un
    // encadré « Key points » plus haut ne déplace pas le paragraphe).
    const votes = new Map<number, number>();
    for (const s of unit.tracked.slice(0, PLACE_SENTENCES)) {
      for (const at of (index.all.get(s) ?? []).slice(0, PLACE_CANDIDATES)) votes.set(at, (votes.get(at) ?? 0) + 1);
    }
    let place = -1;
    let best = 0;
    for (const [at, count] of [...votes].sort((a, b) => a[0] - b[0])) {
      const better = count > best || (count === best && place <= previous && at > previous);
      if (better) { place = at; best = count; }
    }
    if (place < 0 && !unit.tracked.length) {
      const at = index.allBlocks.get(unit.norm.trim()) ?? [];
      place = at.find((i) => i > previous) ?? at[0] ?? -1;
    }
    if (place < 0) {
      for (const addresses of unit.images) {
        const at = addresses.map((address) => index.images.get(sameImage(address))?.[0]).find((i) => i !== undefined);
        if (at !== undefined) { place = at; break; }
      }
    }
    placed.push({ el: unit.el, place });
    if (place >= 0) previous = place;
  }
  return placed;
}

/**
 * Verse les blocs remis dans le résultat, chacun à sa place dans l'ordre de
 * la page (RG-03) : avant le premier bloc du résultat qui le suit dans le
 * conteneur, sinon après le dernier qui le précède ; en tête du résultat
 * quand aucun bloc du résultat ne se lit dans le conteneur. Un bloc du
 * résultat qu'on ne retrouve pas dans le conteneur (une date, un texte que
 * Readability a retouché) suit le bloc qui le suit : rien ne s'insère entre
 * eux (la date d'une carte reste sur sa carte, Docker).
 */
function placeInResult(root: Element, picked: Array<{ el: Element; place: number }>, placed: Placed[]): void {
  const page = resultPage(root);
  // Les blocs situés, chacun avec ce qui le précède et le suit d'introuvable :
  // on insère avant le premier, ou après le dernier.
  const own: Array<{ place: number; lead: Element; trail: Element }> = [];
  placed.forEach(({ place }, r) => {
    if (place < 0) return;
    let first = r;
    while (first > 0 && placed[first - 1].place < 0) first--;
    let last = r;
    while (last + 1 < placed.length && placed[last + 1].place < 0) last++;
    own.push({ place, lead: placed[first].el, trail: placed[last].el });
  });
  // Par place croissante : le premier du résultat (le plus petit rang) parmi
  // ceux qui suivent une place, le dernier parmi ceux qui la précèdent.
  const sorted = own.map((mine, rank) => ({ place: mine.place, rank })).sort((a, b) => a.place - b.place);
  const firstAfter = new Array<number>(sorted.length);
  const lastUpTo = new Array<number>(sorted.length);
  for (let k = sorted.length - 1; k >= 0; k--) firstAfter[k] = Math.min(sorted[k].rank, k + 1 < sorted.length ? firstAfter[k + 1] : Infinity);
  for (let k = 0; k < sorted.length; k++) lastUpTo[k] = Math.max(sorted[k].rank, k > 0 ? lastUpTo[k - 1] : -Infinity);
  /** Le rang du premier élément de `sorted` dont la place dépasse `place`. */
  const boundary = (place: number) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid].place > place) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };
  /** Le dernier bloc versé après un bloc du résultat (ou en tête) : le suivant va après lui. */
  let tail: { after: Element | null; inserted: Element } | null = null;
  for (const { el, place } of picked) {
    const html = el.outerHTML;
    const k = boundary(place);
    if (k < sorted.length) {
      own[firstAfter[k]].lead.insertAdjacentHTML('beforebegin', html);
      continue;
    }
    const previous = k > 0 ? own[lastUpTo[k - 1]].trail : null;
    const ref: Element | null = tail && tail.after === previous ? tail.inserted : previous;
    if (ref) {
      ref.insertAdjacentHTML('afterend', html);
      tail = { after: previous, inserted: ref.nextElementSibling! };
    } else {
      page.insertAdjacentHTML('afterbegin', html);
      tail = { after: null, inserted: page.firstElementChild! };
    }
  }
}

/** Les premiers et les derniers mots d'une phrase retouchée, que le résultat lit encore. */
const RETOUCH_WORDS = 5;
/** Ce que Readability peut ôter du milieu d'une phrase retouchée (un appel de note) ; au-delà, elle est perdue. */
const RETOUCH_SLACK = 40;

/** Les premiers mots du titre qui reconnaissent son `<h1>`. */
const TITLE_WORDS = 5;

/**
 * Le `<h1>` du titre, que le lecteur affiche à part : il commence par les
 * premiers mots du titre, son dernier mot mis à part — Readability coupe un
 * titre trop long (« … après avoir é... », Les Numériques).
 */
function isTitle(unit: Unit, title: string): boolean {
  return unit.el.tagName.toLowerCase() === 'h1' && titleLike(unit.norm.trim(), title);
}

/**
 * Le texte normalisé `own` est-il le titre `title` (normalisé, encadré
 * d'espaces) ? Il commence par ses premiers mots, ou le titre le contient en
 * entier — à partir de trois mots : un nom de site seul (« TechDaily ») que
 * `<title>` répète n'est pas le titre.
 */
function titleLike(own: string, title: string): boolean {
  const words = title.trim().split(' ').filter(Boolean);
  if (!own || !words.length) return false;
  const opening = words.slice(0, Math.max(1, Math.min(TITLE_WORDS, words.length - 1))).join(' ');
  return own.startsWith(opening) || (own.split(' ').length >= 3 && reads(title, own));
}

/** Le résultat de Readability, sans perte de ce que le conteneur de la page porte (voir plus haut). */
function withoutLoss(pass: Pass, parse: (html: string) => Element, base: string): ExtractedContent {
  const frame = pass.frame;
  if (!frame) return pass.article;
  const { units } = frame;
  const root = parse(pass.article.content);
  const kept = keptOf(root, base);
  const title = ` ${normalized(pass.article.title)} `;
  const scan: Scan = { left: SCAN_FACTOR * (normalizedLength(pass.textContent) + frameLength(units)) + SCAN_FLOOR };
  const index = indexOf(units);
  // Ce que `reader` lit (le titre, que le lecteur affiche à part, compris).
  const sentenceRead = (reader: Kept, s: string) => reads(title, s) || holds(reader, s, scan);
  const textRead = (reader: Kept, unit: Unit) => {
    if (unit.tracked.length) {
      return unit.tracked.every((s) => sentenceRead(reader, s))
        && unit.shortLeaves.every((t) => reads(title, t) || readsWithin(reader, t, scan));
    }
    const text = unit.norm.trim();
    return !text || reads(title, text) || readsWithin(reader, text, scan);
  };
  const imagesRead = (reader: Kept, unit: Unit) => unit.images.every((variants) => variants.some((address) => reader.images.has(sameImage(address))));
  const fullyRead = (reader: Kept) => (unit: Unit) => textRead(reader, unit) && imagesRead(reader, unit);
  // Une entrée ne sort d'une copie remise que lue telle quelle (RC-02).
  const asIs = (unit: Unit) => {
    if (!imagesRead(kept, unit)) return false;
    if (unit.tracked.length) return unit.tracked.every((s) => kept.sentences.has(s) || reads(title, s));
    return unit.parts.every((part) => kept.blocks.has(part) || reads(title, part));
  };

  // Les blocs que le résultat lit : tout le texte, ou un paragraphe retouché
  // (plus bas) — un bloc d'au moins 25 caractères est une borne du corps lu.
  // Jugés à la demande : un bloc court n'est cherché que s'il est candidat
  // (coût).
  const textMemo: Array<boolean | undefined> = [];
  const text = (i: number) => textMemo[i] ??= textRead(kept, units[i]);
  // Retouché : un paragraphe (pas une liste, un tableau, une figure, dont les
  // entrées lues sont ôtées de la copie) dont le résultat lit au moins la
  // moitié des phrases, et le début et la fin de chacune des autres — une
  // phrase que Readability a touchée en son milieu (un appel de note retiré).
  // Une phrase dont le début ou la fin ne se lit pas est perdue : le
  // paragraphe revient.
  // Le début et la fin se lisent dans un même passage du résultat, dans
  // l'ordre, à moins de la longueur de la phrase plus `RETOUCH_SLACK` (RC-05 :
  // lus n'importe où, « passera de 3 à 5 % » se perdait).
  const nearlyRead = (s: string) => {
    const words = s.split(' ');
    return words.length > 2 * RETOUCH_WORDS
      && kept.text.near(words.slice(0, RETOUCH_WORDS).join(' '), words.slice(-RETOUCH_WORDS).join(' '), s.length + RETOUCH_SLACK, scan);
  };
  const retouched = (i: number) => {
    const unit = units[i];
    if (unit.tracked.length < 2 || text(i) || unit.el.querySelector(LEAF_BLOCKS)) return false;
    const unread = unit.tracked.filter((s) => !sentenceRead(kept, s));
    return unread.length * 2 <= unit.tracked.length && unread.every(nearlyRead);
  };
  // Les bornes du corps lu sont les blocs du conteneur où se situe un bloc du
  // résultat (`locate`), d'au moins 25 caractères et pas faits de liens —
  // pas un bloc dont le résultat lit le texte ailleurs (RC-07 : sur le blog de
  // GitHub, l'extrait d'une carte « liés » qui reprend le chapeau faisait du
  // titre à la carte un seul trou, « Tags: » et « Table of Contents » compris).
  const placedInResult = locate(root, index, base);
  const located = new Set(placedInResult.map((mine) => mine.place).filter((place) => place >= 0));
  // Une carte (« liés », « More on Git ») que Readability a gardée n'est une
  // borne que si le résultat n'a rien d'autre, et un bloc fait de liens que
  // s'il n'a que cela : chez Docker, il n'a que les cartes (une liste de
  // liens), et c'est ce qui les précède qui est l'article.
  // Ni un `<h1>` (le titre de la page, qu'une carte reprend : Docker), ni le texte du titre.
  const headline = (i: number) => units[i].el.tagName.toLowerCase() === 'h1' || titleLike(units[i].norm.trim(), title);
  const body = (i: number) => located.has(i) && units[i].norm.trim().length >= TRACKED_MIN && !mostlyLinks(units[i].el) && !headline(i);
  const cards = new Map<number, boolean>();
  const cardHolders = new Map<Element, boolean>();
  const card = (i: number) => {
    let known = cards.get(i);
    if (known === undefined) cards.set(i, known = inCard(units[i].el, frame.root, cardHolders));
    return known;
  };
  const plain = units.some((_, i) => body(i) && !card(i));
  const anyBody = units.some((_, i) => body(i));
  const loose = (i: number) => located.has(i) && units[i].norm.trim().length >= TRACKED_MIN && !headline(i);
  const bound = (i: number) => (anyBody ? body(i) && !(plain && card(i)) : loose(i));
  const first = units.findIndex((_, i) => bound(i));
  let last = -1;
  for (let i = units.length - 1; i >= 0 && last < 0; i--) if (bound(i)) last = i;

  // Le gabarit du corps lu : les parents de ses blocs, leur balise et leur classe.
  const shape = (el: Element | null) => {
    const name = (el?.getAttribute('class') || '').trim();
    return el && name ? `${el.tagName.toLowerCase()}.${name}` : null;
  };
  // Celui des DERNIERS blocs lus : le chapeau de GitHub a la classe des
  // extraits de ses cartes « liés », qui ne sont pas la suite du corps (RC-07).
  const parents = new Set<Element | null>();
  const shapes = new Set<string>();
  for (let i = last, n = 0; i >= first && first >= 0 && n < SUITE_BOUNDS; i--) {
    if (!bound(i)) continue;
    n++;
    parents.add(units[i].el.parentElement);
    const own = shape(units[i].el.parentElement);
    if (own) shapes.add(own);
  }
  const short = normalizedLength(pass.textContent) < READABILITY_CHAR_THRESHOLD;

  // Les blocs que la page certifie (PREUVE).
  const proven = new Set<number>();
  for (const s of frame.evidence) {
    if (sentenceRead(kept, s)) continue;
    const at = placeIn(units, index, s, scan);
    if (at >= 0) proven.add(at);
  }

  // L'en-tête de l'article (RC-08) : ce qui précède son titre n'en est que
  // dans le même habillage que lui — l'ancêtre le plus large du `<h1>` qui ne
  // contient pas le corps lu (le surtitre d'Ars, le crédit de l'image de
  // TechCrunch) ; un bandeau « tendances » placé avant, dans le `<main>`, non.
  const heading = first < 0 ? -1 : units.findIndex((unit, i) => i < first && isTitle(unit, title));
  let header: Element | null = null;
  if (heading >= 0) {
    header = units[heading].el;
    while (header.parentElement && header.parentElement !== frame.root && !header.parentElement.contains(units[first].el)) header = header.parentElement;
  }
  const inHeader = (i: number) => heading < 0 || i > heading || header!.contains(units[i].el);
  // Une liste du corps (trou ou suite) dont chaque entrée porte du texte hors
  // lien (« au lieu de 149 € »), ou qui suit un intertitre remis, est du corps
  // même faite de liens (RC-03 : les vingt offres d'un bon plan de Clubic).
  const LIST = /^(?:ul|ol)$/i;
  const HEADING_TAG = /^h[1-6]$/i;
  const bodyList = (i: number) => first < i && LIST.test(units[i].el.tagName)
    && ((wanted[wanted.length - 1] === i - 1 && HEADING_TAG.test(units[i - 1].el.tagName)) || entriesCarryText(units[i].el));
  const wanted: number[] = [];
  /** Les blocs remis entiers, sans en ôter ce que le résultat lit déjà. */
  const whole = new Set<number>();
  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    if (unit.excluded || isTitle(unit, title)) continue;
    if (!proven.has(i)) {
      if (first < 0) continue;
      const parent = unit.el.parentElement;
      const suite = i > last && (short || parents.has(parent) || shapes.has(shape(parent) ?? '')) && !card(i);
      const placed = (i < first ? inHeader(i) : i <= last) || suite;
      if (!placed || (mostlyLinks(unit.el) && !bodyList(i))) continue;
    }
    if ((text(i) && imagesRead(kept, unit)) || retouched(i)) {
      // Un intertitre remis ne reste pas orphelin : le bloc qui le suit, que
      // le résultat lit ailleurs sans l'avoir à cette place (un encadré « Key
      // points » qui reprend une phrase du corps), revient avec lui, entier —
      // la page le montre deux fois.
      const heading = wanted[wanted.length - 1] === i - 1 && HEADING_TAG.test(units[i - 1].el.tagName);
      if (heading && !located.has(i) && !HEADING_TAG.test(unit.el.tagName)) { wanted.push(i); whole.add(i); }
      continue;
    }
    wanted.push(i);
  }
  // La question d'un `<details>` (son `<summary>`) va avec sa réponse, et
  // seulement avec elle (REG-239) : remise quand un bloc de la réponse est
  // remis ou lu, jamais seule — la FAQ de Clubic perdait ses questions (elles
  // n'ont pas le gabarit du corps, leurs réponses si) ; le titre d'un menu
  // replié revenait seul, sans ses liens.
  const questionOf = (i: number) => {
    const summary = units[i].el.closest('summary');
    const details = summary?.parentElement;
    return details && details.tagName.toLowerCase() === 'details' && frame.root.contains(details) ? details : null;
  };
  const answerOf = (i: number) => {
    const details = units[i].el.closest('details');
    return details && !units[i].el.closest('summary') && frame.root.contains(details) ? details : null;
  };
  const questions = new Set<number>();
  for (let k = wanted.length - 1; k >= 0; k--) {
    if (!proven.has(wanted[k]) && questionOf(wanted[k])) { questions.add(wanted[k]); wanted.splice(k, 1); }
  }
  const answered = new Set<Element>();
  for (const i of [...wanted, ...located]) {
    const details = answerOf(i);
    if (details) answered.add(details);
  }
  for (let i = 0; i < units.length; i++) {
    const details = questionOf(i);
    if (!details || !answered.has(details) || units[i].excluded || isTitle(units[i], title)) continue;
    // Déjà lue (et pas mise de côté plus haut) : rien à remettre.
    if (!questions.has(i) && text(i) && imagesRead(kept, units[i])) continue;
    if (!wanted.includes(i)) wanted.push(i);
  }
  wanted.sort((a, b) => a - b);
  // Budget épuisé en chemin : la garde s'abstient en entier plutôt qu'à moitié.
  if (!wanted.length || scan.left <= 0) return pass.article;

  const picked: Array<{ el: Element; place: number }> = [];
  const read = fullyRead(kept);
  for (const i of wanted) {
    // Un bloc remis est lu : son double plus loin (un chapeau écrit pour deux mises en page) ne revient pas.
    if (!whole.has(i) && read(units[i])) continue;
    const copy = remittable(units[i].el, base);
    if (!whole.has(i)) withoutWhatIsRead(copy, base, asIs, kept.images);
    const left = unitOf(copy, base, false);
    if ((!left.norm.trim() && !left.images.length) || (!whole.has(i) && read(left))) continue;
    for (const s of left.tracked) kept.sentences.add(s);
    kept.blocks.add(left.norm.trim());
    for (const addresses of left.images) for (const address of addresses) kept.images.add(sameImage(address));
    kept.text.append(left.norm.trim(), splitText(copy));
    picked.push({ el: copy, place: i });
  }
  if (!picked.length || scan.left <= 0) return pass.article;
  placeInResult(root, picked, placedInResult);
  return { ...pass.article, content: root.innerHTML, length: (root.textContent || '').length };
}

// ── Doublons (1.9.0, REG-225, REG-226) ──────────────────────────────
// Une page porte parfois deux exemplaires d'un même bloc, dont sa feuille de
// style n'en montre qu'un : The Verge écrit le chapeau et la photo d'en-tête
// une fois par mise en page (mobile, bureau), Ars Technica chaque légende dans
// la visionneuse (`div.pswp-caption-content`, masquée) puis dans le
// `<figcaption>`. Les classes sont hachées ou la règle est dans une feuille
// externe : le HTML ne dit pas lequel est masqué. Depuis que le nettoyage
// garde l'en-tête de ces pages, l'article complet les montrait tous les deux
// (Ars le faisait déjà en 1.8.0 pour les figures qu'elle gardait).
//
// Règle du propriétaire : rien de l'article ne doit manquer, un doublon vaut
// mieux qu'une perte. Une répétition voulue — refrain, anaphore, réplique —
// se lit dans le corps ; une copie de mise en page, dans l'en-tête ou dans
// une figure. Le texte ne se retire donc que là (relecture, RD-01) :
// - EN-TÊTE : avant le premier paragraphe du corps (un `<p>` hors figure
//   d'au moins `BODY_MIN` caractères ou de deux phrases suivies), et parmi
//   les `HEADER_MAX_LEAVES` premiers blocs de texte. Deux blocs au même texte
//   EXACT (casse et ponctuation comprises, blancs réduits — « ce soir ? »
//   n'est pas « ce soir ! »), qui se suivent sans rien de lisible entre eux
//   et ne sont pas frères (une copie de mise en page vit dans un autre
//   conteneur ; deux paragraphes frères identiques sont une répétition
//   écrite) : le second sort, sauf si lui seul porte un lien (alors c'est le
//   premier) ;
// - FIGURE : dans une même `<figure>`, un bloc que son `<figcaption>` reprend
//   en entier (même texte, ou le même suivi d'un crédit) sort, où qu'il soit
//   dans la figure ; la légende reste.
// Jamais un intertitre (`h1`–`h6`), une citation, ni un bloc qui est,
// contient ou se trouve dans une liste, un tableau, du code
// (`REPEAT_EXEMPT`, RD-04 : un avis du CERT-FR enveloppé dans un `<div>`),
// ni un bloc qui porte un média (`REPEAT_MEDIA`).
//
// Une IMAGE suivie, sans rien de lisible entre elles, d'une image identique
// sort, où qu'elle soit : même photo à la taille près (`imageIdentity`), même
// `srcset` et même adresse paresseuse (RD-03 : un même repli peut porter deux
// photos), même texte de remplacement (RD-02 : `alt=""` face à un `alt` n'est
// pas une copie). N copies en laissent une (RD-05). Une seule passe sur
// l'arbre, chaque retrait remontant au plus la profondeur (RD-07 : relire
// les enfants du parent à chaque retrait coûtait 4,5 s pour 20 000 images).
//
// Copie de la règle du serveur (`server/extract.ts`) ; toute modification de
// l'une va avec l'autre, et avec `EXTRACT_VERSION`.

/** Un bloc qui est, contient ou se trouve dans l'un d'eux n'est jamais retiré pour son texte. */
const REPEAT_EXEMPT = 'li, td, th, dt, dd, caption, table, ul, ol, dl, pre, code, h1, h2, h3, h4, h5, h6, blockquote, q';
/** Un média : un bloc qui en porte un n'est jamais retiré pour son texte. */
const REPEAT_MEDIA = 'img, picture, video, audio, iframe, object, embed, svg, canvas';
/** Un paragraphe de cette longueur ouvre le corps de l'article. */
const BODY_MIN = 200;
/** L'en-tête : au plus ces premiers blocs de texte. */
const HEADER_MAX_LEAVES = 4;
/** Blocs de texte comptés pour situer l'en-tête. */
const TEXT_LEAVES = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, dt, dd, td, th';

/** Travail de `withoutRepeats`, compté pour les tests (RD-07). */
export interface RepeatStats { visits: number }

/** Le texte exact de `el` (blancs réduits seulement), et s'il porte une phrase suivie. */
function exactText(el: Element): { text: string; tracked: boolean } {
  const blocks = blocksOf(el);
  return { text: blocks.join(' '), tracked: blocks.some((block) => sentencesOf(block).some(isTracked)) };
}

/** Le premier nœud lisible après `node` (son sous-arbre exclu) et dans `root`, ou `null`. */
function nextReadable(node: Node, root: Element): Node | null {
  for (let next = nextOutside(node); next && root.contains(next); next = nextOutside(next)) {
    if (isReadable(next)) return next;
  }
  return null;
}

/** Le premier enfant lisible de `el`, ou `null`. */
function firstReadableChild(el: Element): Node | null {
  for (let child = el.firstChild; child; child = child.nextSibling) if (isReadable(child)) return child;
  return null;
}

/** Un bloc qui peut perdre son texte : ni média, ni exempté, ni dans un exempté, n'en contenant pas. */
function textCandidate(el: Element): boolean {
  return !el.matches(REPEAT_MEDIA) && !el.querySelector(REPEAT_MEDIA) && !el.closest(REPEAT_EXEMPT) && !el.querySelector(REPEAT_EXEMPT);
}

/** Ce qui identifie une image face à sa voisine (RD-02, RD-03) ; `null` sans adresse. */
function imageKey(img: Element, base: string): string | null {
  const identity = imageIdentity(img.getAttribute('src'), base);
  if (!identity) return null;
  const set = (value: string | null) => (value || '').split(',').map((c) => imageIdentity(c.trim().split(/\s+/)[0], base)).filter(Boolean).sort().join(' ');
  const alt = img.getAttribute('alt');
  return [identity, set(img.getAttribute('srcset')), set(img.getAttribute('data-srcset')),
    imageIdentity(img.getAttribute('data-lazy-src') ?? img.getAttribute('data-src'), base) ?? '',
    alt === null ? '\u0000' : alt.replace(/\s+/g, ' ').trim()].join('\u0001');
}

/** Retire de `root` ses copies d'en-tête, de figure, et ses images répétées (voir plus haut). Vrai si quelque chose a changé. */
export function withoutRepeats(root: Element, base: string, stats: RepeatStats = { visits: 0 }): boolean {
  let changed = false;

  // Une seule passe : ce qui se lit sous chaque nœud, l'ordre des éléments
  // (entrée, sortie), et les images qui répètent leur voisine.
  const readable = new Map<Node, number>();
  const order = new Map<Element, [number, number]>();
  const twins: Element[] = [];
  let index = 0;
  let previous: string | null = null;
  const leaf = (el: Element, count: number) => { readable.set(el, count); order.set(el, [index, index]); index++; };
  const stack: Array<[Node, boolean]> = [[root, false]];
  while (stack.length) {
    const [node, exiting] = stack.pop()!;
    stats.visits++;
    if (node.nodeType === 3) {
      const text = (node.textContent || '').trim() ? 1 : 0;
      readable.set(node, text);
      if (text) previous = null;
      continue;
    }
    if (node.nodeType !== 1) { readable.set(node, 0); continue; }
    const el = node as Element;
    if (exiting) {
      let sum = 0;
      for (let child = el.firstChild; child; child = child.nextSibling) { sum += readable.get(child) ?? 0; stats.visits++; }
      readable.set(el, sum);
      order.get(el)![1] = index++;
      continue;
    }
    const tag = el.tagName.toLowerCase();
    if (INVISIBLE.has(tag)) { leaf(el, 0); continue; }
    if (tag === 'img') {
      leaf(el, 1);
      const key = imageKey(el, base);
      if (key && key === previous) twins.push(el);
      else previous = key;
      continue;
    }
    if (el.matches(REPEAT_MEDIA)) { leaf(el, 1); previous = null; continue; }
    order.set(el, [index++, -1]);
    stack.push([el, true]);
    for (let child = el.lastChild; child; child = child.previousSibling) stack.push([child, false]);
  }
  const remove = (gone: Element) => {
    const count = readable.get(gone) ?? 0;
    for (let up = gone.parentElement; up && up !== root; up = up.parentElement) { readable.set(up, (readable.get(up) ?? 0) - count); stats.visits++; }
    gone.remove();
    changed = true;
  };
  for (const img of twins) {
    // Ce qui n'enveloppait que la copie sort avec elle (un `<picture>`, un lien).
    let gone = img;
    while (gone.parentElement && gone.parentElement !== root && (readable.get(gone.parentElement) ?? 0) === (readable.get(gone) ?? 0)) { gone = gone.parentElement; stats.visits++; }
    remove(gone);
  }

  // L'en-tête : ce qui précède le premier paragraphe du corps, au plus les
  // premiers blocs de texte.
  let headerEnd = Infinity;
  let leaves = 0;
  for (const block of Array.from(root.querySelectorAll(TEXT_LEAVES)) as Element[]) {
    stats.visits++;
    if (!block.isConnected || block.closest('figure')) continue;
    const blocks = blocksOf(block);
    const text = blocks.join(' ');
    if (!text) continue;
    const opensBody = block.tagName.toLowerCase() === 'p' && (text.length >= BODY_MIN || blocks.flatMap(sentencesOf).filter(isTracked).length >= 2);
    if (opensBody || ++leaves > HEADER_MAX_LEAVES) { headerEnd = order.get(block)?.[0] ?? -1; break; }
  }
  const inHeader = (el: Element) => (order.get(el)?.[1] ?? Infinity) < headerEnd && !el.closest('figure');
  const linked = (el: Element) => el.matches('a[href]') || !!el.querySelector('a[href]');
  if (headerEnd > 0) {
    for (const first of Array.from(root.querySelectorAll('*')) as Element[]) {
      if ((order.get(first)?.[0] ?? Infinity) >= headerEnd) break;
      stats.visits++;
      if (!first.isConnected || !inHeader(first) || !textCandidate(first)) continue;
      const own = exactText(first);
      if (!own.tracked) continue;
      // Chaque copie qui suit, l'une après l'autre (RD-05 : trois en laissent une).
      for (let search = true; search && first.isConnected;) {
        search = false;
        for (let next = nextReadable(first, root); next && next.nodeType === 1; next = firstReadableChild(next as Element)) {
          const el = next as Element;
          stats.visits++;
          if (!inHeader(el) || el.parentElement === first.parentElement || !textCandidate(el) || exactText(el).text !== own.text) continue;
          if (linked(el) && !linked(first)) remove(first);
          else { remove(el); search = true; }
          break;
        }
      }
    }
  }

  // La figure : un bloc que son `<figcaption>` reprend en entier.
  for (const figure of Array.from(root.querySelectorAll('figure')) as Element[]) {
    const captions = (Array.from(figure.querySelectorAll('figcaption')) as Element[]).map((caption) => exactText(caption).text).filter(Boolean);
    if (!captions.length) continue;
    for (const block of Array.from(figure.querySelectorAll('*')) as Element[]) {
      stats.visits++;
      if (!block.isConnected || block.closest('figcaption') || block.querySelector('figcaption') || !textCandidate(block)) continue;
      const own = exactText(block);
      if (own.tracked && captions.some((caption) => caption === own.text || caption.startsWith(`${own.text} `))) remove(block);
    }
  }
  return changed;
}

/** Le résultat sans ses doublons (`withoutRepeats`) ; ce dernier tri ne fait jamais échouer une extraction. */
function onceEach(article: ExtractedContent, base: string): ExtractedContent {
  try {
    return withFragments((parse) => {
      const root = parse(article.content);
      if (!withoutRepeats(root, base)) return article;
      return { ...article, content: root.innerHTML, length: (root.textContent || '').length };
    });
  } catch {
    return article;
  }
}

/** `withoutRepeats` sur un HTML donné (tests de ses règles), comme `withoutRepeatsForTests` du serveur. */
export function withoutRepeatsForTests(html: string, base = 'https://example.com/a', stats?: RepeatStats): string {
  return withFragments((parse) => {
    const root = parse(html);
    return withoutRepeats(root, base, stats) ? root.innerHTML : html;
  });
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
  const strict = pagePass(url, html, { frame: guard });
  if (!strict) throw new NoContentError();
  // La garde de non-perte (REG-229, voir le serveur). Elle ne fait jamais
  // échouer une extraction (voir le serveur).
  let article: ExtractedContent;
  try {
    article = withFragments((parse) => withoutLoss(strict, parse, url));
  } catch {
    article = strict.article;
  } finally {
    // La copie du conteneur est vidée : une `<video>` la retiendrait en mémoire (`parsedDocument.ts`).
    strict.frame?.root.replaceChildren();
  }
  // Puis ses doublons qui se suivent (REG-225, REG-226).
  return onceEach(article, url);
}

/** Une passe d'extraction, et ce qu'elle a mesuré de la page avant Readability (voir le serveur). */
interface Pass { article: ExtractedContent; textContent: string; frame: Frame | null }

interface PassOptions {
  /** Mesurer le conteneur de l'article (`frameOf`), avant Readability. */
  frame?: boolean;
}

function pagePass(url: string, html: string, options: PassOptions): Pass | null {
  const load = () => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    // Images et médias paresseux d'abord : leurs adresses `data-src` relatives
    // sont ensuite résolues avec les autres (A1).
    resolveLazyImages(parsed.documentElement);
    // Les contrôles posés dans du code deviennent texte (REG-219).
    keepCodeControlsAsText(parsed.documentElement);
    absolutizeUrls(parsed, url);
    return parsed;
  };
  const clean = (parsed: Document) => {
    // Les blocs étrangers à l'article sortent avant toute passe (M-04).
    stripBoilerplate(parsed.documentElement);
    // Puis le corps réparti en blocs cousins est réuni (troisième round).
    joinSplitBody(parsed.documentElement);
    return parsed;
  };

  // Extract readable content. Chaque document est vidé ensuite : Chrome le
  // garderait sinon en mémoire s'il porte une vidéo (`parsedDocument.ts`).
  let result: ReturnType<Readability['parse']>;
  const doc = clean(load());
  let mainLength: number | null = null;
  let frame: Frame | null = null;
  try {
    // Mesurés AVANT Readability, qui modifie le document qu'il lit.
    mainLength = mainContainerTextLength(doc);
    frame = options.frame ? frameOf(doc, url) : null;
    // 500, la valeur par défaut de Readability et celle de la route serveur
    // (`READABILITY_CHAR_THRESHOLD`, `server/extract.ts`, qui dit pourquoi) :
    // à 50, une courte section restée après la première passe passait pour
    // l'article entier (L-04).
    result = new Readability(doc, { charThreshold: READABILITY_CHAR_THRESHOLD }).parse();
  } finally {
    releaseDocument(doc);
  }

  // A4-02 : une liste n'est pas un article. Si Readability n'a gardé qu'elle,
  // le conteneur principal est relu sans elle, puis elle y est remise à sa
  // place (voir le serveur).
  const list = result?.content ? onlyAList(result.content) : null;
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

  if (!result || !result.content) {
    frame?.root.replaceChildren();
    return null;
  }

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
  };
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
export function guardForTests(input: { page: string; result: string; title?: string; base?: string }): { content: string } {
  const base = input.base ?? 'https://example.com/a';
  return withFragments((parse) => {
    const page = new DOMParser().parseFromString(input.page, 'text/html');
    let frame: Frame | null = null;
    try {
      resolveLazyImages(page.documentElement);
      keepCodeControlsAsText(page.documentElement);
      stripBoilerplate(page.documentElement);
      joinSplitBody(page.documentElement);
      frame = frameOf(page, base);
      const root = parse(input.result);
      const pass: Pass = {
        article: { title: input.title ?? '', content: input.result, excerpt: '', byline: '', siteName: '', length: (root.textContent || '').length },
        textContent: root.textContent || '',
        frame,
      };
      return { content: withoutLoss(pass, parse, base).content };
    } finally {
      frame?.root.replaceChildren();
      releaseDocument(page);
    }
  });
}
