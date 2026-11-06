import { Readability } from '@mozilla/readability';
import { useAuthStore } from '../stores/authStore';
import { dropNonVideoIframes } from '../lib/youtube';
import { absolutizeUrls } from './absolutizeUrls';
import { purifyToString, releaseDocument } from '../lib/parsedDocument';
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
 * article-là — c'est déjà le coût connu d'un repli sur 422 ou 502 (ni un 415 ni un 413 ne se replient).
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
 * Le serveur a refusé la page pour sa COMPLEXITÉ (M-01) : imbrication ou
 * nombre d'éléments au-delà de ses seuils, délai ou mémoire de son worker
 * dépassés — une page piégée. Échec définitif : pas de repli (l'onglet
 * relirait la même page), et la page est retenue pour la session.
 */
export class PageTooComplexError extends Error {
  constructor() { super('PAGE_TOO_COMPLEX'); this.name = 'PageTooComplexError'; }
}

/** Le repli a reçu une réponse en erreur de `/api/proxy`. */
class FallbackHttpError extends Error {
  constructor(readonly status: number) { super(`HTTP ${status}`); this.name = 'FallbackHttpError'; }
}

/** Readability n'a rien trouvé de lisible, ni au serveur ni ici. */
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

function keepOnlyMainContainer(doc: Document): boolean {
  const container = findMainContainer(doc);
  if (!container || !doc.body) return false;
  doc.body.replaceChildren(container);
  return true;
}

async function extractOnce(url: string): Promise<ExtractedContent> {
  const { backendToken } = useAuthStore.getState();

  // Le serveur fait autorité quand il répond : il extrait une fois pour toute
  // l'instance et, quand Redis est là, partage le résultat entre appareils et
  // entre comptes. Toute réponse absente, en erreur, trop lente ou illisible
  // fait tomber sur l'extraction locale ci-dessous, qui reste le filet — la
  // route peut manquer (serveur plus ancien), ne pas savoir extraire la page
  // (422) ou échouer à la joindre (502, 504). Sauf un 415 (la cible n'est pas
  // une page) ou un 413 (plus de 2 Mo, le plafond du repli aussi) : le repli
  // relirait la même réponse pour échouer (`NotAPageError`). Ni un 422 portant
  // `tooComplex` : la page est piégée, l'onglet la relirait (M-01).
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
    // Un 422 sans lui (rien de lisible) garde le repli.
    if (served.status === 422) {
      const body = (await served.json().catch(() => null)) as { tooComplex?: unknown } | null;
      if (body?.tooComplex === true) throw new PageTooComplexError();
      return null;
    }
    if (served.status === 502) {
      const body = (await served.json().catch(() => null)) as { upstreamStatus?: unknown } | null;
      if (typeof body?.upstreamStatus === 'number') throw new UpstreamRefusedError(body.upstreamStatus);
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
    if (err instanceof NotAPageError || err instanceof UpstreamRefusedError || err instanceof PageTooComplexError) throw err;
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

  // Parse into a DOM document that Readability can work with. Rendre les URLs
  // absolues AVANT Readability, qui résout sinon contre `doc.baseURI` —
  // l'origine de FriRSS pour un document de `DOMParser`. Un `<base>` injecté
  // ici ne sert à rien : la CSP (`base-uri 'self'`) le refuse, et l'échec
  // n'apparaît que dans la console. Voir `absolutizeUrls`.
  const load = () => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    absolutizeUrls(parsed, url);
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

  // A-1 : même seconde passe que la route serveur (`server/extract.ts`, qui
  // dit pourquoi) quand Readability n'a gardé qu'un fragment du conteneur que
  // la page désigne elle-même. Seul le corps est repris ; titre, auteur et
  // chapeau restent ceux de la passe normale.
  if (result?.content && mainLength != null && keptTooLittle(result.textContent || '', mainLength)) {
    const retry = load();
    try {
      if (keepOnlyMainContainer(retry)) {
        const again = new Readability(retry, MAIN_CONTAINER_OPTIONS).parse();
        if (again?.content && normalizedLength(again.textContent || '') > normalizedLength(result.textContent || '')) {
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
