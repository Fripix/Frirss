import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { markupTooComplex } from './markupBounds.js';

export interface ExtractedArticle {
  title: string;
  content: string;
  excerpt: string;
  byline: string;
  siteName: string;
  length: number;
}

/**
 * Nombre d'extractions qu'on accepte d'avoir en cours ou en attente — donc,
 * depuis la 1.9.0, le nombre maximal de workers d'analyse vivants à la fois.
 *
 * `parseHTML` + `Readability` sont **entièrement synchrones**, et leur coût
 * n'est PAS borné par la taille de la page : il croît comme le CUBE de la
 * profondeur d'imbrication (M-01, campagne 1.9.0). Mesuré avec les modules de
 * ce dépôt : une page plate de 2 Mo coûte ~0,3 s, mais 1000 `<div>` imbriqués
 * (23 Ko) en coûtaient 17,8 s, 2000 (46 Ko) 158 s, et 5000 laissaient Node à
 * 100 % plus de quatre minutes. Quand cette analyse tournait sur la boucle
 * principale, c'était autant de temps où l'instance entière — `/api/health`,
 * le proxy de tous les comptes — ne répondait plus.
 *
 * D'où les deux couches qui l'entourent désormais :
 * - un **refus rapide** juste après l'analyse HTML, avant toute passe
 *   Readability (`EXTRACT_MAX_DEPTH`, `EXTRACT_MAX_ELEMENTS`) ;
 * - l'analyse elle-même dans un **`worker_thread`**, arrêté au bout de
 *   `EXTRACT_WORKER_TIMEOUT_MS` (`extractInWorker`). La boucle principale reste
 *   libre pendant tout ce temps.
 *
 * Ce que compte `pending` : les requêtes ARRIVÉES à l'analyse et pas encore
 * reparties — le compteur est pris à l'entrée, tenu pendant l'attente du tour
 * ET pendant le travail du worker, et rendu dans un `finally`. Il borne donc à
 * la fois la file et le nombre de workers (et leur mémoire) : au plus cinq
 * analyses à la fois, chacune bornée à 10 s.
 *
 * Au-delà, la requête est REFUSÉE plutôt que mise en attente (503 portant
 * `busy`) : un échec passager, que le client ne retient pas — « Réessayer »
 * reste possible, le passage suivant reprend l'article — quand une file sans
 * borne coûterait la mémoire du serveur et la patience du lecteur. Le client
 * ne se replie PAS sur son propre extracteur : il referait dans l'onglet
 * l'analyse refusée ici, sans borne de durée — 14 s de gel sur une page lente
 * (N-2, vérification 1.9.0).
 */
export const EXTRACT_MAX_PENDING = 5;

/** La file d'extraction est pleine — échec passager, sans repli du client. */
export class ExtractorBusyError extends Error {}

let pending = 0;
/** Fin de file : chaque analyse s'accroche à la précédente. */
let tail: Promise<unknown> = Promise.resolve();

/** Extractions en cours ou en attente — pour les tests et le diagnostic. */
export function extractPending(): number {
  return pending;
}

/**
 * Exécute `run` (l'analyse, synchrone ou confiée à un worker) à son tour de
 * file.
 *
 * La file n'entoure QUE l'analyse : la tenir pendant la récupération réseau de
 * la page rendrait le débit de l'instance égal à celui du site le plus lent.
 *
 * `setImmediate` entre deux départs, et pas un simple `await` : une promesse
 * déjà réglée ne rend la main qu'aux micro-tâches, donc enchaînerait N
 * immobilisations sans que la boucle traite la moindre entrée-sortie — ce qui
 * reste vrai pour un `run` synchrone.
 *
 * `return await` et pas `return` : avec un `run` asynchrone (le worker), un
 * simple `return` exécuterait le `finally` AVANT la fin du travail, et
 * `pending` ne compterait plus les workers vivants.
 */
export async function withExtractSlot<T>(run: () => T | Promise<T>): Promise<T> {
  if (pending >= EXTRACT_MAX_PENDING) throw new ExtractorBusyError();
  pending++;
  const turn = tail.then(() => new Promise<void>((resolve) => setImmediate(resolve)));
  // La file avance même si un tour échoue : sans ce `catch`, une seule analyse
  // en erreur laisserait une promesse rejetée en fin de file et bloquerait
  // toutes les suivantes.
  tail = turn.catch(() => {});
  try {
    await turn;
    return await run();
  } finally {
    pending--;
  }
}

// ── Refus rapide d'une page trop complexe (M-01) ─────────────────────
// Deux mesures, aux mêmes seuils :
// - sur le TEXTE, AVANT `parseHTML` (`markupTooComplex`, `markupBounds.ts`) :
//   un balayage linéaire qui estime la pile de htmlparser2. C'est le vrai
//   refus rapide. L'analyse HTML n'est PAS bon marché sur une page piégée :
//   linkedom est quadratique en profondeur (50 000 `<div>` imbriqués coûtaient
//   1,2 s, 390 000 `<div>` jamais fermés 42 s, avant que l'arbre ne soit
//   mesuré — relecture 1.9.0) ; le balayage, lui, coûte ~4 ms pour 2 Mo ;
// - sur l'ARBRE, juste après `parseHTML` (`assertTreeBounded`) : un filet,
//   si l'estimation du texte et l'arbre réel venaient à diverger. Son coût
//   est celui d'un parcours de l'arbre, une fois celui-ci construit.
// Sur le corpus réel (275 pages), l'estimation et l'arbre coïncident exactement.
//
// Calibrage (2026-11-06, 38 pages réelles du corpus de la campagne — Ars,
// CERT-FR, Cloudflare, go.dev, Krebs, Next, Numerama, Schneier, The Verge… —
// plus deux longues pages Wikipédia de 2 et 3 Mo) : profondeur maximale
// relevée 34, éléments 21 828. Les seuils laissent donc une marge de 7× sur la
// profondeur et de près de 3× sur le nombre d'éléments.
//
// Coût AU seuil, sur une page faite pour coûter : 256 niveaux seuls ≈ 0,17 s ;
// 60 000 éléments à 16 niveaux ≈ 0,9 s. Sous les seuils, une page à la fois
// large ET profonde peut encore coûter plusieurs secondes (40 chaînes de
// 200 niveaux ≈ 2 s) : celle-là est bornée par le délai du worker, pas ici.

/** Profondeur d'imbrication maximale acceptée (`<html>` compte pour 1). */
export const EXTRACT_MAX_DEPTH = 256;

/** Nombre d'éléments maximal accepté. */
export const EXTRACT_MAX_ELEMENTS = 60_000;

/**
 * La page est refusée pour sa complexité : imbrication (`depth`), nombre
 * d'éléments (`elements`) ou mémoire du worker épuisée (`memory`). Échec
 * DÉFINITIF : la route le dit, le serveur le garde quelques minutes, et le
 * client ne se replie pas sur son propre extracteur.
 */
export class PageTooComplexError extends Error {
  constructor(readonly reason: 'depth' | 'elements' | 'memory') {
    super(`Page too complex (${reason})`);
    this.name = 'PageTooComplexError';
  }
}

/**
 * L'analyse a dépassé `EXTRACT_WORKER_TIMEOUT_MS`. PAS un refus pour
 * complexité (relecture 1.9.0) : un serveur chargé — cinq analyses à la fois,
 * une machine lente — peut dépasser le délai sur une page ordinaire. Ni gardé
 * par le serveur, ni retenu par le client, qui peut réessayer ; mais le client
 * ne se replie pas sur son propre extracteur, qui paierait la même analyse
 * dans l'onglet.
 */
export class ExtractTimeoutError extends Error {
  constructor() {
    super('Extraction timed out');
    this.name = 'ExtractTimeoutError';
  }
}

/**
 * Le worker est mort sans rendre de réponse : sorti de lui-même (« extract
 * worker exited ») ou tombé sur une erreur hors de l'analyse (autre que la
 * mémoire épuisée, qui est un refus pour complexité). Rendu jusqu'ici comme le
 * 502 nu d'un site injoignable, il renvoyait le client sur son propre
 * extracteur, qui refaisait l'analyse dans l'onglet sans borne de durée.
 * Échec PASSAGER, qui se dit (`crashed`) : ni gardé par le serveur, ni retenu
 * par le client, « Réessayer » possible, et pas de repli.
 */
export class ExtractWorkerCrashedError extends Error {
  constructor(readonly detail: string) {
    super(`Extract worker crashed (${detail})`);
    this.name = 'ExtractWorkerCrashedError';
  }
}

type ParsedDocument = ReturnType<typeof parseHTML>['document'];

/** Lève `PageTooComplexError` au premier seuil dépassé. Itératif : une pile
 *  d'appels récursive casserait (`RangeError`) bien avant les seuils. */
function assertTreeBounded(doc: ParsedDocument): void {
  const root = doc.documentElement as unknown as Element | null;
  if (!root) return;
  let elements = 0;
  const stack: Array<[Element, number]> = [[root, 1]];
  while (stack.length) {
    const [el, depth] = stack.pop()!;
    if (depth > EXTRACT_MAX_DEPTH) throw new PageTooComplexError('depth');
    if (++elements > EXTRACT_MAX_ELEMENTS) throw new PageTooComplexError('elements');
    for (let child = el.firstElementChild; child; child = child.nextElementSibling) stack.push([child, depth + 1]);
  }
}

// ── Un document entier pour Readability (C-03, quatrième round) ──────
// Un navigateur construit toujours `<html>`, `<head>` et `<body>`, et range
// dans le `<body>` tout contenu, même écrit hors de lui. linkedom construit
// l'arbre tel qu'il est écrit : une page vide ou de texte seul n'a pas de
// racine, et `document.head` levait une TypeError ; une page dont le contenu
// n'est pas sous un `<body>` (SVG seul, fragment, `<div>` après `</html>`,
// balises facultatives omises, `<head>` ouvert et jamais fermé — RX-01 :
// linkedom y laisse tout le contenu) en faisait lever une dans Readability, qui
// remonte de son candidat jusqu'au `<body>` et tombait sur le document. La
// route rendait un 502 nu, et le client se repliait sur son propre
// extracteur — qui, lui, lisait la page.
//
// Le document est donc complété comme le ferait le navigateur, et seulement
// quand il le faut : une page ordinaire (un seul élément racine, `<html>`, qui
// a son `<body>`) n'est pas touchée. Sans aucun élément, il n'y a rien à lire :
// `extractArticle` rend `null` (422 « Not extractable »).

/** Ce qu'un navigateur range dans `<head>` tant que le corps n'a pas commencé. */
const HEAD_ONLY = new Set(['title', 'meta', 'link', 'base', 'style']);
/** Ce qui reste aussi dans un `<head>` écrit, quand le navigateur le lit (RX-01). */
const IN_HEAD_TOO = new Set(['script', 'noscript', 'template']);

/** Complète `doc` en `<html>` + `<head>` + `<body>` ; `false` s'il n'a aucun élément. */
function wholeDocument(doc: ParsedDocument): boolean {
  const top = Array.from(doc.childNodes as unknown as ArrayLike<Node>);
  const roots = top.filter((node) => node.nodeType === 1) as Element[];
  if (!roots.length) return false;
  const childOf = (parent: Element, tag: string) => Array.from(parent.children).find((child) => child.tagName === tag) ?? null;
  let html = roots.find((root) => root.tagName === 'HTML') ?? null;
  if (roots.length === 1 && html && isOrdinary(html)) return true;

  const make = (tag: string) => doc.createElement(tag) as unknown as Element;
  if (!html) {
    html = make('html');
    (doc as unknown as Element).append(html);
  }
  let head = childOf(html, 'HEAD');
  if (!head) {
    head = make('head');
    html.prepend(head);
  }
  // Ce qui est écrit avant `<html>` ouvre la page ; ce qui suit `</html>` la
  // ferme.
  const opening: Node[] = [];
  const closing: Node[] = [];
  let afterHtml = false;
  for (const node of top) {
    if (node === html) afterHtml = true;
    else if (node.nodeType !== 10) (afterHtml ? closing : opening).push(node);
  }
  // Un `<head>` jamais fermé garde le contenu chez linkedom (RX-01) ; le
  // navigateur le ferme au premier élément qui n'y a pas sa place.
  // Jamais en arguments (`push(...)`, `prepend(...)`, `append(...)`) :
  // quelques centaines de milliers de nœuds dépassent la pile (RZ-06).
  for (const node of spilledFromHead(head)) opening.push(node);
  // Dans `<html>`, hors de `<head>` et `<body>` : ce qui précède `<body>` ouvre
  // la page, ce qui le suit la ferme ; sans `<body>`, tout l'ouvre.
  let body = childOf(html, 'BODY');
  const afterBody: Node[] = [];
  let pastBody = false;
  for (const node of Array.from(html.childNodes)) {
    if (node === head) continue;
    if (node === body) pastBody = true;
    else (pastBody ? afterBody : opening).push(node);
  }
  const tail = afterBody.concat(closing);
  if (!body) {
    body = make('body');
    html.append(body);
  }
  // Avant tout contenu, `title`, `meta`… vont dans `<head>` ; le reste, dans
  // l'ordre, en tête du `<body>`.
  const content: Node[] = [];
  for (const node of opening) {
    if (!content.length && headOnly(node)) head.append(node);
    else content.push(node);
  }
  const first = body.firstChild;
  for (const node of unwrapSections(content)) body.insertBefore(node, first);
  for (const node of unwrapSections(tail)) body.append(node);
  return true;
}

/** Une page ordinaire : `<html>` ne porte que `<head>`, `<body>`, des blancs et des commentaires, et rien ne déborde de `<head>`. */
function isOrdinary(html: Element): boolean {
  let body = false;
  for (let node = html.firstChild; node; node = node.nextSibling) {
    const tag = node.nodeType === 1 ? (node as Element).tagName : '';
    if (tag === 'BODY') body = true;
    else if (tag === 'HEAD') { if (spilledFromHead(node as Element).length) return false; }
    else if (!headOnly(node) || node.nodeType === 1) return false;
  }
  return body;
}

/**
 * Ce que linkedom laisse dans un `<head>` jamais fermé (RX-01) : tout, à
 * partir du premier nœud qui n'y a pas sa place — sauf `<title>`, que linkedom
 * ne cherche que dans `<head>` (le navigateur le trouve partout).
 */
function spilledFromHead(head: Element): Node[] {
  const spilled: Node[] = [];
  for (let node = head.firstChild; node; node = node.nextSibling) {
    if (!spilled.length && (headOnly(node) || (node.nodeType === 1 && IN_HEAD_TOO.has((node as Element).tagName.toLowerCase())))) continue;
    if (node.nodeType === 1 && (node as Element).tagName === 'TITLE') continue;
    spilled.push(node);
  }
  return spilled;
}

/** Un second `<html>`, `<head>` ou `<body>` égaré n'est pas imbriqué : il disparaît, son contenu reste à sa place. */
function unwrapSections(nodes: Node[]): Node[] {
  return nodes.flatMap((node) => {
    if (node.nodeType !== 1 || !['HTML', 'HEAD', 'BODY'].includes((node as Element).tagName)) return [node];
    const children = Array.from(node.childNodes);
    (node as Element).remove();
    return children;
  });
}

/** Un nœud qui ne commence pas le corps de la page : `title`, `meta`…, un blanc, un commentaire. */
function headOnly(node: Node): boolean {
  if (node.nodeType === 1) return HEAD_ONLY.has((node as Element).tagName.toLowerCase());
  return node.nodeType === 8 || (node.nodeType === 3 && !(node.textContent || '').trim());
}

// ── L'analyse dans un worker (M-01) ──────────────────────────────────

/**
 * Délai accordé à une analyse. Une vraie page de 2 Mo s'analyse en moins d'une
 * seconde (0,57 s pour la plus lourde du corpus) ; au-delà de 10 s, c'est le
 * plus souvent un piège — mais pas forcément : un serveur chargé peut le
 * dépasser sur une page ordinaire, d'où `ExtractTimeoutError`, un échec qui
 * n'est pas gardé. Le client abandonne de toute façon à 20 s.
 */
export const EXTRACT_WORKER_TIMEOUT_MS = 10_000;

/**
 * Plafond de tas d'un worker. Une page de 2 Mo n'en demande que quelques
 * dizaines de Mo ; le plafond empêche cinq workers piégés d'épuiser la mémoire
 * du processus qui sert toute l'instance.
 */
const WORKER_MAX_OLD_GENERATION_MB = 256;

/**
 * Le fichier du worker, et comment le lancer. En production (`server-dist/`,
 * image Docker), le `.js` compilé par `tsc` est à côté de ce module. En
 * développement (`tsx`) et sous vitest, seul le source `.ts` existe : il est
 * lancé avec le chargeur de `tsx` (`--import tsx`), qui résout aussi les
 * imports `.js` → `.ts` du worker.
 */
let entryCache: { url: URL; execArgv: string[] | undefined } | undefined;
function workerEntry(): { url: URL; execArgv: string[] | undefined } {
  if (entryCache) return entryCache;
  const compiled = new URL('./extractWorker.js', import.meta.url);
  entryCache = existsSync(fileURLToPath(compiled))
    ? { url: compiled, execArgv: undefined }
    : { url: new URL('./extractWorker.ts', import.meta.url), execArgv: ['--import', 'tsx'] };
  return entryCache;
}

/** Ce que le worker renvoie — le seul format qui traverse la frontière. */
export type WorkerReply =
  | { ok: true; article: ExtractedArticle | null }
  | { ok: false; tooComplex?: PageTooComplexError['reason']; message: string };

/**
 * `extractArticle` dans un `worker_thread`, arrêté au bout de `timeoutMs`.
 *
 * La boucle principale ne fait qu'attendre un message : un piège qui coûterait
 * des minutes n'immobilise plus que son worker, et ce worker est terminé
 * (`terminate()` interrompt aussi une boucle JavaScript synchrone) à
 * l'échéance. Un dépassement est rendu comme `ExtractTimeoutError` ; un worker
 * mort sans réponse, comme `ExtractWorkerCrashedError`.
 *
 * Un worker par analyse, pas de réserve : démarrer un worker coûte quelques
 * dizaines de millisecondes, négligeables devant la récupération de la page,
 * et un worker terminé à l'échéance ne laisse ainsi rien derrière lui.
 */
export function extractInWorker(url: string, html: string, timeoutMs = EXTRACT_WORKER_TIMEOUT_MS): Promise<ExtractedArticle | null> {
  const entry = workerEntry();
  return new Promise((resolve, reject) => {
    const worker = new Worker(entry.url, {
      workerData: { url, html },
      execArgv: entry.execArgv,
      resourceLimits: { maxOldGenerationSizeMb: WORKER_MAX_OLD_GENERATION_MB },
    });
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
      // Le résultat est en main : le worker n'a plus rien à faire.
      void worker.terminate();
    };
    const timer = setTimeout(() => settle(() => reject(new ExtractTimeoutError())), timeoutMs);
    worker.once('message', (reply: WorkerReply) => settle(() => {
      if (reply.ok) resolve(reply.article);
      else if (reply.tooComplex) reject(new PageTooComplexError(reply.tooComplex));
      else reject(new Error(reply.message));
    }));
    // Mort sans réponse : un plantage, pas un refus de la page — sauf la
    // mémoire épuisée, que la page a provoquée (`tooComplex`).
    worker.once('error', (err: Error & { code?: string }) => settle(() => {
      reject(err.code === 'ERR_WORKER_OUT_OF_MEMORY' ? new PageTooComplexError('memory')
        : new ExtractWorkerCrashedError(err.code || err.name || 'error'));
    }));
    worker.once('exit', (code) => settle(() => reject(new ExtractWorkerCrashedError(`exit ${code}`))));
  });
}

/**
 * Seuil de Readability : le nombre de caractères qu'une passe doit trouver
 * pour être acceptée. En deçà, Readability refait une passe en écartant moins
 * (candidats « improbables » gardés, poids des classes ignoré…), puis rend la
 * plus longue. Ce n'est donc jamais un refus : un seuil plus haut ne rend
 * aucune page « non extractible », il empêche de se contenter trop tôt.
 *
 * 500 est la valeur par défaut de Readability. FriRSS posait 50, depuis le
 * premier commit et sans raison écrite : sur la nouvelle mise en page du
 * CERT-FR, la première passe écartait le corps et gardait la seule section
 * « Solutions » — 135 caractères au lieu de 2 800, perte silencieuse (L-04).
 * Même valeur que le repli du navigateur (`src/utils/extractContent.ts`).
 */
export const READABILITY_CHAR_THRESHOLD = 500;

/**
 * Extrait le corps lisible d'une page. **Le HTML rendu est BRUT — il n'est PAS
 * assaini.** `onclick`, `onerror` et le reste survivent tels quels.
 *
 * L'assainissement se fait chez le client, à la réception (`sanitizeExtracted()`),
 * comme pour sa propre extraction. Afficher ce contenu sans passer par là est
 * une faille XSS, pas un raccourci.
 *
 * Décision du 2026-09-04, à ne pas « corriger » de bonne foi : assainir ici a
 * été tenté et abandonné parce que `createDOMPurify` sur la fenêtre de
 * `linkedom` ne filtre **rien** — il lui manque `NodeFilter`, DOMPurify bascule
 * silencieusement en mode « environnement non supporté » et rend son entrée
 * telle quelle, sans lever d'erreur. Le filet existait, y croire suffisait à
 * supprimer le vrai. Quiconque veut réintroduire un assainissement serveur doit
 * d'abord **prouver qu'il filtre** (un test qui injecte un `onerror` et le voit
 * disparaître), avant de toucher au client.
 *
 * `null` quand Readability ne trouve pas d'article, ou que la page n'a aucun
 * élément (vide, texte seul) : l'appelant le dit plutôt que de renvoyer un
 * corps vide.
 *
 * Lève `PageTooComplexError` quand la page dépasse `EXTRACT_MAX_DEPTH` ou
 * `EXTRACT_MAX_ELEMENTS` — vérifié sur le texte avant l'analyse HTML, puis sur
 * l'arbre avant toute passe Readability (M-01).
 * Synchrone : la route ne l'appelle qu'à travers `extractInWorker`.
 */
export function extractArticle(url: string, html: string): ExtractedArticle | null {
  const strict = strictPass(url, html);
  if (!strict) return null;
  // La garde de non-perte (REG-229) : ce que le conteneur de l'article porte
  // et que Readability a laissé y est remis, à sa place. Elle ne fait jamais
  // échouer une extraction : en cas d'erreur, le résultat reste celui de
  // Readability.
  let article: ExtractedArticle;
  try {
    article = withoutLoss(strict, parseFragment, url);
  } catch {
    article = strict.article;
  }
  return onceEach(article, url);
}

/**
 * Le résultat sans ses doublons (`withoutRepeats`, REG-225, REG-226). Comme la
 * garde, ce dernier tri ne fait jamais échouer une extraction.
 */
function onceEach(article: ExtractedArticle, base: string): ExtractedArticle {
  try {
    const root = parseFragment(article.content);
    if (!withoutRepeats(root, base)) return article;
    return { ...article, content: root.innerHTML, length: (root.textContent || '').length };
  } catch {
    return article;
  }
}

/** La passe nettoyée seule, bornes comprises, et le conteneur de l'article. */
function strictPass(url: string, html: string): Pass | null {
  // Le refus rapide d'abord, sur le texte : l'analyse HTML d'une page piégée
  // coûte déjà le carré de sa profondeur, Readability le cube.
  const tooComplex = markupTooComplex(html, { maxDepth: EXTRACT_MAX_DEPTH, maxElements: EXTRACT_MAX_ELEMENTS });
  if (tooComplex) throw new PageTooComplexError(tooComplex);
  return extractWith(url, html, { bound: true, frame: true });
}

/**
 * `extractArticle` sans la garde de non-perte — pour les tests, qui vérifient
 * que la garde ne touche pas aux pages où rien ne manque.
 */
export function extractWithoutGuard(url: string, html: string): ExtractedArticle | null {
  const strict = strictPass(url, html);
  return strict ? onceEach(strict.article, url) : null;
}

/**
 * La garde de non-perte appliquée à des morceaux donnés (tests de ses règles,
 * sans dépendre du choix de Readability) : `page` est la page, dont le
 * conteneur est lu comme par l'extraction (nettoyée, avant Readability),
 * `result` le résultat de Readability. Rend le contenu.
 */
export function guardForTests(input: { page: string; result: string; title?: string; base?: string }): { content: string } {
  const base = input.base ?? 'https://example.com/a';
  const { document } = parseHTML(input.page);
  const page = document.documentElement as unknown as Element;
  resolveLazyImages(page);
  keepCodeControlsAsText(page);
  stripBoilerplate(page);
  joinSplitBody(page);
  const root = parseFragment(input.result);
  const pass: Pass = {
    article: { title: input.title ?? '', content: input.result, excerpt: '', byline: '', siteName: '', length: (root.textContent || '').length },
    textContent: root.textContent || '',
    frame: frameOf(document, base),
  };
  return { content: withoutLoss(pass, parseFragment, base).content };
}

/** `withoutRepeats` sur un HTML donné (tests de ses règles) : le HTML rendu, inchangé si rien n'est répété. */
export function withoutRepeatsForTests(html: string, base = 'https://example.com/a', stats?: RepeatStats): string {
  const root = parseFragment(html);
  return withoutRepeats(root, base, stats) ? root.innerHTML : html;
}

/** Le corps d'un document neuf qui porte `html` — pour relire un résultat. */
function parseFragment(html: string): Element {
  const { document } = parseHTML(`<!doctype html><html><head></head><body>${html}</body></html>`);
  return document.body as unknown as Element;
}

/**
 * Une passe d'extraction, et ce qu'elle a mesuré de la page avant Readability :
 * le conteneur de l'article (`frameOf`), pour la garde de non-perte.
 */
interface Pass { article: ExtractedArticle; textContent: string; frame: Frame | null }

interface PassOptions {
  /** Vérifier les bornes de l'arbre (M-01). */
  bound?: boolean;
  /** Mesurer le conteneur de l'article (`frameOf`), avant Readability. */
  frame?: boolean;
}

function extractWith(url: string, html: string, options: PassOptions): Pass | null {
  const load = () => {
    const { document } = parseHTML(html);
    // Rien à lire sans élément ; et Readability veut un document entier (C-03).
    if (!wholeDocument(document)) return null;
    // Une URL relative dans la page ne veut rien dire pour le navigateur, qui
    // reçoit le HTML sans savoir d'où il vient. `<base>` les résout ici.
    const base = document.createElement('base');
    base.setAttribute('href', url);
    document.head.prepend(base);
    // Images et médias paresseux, boutons d'agrandissement, avant toute passe (A1).
    resolveLazyImages(document.documentElement as unknown as Element);
    // Les contrôles posés dans du code deviennent texte (REG-219).
    keepCodeControlsAsText(document.documentElement as unknown as Element);
    return document;
  };
  // Les blocs étrangers à l'article sortent avant toute passe (M-04).
  const clean = (doc: ParsedDocument) => {
    // `documentElement` et pas `body` : linkedom produit parfois DEUX `<body>`
    // (The Verge), et `document.body` désigne alors le premier, vide.
    if (doc.documentElement) {
      stripBoilerplate(doc.documentElement as unknown as Element);
      // Après le nettoyage : un bloc retiré ne compte plus dans un groupe.
      joinSplitBody(doc.documentElement as unknown as Element);
    }
    return doc;
  };

  const document = load();
  if (!document) return null;
  if (options.bound) assertTreeBounded(document);
  clean(document);
  // Mesurés AVANT Readability, qui modifie le document qu'il lit.
  const mainLength = mainContainerTextLength(document);
  const frame = options.frame ? frameOf(document, url) : null;
  const parsed = new Readability(document as never, { charThreshold: READABILITY_CHAR_THRESHOLD }).parse();
  if (!parsed?.content) return null;

  let content = parsed.content;
  let length = parsed.length || 0;
  let textContent = parsed.textContent || '';
  // Une liste n'est pas un article (A4-02) : si Readability n'a gardé qu'elle,
  // l'article est relu sans elle, puis elle y est remise à sa place.
  const list = onlyAList(content);
  if (list) {
    const retry = clean(load()!);
    const around = keepOnlyMainContainer(retry) ? aroundTheList(retry, list) : null;
    if (around) ({ content, length, textContent } = around);
  }
  if (mainLength != null && keptTooLittle(textContent, mainLength)) {
    const retry = clean(load()!);
    if (keepOnlyMainContainer(retry)) {
      const again = new Readability(retry as never, MAIN_CONTAINER_OPTIONS).parse();
      if (again?.content && recoveredMore(again.textContent || '', textContent)) {
        content = again.content;
        length = again.length || 0;
        textContent = again.textContent || '';
      }
    }
  }

  // Les voiles de consentement sortent ici, après toutes les passes (V2-02).
  const unveiled = withoutVeils({ content, length, textContent });
  return {
    article: {
      title: parsed.title || '',
      content: unveiled.content,
      excerpt: parsed.excerpt || '',
      byline: parsed.byline || '',
      siteName: parsed.siteName || '',
      length: unveiled.length,
    },
    textContent: unveiled.textContent ?? textContent,
    frame,
  };
}

// ── Garde de non-perte : la page vérifie Readability (1.9.0, REG-229) ─
// Readability CHOISIT un bloc et le nettoie ; on ne lui fait plus confiance
// pour ne rien laisser. Le nettoyage (M-04) et la réunion du corps réparti
// changent le bloc qu'il choisit, et le texte voisin du bloc choisi sort ; et
// Readability lui-même se trompe de bloc : chapeau et image d'en-tête de The
// Verge, d'Ars Technica et du blog de Google (REG-220), chapeau que la page
// certifie (REG-230), corps entier du blog de Docker, où il retenait les
// cartes « articles liés » (REG-229), suite d'un dossier de Clubic (REG-231).
//
// La garde compare son résultat au CONTENEUR que la page désigne elle-même
// (`articleContainer` : un `[itemprop=articleBody]` dominant, sinon un
// `<article>` de premier niveau dominant, sinon un `<main>` ou un
// `[role=main]` unique — aucun sur une page de liste), lu avant Readability
// dans la page NETTOYÉE ; remonté jusqu'au `<h1>` qui porte le titre de la
// page s'il grossit peu (`withItsTitle`), sans ce qui suit le conteneur dans
// l'ancêtre. Ce conteneur est découpé en blocs (paragraphe, intertitre,
// liste, citation, tableau, figure, média). Un bloc est LU quand le résultat porte chacune de
// ses phrases suivies (25 caractères, 8 dans une écriture sans espaces — la
// règle du corpus) et chacune de ses images (à la taille près,
// `imageIdentity`), et ses entrées courtes aussi ; un texte court se lit en
// mots entiers (« écran » n'est pas lu dans « écrans »), mais deux `<span>`
// collés sont deux textes. Les blocs non lus sont REMIS à leur place, sans
// rien retirer au résultat, dans cinq cas :
// 1. PREUVE : le bloc porte une phrase que la page certifie être l'article —
//    `articleBody` ou `description` d'un objet JSON-LD de type article,
//    `og:description`, `description`, `twitter:description` ;
// 2. EN-TÊTE : il précède le premier bloc lu (chapeau, image d'en-tête et
//    légende ; tout le corps chez Docker, dont les cartes suivent) — avant
//    le titre, seulement dans son habillage (pas un bandeau « tendances ») ;
// 3. TROU : il est entre le premier et le dernier bloc lu (un corps coupé par
//    une publicité, ou réparti en blocs que Readability n'a pas tous pris) ;
// 4. SUITE : il suit le dernier bloc lu avec le MÊME GABARIT que l'un des
//    trois derniers — même parent, ou un parent de même balise et de même
//    classe non vide (la suite d'un dossier de Clubic, en `div.slate-content`
//    cousins) —, et n'est pas dans une carte ;
// 5. RÉSULTAT COURT : le résultat est sous le seuil de Readability (rendu
//    « au plus long » faute de mieux, L-04) — tout ce qui le suit dans le
//    conteneur (REG-221 : les paliers d'une page courte).
// Les bornes du corps lu sont les blocs du conteneur où se SITUE un bloc du
// résultat (`locate`), d'au moins 25 caractères, ni `<h1>` ni texte du
// titre, ni faits de liens, ni dans une carte (sauf s'il n'a que cela :
// Docker). Un bloc fait à plus de moitié de liens (vitrine « Voici le X à
// Y € », liste « liés », fil d'Ariane) n'est remis que sur PREUVE — sauf une
// liste du corps dont chaque entrée porte du texte hors lien (les offres
// d'un bon plan : « … au lieu de 149 € »).
//
// Jamais remis, preuve ou pas : un bloc hors du conteneur (lien d'évitement,
// colonne voisine) ; ce que le nettoyage retire (lettre, « Related », pied) ;
// un voile de consentement (V2-02) ; ce que la page masque (`hiddenOnPage` :
// `hidden`, `aria-hidden`, style en ligne, classe de masquage que rien ne
// re-montre à une taille d'écran — REG-225) ; la signature de l'auteur
// (`BYLINE_SIGNALS`, REG-223) ; les commentaires (`isComments`) ; ce que la
// page soustrait aux extraits des moteurs (`[data-nosnippet]`) ; un panneau
// de réglages (`controlPanels`) ; un contrôle ou son libellé ; un cadre
// intégré qui n'est pas une vidéo ; un bloc que le résultat lit déjà, ni le
// titre (affiché à part, son `<h1>` même quand `<title>` le coupe). Un
// paragraphe dont le résultat lit au moins la moitié des phrases, et le
// début et la fin des autres dans un même de ses blocs, n'est pas remis : Readability l'a retouché
// (un appel de note retiré), il ne l'a pas perdu.
//
// Ce qui est remis : une copie du bloc de la page, nettoyée comme Readability
// nettoie (`remittable` : scripts, contrôles, repli des médias, classes et
// styles retirés, adresses rendues absolues, image paresseuse résolue), sans
// ce que le résultat lit déjà (une légende, une entrée de liste : pas de
// doublon), à sa place dans l'ordre de la page — avant le premier bloc du
// résultat qui le suit dans le conteneur, sinon après le dernier qui le
// précède. Une seule copie de ce qui se répète (un chapeau écrit pour deux
// mises en page) : un bloc remis compte aussitôt comme lu. Le résultat n'est
// jamais remplacé.
//
// Elle remplace la garde du témoin (REG-220 à REG-224 : relire la page
// intacte comme en 1.8.0, puis remettre ce que ce témoin gardait avant le
// corps), dont elle fait un sur-ensemble sans passe Readability de plus.
//
// Coût : aucune passe Readability de plus. Une copie du conteneur, faite
// avant que Readability ne modifie le document, et des recherches de texte
// indexées (`KeptText`) et bornées (`Scan` : 32 fois le texte du conteneur et
// du résultat, plus 8 millions de caractères) ; budget épuisé, la garde
// s'abstient EN ENTIER. Un bloc court n'est cherché que s'il est candidat.
// Le texte du résultat est fait de morceaux — le résultat, puis chaque bloc
// remis —, jamais recollés (REG-234 : mille blocs remis faisaient relire mille
// fois un texte qui grossissait).
//
// Même garde dans le repli du navigateur (`src/utils/extractContent.ts`) ;
// toute modification de l'une va avec l'autre, et avec `EXTRACT_VERSION`.

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
function articleContainer(doc: ParsedDocument): Element | null {
  const root = doc.documentElement as unknown as Element | null;
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
function withItsTitle(doc: ParsedDocument, container: Element): Element {
  const own = () => container.cloneNode(true) as Element;
  const memo = new Map<Element, boolean>();
  // Le titre que la page se donne (`og:title`, sinon `<title>`) : seul un
  // `<h1>` qui le porte est celui de l'article — pas le logo du site (RC-08).
  const named = ((doc.querySelector('meta[property="og:title"]') as unknown as Element | null)?.getAttribute('content') || doc.title || '');
  const pageTitle = ` ${normalized(named)} `;
  const titles = (Array.from(doc.querySelectorAll('h1')) as unknown as Element[])
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
function frameOf(doc: ParsedDocument, base: string): Frame | null {
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
function evidenceOf(doc: ParsedDocument): string[] {
  const texts: string[] = [];
  for (const script of Array.from(doc.querySelectorAll('script')) as unknown as Element[]) {
    if ((script.getAttribute('type') || '').trim().toLowerCase() !== 'application/ld+json') continue;
    const raw = (script.textContent || '').trim().replace(/^<!\[CDATA\[|\]\]>$/g, '');
    if (!raw || raw.length > EVIDENCE_MAX) continue;
    try { ldTexts(JSON.parse(raw), texts); } catch { /* un JSON-LD illisible ne prouve rien */ }
  }
  for (const meta of Array.from(doc.querySelectorAll('meta')) as unknown as Element[]) {
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
function withoutLoss(pass: Pass, parse: (html: string) => Element, base: string): ExtractedArticle {
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
// Même règle dans le repli du navigateur (`src/utils/extractContent.ts`) ;
// toute modification de l'une va avec l'autre, et avec `EXTRACT_VERSION`.

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

/** Copie de `src/lib/imageIdentity.ts`, qui dit les règles : la même photo à la taille près. */
const SIZE_SUFFIX = /-\d{2,5}x\d{2,5}(?=\.[a-z0-9]+$)/i;
const SIZE_PARAMS = new Set(['w', 'h', 'width', 'height', 'resize', 'fit', 'quality', 'q', 'dpr']);
const SIGNATURES = new Set(['key', 'sig', 'signature']);

export function imageIdentity(address: string | null | undefined, base?: string): string | null {
  const raw = (address || '').trim();
  if (!raw || /^data:/i.test(raw)) return null;
  let url: URL;
  try { url = base ? new URL(raw, base) : new URL(raw); } catch { return null; }
  const params = [...url.searchParams];
  const sized = params.some(([key]) => SIZE_PARAMS.has(key.toLowerCase()));
  const kept = params.filter(([key]) => !SIZE_PARAMS.has(key.toLowerCase()) && !(sized && SIGNATURES.has(key.toLowerCase())));
  const query = kept.length ? `?${new URLSearchParams(kept).toString()}` : '';
  return `${url.host.toLowerCase()}${url.pathname.replace(SIZE_SUFFIX, '')}${query}`;
}

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

// ── Conteneur principal explicite (A-1) ──────────────────────────────
// Readability choisit UN candidat, puis lui adjoint ses frères assez bien
// notés. Sur un avis du CERT-FR, l'`<article>` est fait de trois `<section>` :
// la première (un tableau de métadonnées) gagne, la deuxième (le corps, en
// listes courtes suivies d'une longue liste de références en liens) est
// écartée pour sa densité de liens. Le fragment dépasse 500 caractères, donc le
// seuil (L-04) ne le rattrape pas : 545 caractères rendus sur 2 454.
//
// Règle générale, pas propre au CERT-FR : quand la page désigne elle-même son
// contenu — un `<article>` unique, sinon un `[role=main]` ou un `<main>`
// unique — et que Readability en garde moins de la moitié du texte, une seconde
// passe est faite sur CE conteneur seul, en tolérant davantage de liens. Elle
// ne ramasse rien hors du conteneur, et n'est retenue que si elle rend
// nettement plus de texte (voir plus bas). ⚠️ Le conteneur n'est pas que l'article : pied, rail, formulaire et
// blocs « Related » y vivent souvent — d'où le nettoyage qui précède toute
// passe (M-04, plus bas). Le titre, l'auteur et le chapeau restent
// ceux de la passe normale, qui voit toute la page.
//
// ⚠️ La part de moitié ne prouve pas qu'il manque quelque chose : le conteneur
// porte souvent bien plus que le corps. Sur Numerama, l'`<article>` réunit
// en-tête, résumé, barre latérale, pied et scripts (dont `textContent` compte
// le texte) ; la première passe y a déjà tout l'article et n'en garde pourtant
// que 36 à 49 %. La seconde passe se déclenche, et sa tolérance de liens
// réadmet ce que la première écartait à raison : un encart produit, des
// lignes promotionnelles faites d'un lien (N-1, vérification 1.9.0). Elle
// n'est donc retenue que si elle rend NETTEMENT plus de texte
// (`MAIN_CONTAINER_MIN_GAIN`) — ce qu'elle fait quand elle retrouve un corps
// écarté (CERT-FR : 3,1 et 3,7 fois plus), pas quand elle ne fait que
// réadmettre quelques blocs de liens (Numerama : 1,03 à 1,04).
//
// Même règle dans le repli du navigateur (`src/utils/extractContent.ts`) ;
// toute modification de l'une va avec l'autre, et avec `EXTRACT_VERSION`.

/** Sous cette part du texte du conteneur, le résultat est jugé fragmentaire. */
export const MAIN_CONTAINER_MIN_SHARE = 0.5;

/**
 * Tolérance de liens de la seconde passe. Readability écarte un bloc dont la
 * densité de liens dépasse 0,2 (0,5 s'il est bien noté) ; le modificateur
 * s'y ajoute. 0,2 suffisait sur les trois avis relevés, 0,5 laisse de la marge
 * pour une liste de références — tolérable parce que la passe est confinée au
 * conteneur que la page désigne.
 */
export const MAIN_CONTAINER_LINK_DENSITY_MODIFIER = 0.5;

/**
 * Gain minimal pour retenir la seconde passe : son texte doit valoir au moins
 * 1,5 fois celui de la première. Mesuré sur les 79 pages des corpus de la
 * campagne (2026-11-06) : la seconde passe ne se déclenche que sur 18 d’entre
 * elles ; le CERT-FR y gagne ×3,1 et ×3,7 (le corps retrouvé), Numerama ×1,03 à
 * ×1,04 (des blocs de liens réadmis), toutes les autres ×1,00. Le seuil laisse
 * une large marge des deux côtés.
 */
export const MAIN_CONTAINER_MIN_GAIN = 1.5;

// `linkDensityModifier` existe dans Readability 0.6.0 (constructeur) mais pas
// dans ses déclarations de types : un objet non littéral échappe au contrôle
// des propriétés en trop.
const MAIN_CONTAINER_OPTIONS = {
  charThreshold: READABILITY_CHAR_THRESHOLD,
  linkDensityModifier: MAIN_CONTAINER_LINK_DENSITY_MODIFIER,
};

const normalizedLength = (text: string) => text.replace(/\s+/g, ' ').trim().length;

function findMainContainer(doc: ParsedDocument): Element | null {
  for (const selector of ['article', '[role="main"]', 'main']) {
    const found = doc.querySelectorAll(selector);
    if (found.length === 1) return found[0] as Element;
    // Plusieurs `<article>` : une page de liste, pas un article. On ne
    // descend pas aux sélecteurs suivants pour autant — un `<main>` qui
    // contient dix articles n'en désigne aucun.
    if (found.length > 1 && selector === 'article') return null;
  }
  return null;
}

function mainContainerTextLength(doc: ParsedDocument): number | null {
  const container = findMainContainer(doc);
  if (!container) return null;
  const length = normalizedLength(container.textContent || '');
  return length >= READABILITY_CHAR_THRESHOLD ? length : null;
}

function keptTooLittle(kept: string, mainLength: number): boolean {
  return normalizedLength(kept) < mainLength * MAIN_CONTAINER_MIN_SHARE;
}

/** La seconde passe a-t-elle retrouvé un corps, et pas seulement quelques blocs ? */
function recoveredMore(second: string, first: string): boolean {
  return normalizedLength(second) >= normalizedLength(first) * MAIN_CONTAINER_MIN_GAIN;
}

/** Vide `<body>` de tout sauf le conteneur principal. `false` s'il n'y en a pas. */
function keepOnlyMainContainer(doc: ParsedDocument): boolean {
  const container = findMainContainer(doc);
  if (!container || !doc.body) return false;
  doc.body.replaceChildren(container);
  return true;
}

// ── Une liste n'est pas un article (A4-02, quatrième round) ──────────
// Un gros avis du CERT-FR (SUSE, Ubuntu, IBM) porte des centaines de
// références, chacune un `<li>` qui contient un `<p>` : chaque paragraphe
// nourrit le score de sa liste, qui l'emporte de loin sur tout le reste (499
// contre 176 pour la colonne qui la contient). Readability ne rendait qu'elle
// — 100 000 caractères de références —, et Risques, Systèmes affectés,
// Résumé, Solutions et la gestion du document disparaissaient. La seconde
// passe (A-1) ne voyait rien : la liste fait 94 % du texte de l'`<article>`.
// Défaut présent depuis la 1.8.0.
//
// Règle générale : quand le résultat n'est qu'une liste (au moins
// `ONLY_A_LIST_SHARE` de son texte, `ONLY_A_LIST_MIN_ITEMS` entrées), la page
// est relue avec, à la place de cette liste, un paragraphe repère. Si
// Readability garde ce repère, la liste y est remise, à sa place ; sinon le
// premier résultat reste. Rien n'est donc jamais perdu : le résultat contient
// toujours la liste entière.
//
// Même règle dans le repli du navigateur (`src/utils/extractContent.ts`).

/** Part du texte du résultat au-delà de laquelle il n'est qu'une liste. */
const ONLY_A_LIST_SHARE = 0.9;
/** Une liste plus courte n'écrase le score de rien. */
const ONLY_A_LIST_MIN_ITEMS = 10;

/** La liste qui fait tout le résultat de Readability : son HTML, son texte, sa première entrée. */
interface OnlyList { html: string; text: string; first: string; items: number }

const squeezed = (text: string | null) => (text || '').replace(/\s+/g, '');

function onlyAList(content: string): OnlyList | null {
  const { document } = parseHTML(`<!doctype html><html><head></head><body>${content}</body></html>`);
  const total = normalizedLength(document.body.textContent || '');
  let best: Element | null = null;
  let bestLength = 0;
  for (const list of Array.from(document.body.querySelectorAll('ul, ol')) as Element[]) {
    const length = normalizedLength(list.textContent || '');
    if (length > bestLength) { best = list; bestLength = length; }
  }
  if (!best || !total || bestLength < total * ONLY_A_LIST_SHARE) return null;
  const items = Array.from(best.children).filter((child) => child.tagName === 'LI');
  if (items.length < ONLY_A_LIST_MIN_ITEMS) return null;
  return { html: best.outerHTML, text: best.textContent || '', first: squeezed(items[0].textContent), items: items.length };
}

/** Relit `doc` sans la liste, puis l'y remet : le nouveau résultat, ou `null`. */
export function aroundTheList(doc: ParsedDocument, list: OnlyList): { content: string; length: number; textContent: string } | null {
  const source = (Array.from(doc.querySelectorAll('ul, ol')) as unknown as Element[]).find((candidate) => {
    const items = Array.from(candidate.children).filter((child) => child.tagName === 'LI');
    return items.length >= list.items && squeezed(items[0].textContent) === list.first;
  });
  if (!source) return null;
  const token = `frirss-list-${Math.random().toString(36).slice(2)}`;
  const marker = doc.createElement('p');
  marker.textContent = token;
  source.replaceWith(marker as unknown as Element);
  const again = new Readability(doc as never, { charThreshold: READABILITY_CHAR_THRESHOLD }).parse();
  const placed = new RegExp(`<p[^>]*>\\s*${token}\\s*</p>`);
  if (!again?.content || !placed.test(again.content)) return null;
  // Une fonction, pas une chaîne : `$'`, `$&`… d'une liste ne sont pas des motifs (RX-05).
  const textContent = (again.textContent || '').replace(token, () => list.text);
  return {
    content: again.content.replace(placed, () => list.html),
    length: (again.length || 0) - token.length + list.text.length,
    textContent,
  };
}

// ── Images paresseuses (A1) ──────────────────────────────────────────
// Beaucoup de pages ne chargent leurs images qu'au défilement, par script :
// l'`<img>` porte un cadre vide (pas de `src`, ou un `data:` non base64 —
// Numerama : `data:image/svg+xml;utf8,<svg width height/>`) et la vraie
// adresse dans `data-src` / `data-srcset`, parfois dans une `<picture>` dont la
// `<source>` porte elle aussi `data-srcset`, avec l'image réelle dans un
// `<noscript>` qui suit. Readability ne résout que le `data:` base64 et le
// `<noscript>` qui suit une image SEULE (pas une `<picture>` à deux enfants),
// et le client retire ensuite tous les attributs `data-*`
// (`ALLOW_DATA_ATTR: false`) : l'article perdait ses images derrière des
// cadres blancs. Zoomit enveloppe chaque image dans un `<button>`
// d'agrandissement, que Readability retire avec ce qu'il contient.
//
// Résolu ici, avant toute passe :
// - une image sans adresse réelle (aucun `src`, ou un `data:` non base64)
//   prend `data-src` et `data-srcset` quand ce sont des adresses web ;
// - sinon, le `<noscript>` qui la suit (elle ou sa `<picture>`) et ne porte
//   qu'une image la remplace ;
// - une `<source>` sans `srcset` prend son `data-srcset` ;
// - un `<button>` d'agrandissement sans texte qui n'enveloppe qu'une image
//   (pas une icône) est déballé (`isZoomButton`, plus bas) ;
// - et les MÉDIAS (REG-240 à REG-243, `resolveLazyMedia` plus bas) : une
//   `<picture>` sans `<img>` prend celle de son `<noscript>`, un aperçu flou
//   prend la plus grande variante de son `data-srcset`, une vidéo intégrée
//   derrière un voile de consentement prend son `data-src`, un élément
//   personnalisé qui porte une vidéo ou une citation dans ses attributs les
//   montre.
// Un `data:` base64 est une vraie image en ligne : Readability juge lui-même
// les plus petites (ses « pixels » de remplacement) et n'est pas devancé ici.
//
// Même règle dans le repli du navigateur (`src/utils/extractContent.ts`).

/** Pas d'adresse réelle : absente, vide, ou un `data:` non base64 (un cadre). */
function isPlaceholderSource(value: string | null): boolean {
  if (!value || !value.trim()) return true;
  return /^\s*data:/i.test(value) && !/^\s*data:[^,]*;base64,/i.test(value);
}

/** Une adresse web (absolue, ou relative à la page) — rien d'autre n'est repris. */
function webAddress(value: string | null): string | null {
  // Le navigateur ôte les tabulations et retours de ligne d'une adresse avant
  // d'en lire le schéma : `java&#9;script:` est `javascript:` (RC-09).
  const v = value?.replace(/[\t\n\r]/g, '').trim();
  if (!v) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(v)?.[1].toLowerCase();
  return !scheme || scheme === 'http' || scheme === 'https' ? v : null;
}

/** L'unique image d'un élément sans texte, ou `null`. */
function onlyImage(el: Element): Element | null {
  if ((el.textContent || '').trim()) return null;
  const images = el.querySelectorAll('img');
  return images.length === 1 ? images[0] as Element : null;
}

/** Résout, sous `root`, les images paresseuses et les boutons d'agrandissement (A1). */
export function resolveLazyImages(root: Element): void {
  for (const img of Array.from(root.querySelectorAll('img')) as Element[]) {
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
  for (const source of Array.from(root.querySelectorAll('source[data-srcset]')) as Element[]) {
    const srcset = webAddress(source.getAttribute('data-srcset'));
    if (srcset && isPlaceholderSource(source.getAttribute('srcset'))) source.setAttribute('srcset', srcset);
  }
  // Une vidéo paresseuse (REG-233) : sa `<source>` (ou elle-même) ne porte
  // l'adresse que dans `data-src`, son affiche dans `data-poster`.
  for (const media of Array.from(root.querySelectorAll('video[data-src], audio[data-src], source[data-src]')) as Element[]) {
    const src = webAddress(media.getAttribute('data-src'));
    if (src && isPlaceholderSource(media.getAttribute('src'))) media.setAttribute('src', src);
  }
  for (const video of Array.from(root.querySelectorAll('video[data-poster]')) as Element[]) {
    const poster = webAddress(video.getAttribute('data-poster'));
    if (poster && isPlaceholderSource(video.getAttribute('poster'))) video.setAttribute('poster', poster);
  }
  for (const button of Array.from(root.querySelectorAll('button')) as Element[]) {
    if (isZoomButton(button)) button.replaceWith(takeChildren(button));
  }
  resolveLazyMedia(root);
}

// ── Médias de l'article (1.9.0, REG-240 à REG-243) ─────────────────────
// Mesurés par `scripts/corpus/media.ts` sur l'image a90032f : ces médias
// étaient dans le conteneur de l'article, et ni Readability ni la garde ne
// pouvaient les voir.
// - Une `<picture>` paresseuse SANS `<img>` (Clubic : `<picture data-lazy>`,
//   un cercle de chargement, et l'image réelle seulement dans un `<noscript>`
//   enfant) : l'image du `<noscript>` prend sa place dans la `<picture>`. Les
//   photos d'un dossier ne laissaient que leurs légendes (REG-240).
// - Un aperçu flou (`src` en `width-200` et la photo dans `data-srcset`,
//   blog de Google) : l'image prend le `srcset` et sa plus grande variante
//   jusqu'à `PREVIEW_MAX_WIDTH` pour `src` — le volet retire les `data-*`,
//   l'en-tête restait floue (REG-243).
// - Une vidéo intégrée derrière un voile de consentement (Numerama :
//   `<iframe data-src="…youtube.com/embed/…">` sans `src`) prend son
//   `data-src`, une vidéo chargée au clic (WP Rocket, Journal du Geek)
//   l'iframe de son `<noscript>` — seulement une vidéo (`VIDEO_FRAME`) : une
//   publicité reste sans adresse, et le lecteur la retire (REG-241).
// - Un élément personnalisé (une balise à tiret) qui porte une vidéo dans un
//   attribut (`or-mp4-video-url` du blog de Google) reçoit une `<video>` à
//   contrôles, avec l'affiche qu'il porte ; une citation (`quote`, et
//   `author-name` / `author-title`), une `<blockquote>`. Le texte est posé
//   en texte, jamais en HTML. Une vidéo de fond (lecture automatique en
//   boucle sans contrôles) n'est jamais montée (REG-242).

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

/** Un ancêtre à tiret porte-t-il la même valeur dans un attribut (éléments imbriqués qui se la passent, RM-04) ? */
function carriedAbove(el: Element, value: string): boolean {
  const wanted = value.trim();
  for (let up = el.parentElement; up; up = up.parentElement) {
    if (!up.tagName.includes('-')) continue;
    if (Array.from(up.attributes).some((attr) => attr.value.trim() === wanted || webAddress(attr.value) === wanted)) return true;
  }
  return false;
}

/** Les identités (à la taille près) des adresses d'une image, `data-*` compris. */
function lazyIdentities(img: Element): string[] {
  const out: string[] = [];
  const values = [img.getAttribute('src'), img.getAttribute('data-src'), ...srcsetAddresses(img.getAttribute('srcset')), ...srcsetAddresses(img.getAttribute('data-srcset'))];
  for (const value of values) {
    const address = webAddress(value);
    const id = address ? imageIdentity(address, 'https://frirss.invalid/') : null;
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

export function resolveLazyMedia(root: Element): void {
  const doc = root.ownerDocument!;
  // Une `<picture>` sans `<img>` : celle de son `<noscript>` — sauf si une
  // image voisine (même parent) montre déjà la même photo, à la taille près
  // (RM-05 : une `<img data-src>` sœur, lazysizes). Les photos voisines sont
  // relevées une fois par parent.
  const shownNear = new Map<Element, Set<string>>();
  const near = (parent: Element) => {
    let known = shownNear.get(parent);
    if (!known) {
      known = new Set<string>();
      for (const img of Array.from(parent.querySelectorAll('img')) as Element[]) {
        if (!img.closest('noscript')) for (const id of lazyIdentities(img)) known.add(id);
      }
      shownNear.set(parent, known);
    }
    return known;
  };
  for (const picture of Array.from(root.querySelectorAll('picture')) as Element[]) {
    if ((Array.from(picture.querySelectorAll('img')) as Element[]).some((img) => !img.closest('noscript'))) continue;
    const noscript = Array.from(picture.children).find((child) => child.tagName.toLowerCase() === 'noscript') as Element | undefined;
    const real = noscript ? onlyImage(noscript) : null;
    if (!real || !webAddress(real.getAttribute('src'))) continue;
    const ids = lazyIdentities(real);
    const around = picture.parentElement ? near(picture.parentElement) : new Set<string>();
    if (ids.some((id) => around.has(id))) continue;
    noscript!.replaceWith(real);
    for (const id of ids) around.add(id);
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
  // « Rien à côté » est relevé une fois par parent (RM-02 : relire le parent
  // pour chacun de 15 000 `<noscript>` dépassait le délai du worker).
  const showsFrame = new Map<Element, boolean>();
  for (const noscript of Array.from(root.querySelectorAll('noscript')) as Element[]) {
    const frames = Array.from(noscript.querySelectorAll('iframe')) as Element[];
    if (frames.length !== 1 || noscript.children.length !== 1 || (noscript.textContent || '').trim()) continue;
    const src = webAddress(frames[0].getAttribute('src'));
    const parent = noscript.parentElement;
    if (!src || !VIDEO_FRAME.test(src) || !parent) continue;
    let shown = showsFrame.get(parent);
    if (shown === undefined) showsFrame.set(parent, shown = (Array.from(parent.querySelectorAll('iframe')) as Element[]).some((frame) => !frame.closest('noscript')));
    if (shown) continue;
    noscript.replaceWith(frames[0]);
    showsFrame.set(parent, true);
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
    if (video && !isDecorativeVideo(el) && !el.querySelector('video') && !carriedAbove(el, video)) {
      const player = doc.createElement('video');
      player.setAttribute('controls', '');
      player.setAttribute('preload', 'metadata');
      player.setAttribute('src', video);
      if (poster) player.setAttribute('poster', poster);
      el.insertBefore(player, el.firstChild);
    }
    const quote = (el.getAttribute('quote') || '').replace(/\s+/g, ' ').trim();
    // Ni deux fois (un parent à tiret la porte aussi), ni sur un texte que
    // l'élément montre déjà (RM-04).
    if (quote.length >= QUOTE_ATTR_MIN && !el.querySelector('blockquote') && !carriedAbove(el, el.getAttribute('quote') || '')
      && !normalized(el.textContent || '').includes(normalized(quote))) {
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
 * Les enfants de `node`, dans l'ordre, déplacés un à un dans un fragment.
 * Jamais en arguments (`append(...nœuds)`, `replaceWith(...nœuds)`) :
 * quelques centaines de milliers de nœuds dépassent la pile (RW-03, comme
 * RZ-06).
 */
function takeChildren(node: Node): DocumentFragment {
  const fragment = node.ownerDocument!.createDocumentFragment();
  while (node.firstChild) fragment.appendChild(node.firstChild);
  return fragment;
}

// Seuls les boutons d'AGRANDISSEMENT sont déballés (relecture du troisième
// round) : déballer tout bouton à image unique faisait entrer dans l'article
// les icônes de « Copier » ou les flèches d'un carrousel. Un bouton
// d'agrandissement se reconnaît à un indice dans son libellé, sa classe ou son
// titre (`ZOOM_HINT`, dans les langues de FriRSS et celle de Zoomit), ou à un
// libellé qui reprend le texte de remplacement de son image (« Agrandir
// l'image : <alt> », la forme de Zoomit). Son image n'est jamais une icône :
// ni `.svg`, ni de taille déclarée sous `ICON_MAX_SIZE`.

/** Agrandir, en anglais, français, allemand, néerlandais, espagnol, portugais, italien, polonais, ukrainien, chinois, persan. */
const ZOOM_HINT = /zoom|lightbox|enlarge|expand|fullscreen|full-screen|agrandi|plein écran|vergr[öo]ß|vergroot|ampliar|ingrand|powi[eę]ksz|збільш|放大|بزرگ/i;
/** Une image déclarée plus petite que ceci (largeur ou hauteur) est une icône. */
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
// Readability retire tout `button`, `select`, `textarea` et `input` de
// l'article, avec ce qu'ils contiennent. Dans du code, ce sont des morceaux du
// code : Twoslash (Shiki) enveloppe un identifiant dans un
// `<button class="twoslash-hover">` qui porte son infobulle de type — sur le
// blog de Node.js, `new Intl.Locale(…)` devenait `new Intl.(…)` dès la 1.8.0.
// Un tel contrôle est remplacé par son texte, avant toute passe :
// - `button`, `textarea` : leur texte ;
// - `select` : le texte de l'option choisie, sinon de la première ;
// - `input` : sa valeur.
// Un contrôle sans texte (une icône) reste, et Readability le retire comme
// avant. « Dans du code » : dans un `<code>`, ou dans un `<pre>` qui n'en porte
// aucun. Un bouton posé dans le `<pre>` À CÔTÉ de son `<code>` est la barre
// d'outils du bloc (le « Copy » du greffon de highlight.js) : il n'est pas du
// code, Readability le retire comme avant.
//
// Même règle dans le repli du navigateur (`src/utils/extractContent.ts`).

const CODE_CONTROLS = 'button, select, textarea, input';

/** Le texte que montre un contrôle : son contenu, son option choisie, sa valeur. */
function controlText(control: Element): string {
  const tag = control.tagName.toLowerCase();
  if (tag === 'input') return control.getAttribute('value') || '';
  if (tag === 'select') {
    const option = control.querySelector('option[selected]') || control.querySelector('option');
    return option?.textContent || '';
  }
  return control.textContent || '';
}

/** Le contrôle est-il dans du code : un `<code>`, ou un `<pre>` sans `<code>` ? */
function insideCode(control: Element): boolean {
  if (control.closest('code')) return true;
  const pre = control.closest('pre');
  return !!pre && !pre.querySelector('code');
}

/** Remplace, sous `root`, chaque contrôle posé dans du code par son texte (REG-219). */
export function keepCodeControlsAsText(root: Element): void {
  for (const control of Array.from(root.querySelectorAll(CODE_CONTROLS)) as Element[]) {
    // Un contrôle dans un contrôle déjà remplacé n'est plus dans le document.
    if (!control.isConnected || !insideCode(control)) continue;
    const text = controlText(control);
    if (text) control.replaceWith(control.ownerDocument.createTextNode(text));
  }
}

// ── Blocs étrangers retirés avant toute passe (M-04) ─────────────────
// Sur The Verge, la seconde passe (A-1) ramassait dans le conteneur principal
// les mentions légales du formulaire de lettre d'information (en fin
// d'article) et un bloc « Related » (au milieu du texte) : le `<main>` porte
// aussi le rail, et la tolérance de liens y est relevée à 0,5. Sur Schneier,
// c'est la PREMIÈRE passe : l'article est court (412 caractères), sous le
// seuil de 500 (L-04), donc Readability refait ses passes en écartant moins et
// garde la plus longue — fil d'Ariane, « Comments », « Powered by WordPress »
// compris. Readability écarte bien ces blocs à sa première tentative (classes
// « improbables »), mais les reprend aux suivantes. Retirés du document avant
// toute passe, ils ne reviennent plus (campagne 1.9.0, second round).
//
// Ce qui est retiré, sous la racine donnée (jamais la racine elle-même) :
// - les éléments `footer`, `nav`, `form`, et les rôles `navigation`,
//   `contentinfo` — sauf le sommaire de l'article, une navigation dont chaque
//   lien mène à un titre de la page (REG-222, `isTableOfContents`) ;
// - un `aside` ou un rôle `complementary` HORS d'un `<article>` : la barre
//   latérale d'une page (Schneier). Dans un `<article>`, c'est une incise de
//   l'article — The Verge y range des fenêtres « Follow » au milieu de son
//   chapeau : les retirer changeait le poids du chapeau, et Readability
//   perdait l'image d'en-tête. Readability écarte lui-même ces `aside` du
//   corps, après en avoir pesé le bloc ;
// - un bloc dont la classe ou l'id contient l'un des mots de
//   `BOILERPLATE_TOKENS` (découpés sur tout ce qui n'est pas lettre ou
//   chiffre : `duet--cta--newsletter`, `comment-respond`) — jamais un titre ni
//   un élément de texte (`<h2 id="related-work">` est un titre d'article).
//   Pour `share`, `sharing` et `newsletter` (`SHORT_BLOCK_TOKENS`), seulement
//   si le bloc est court (moins de `READABILITY_CHAR_THRESHOLD` caractères
//   lisibles) : c'est la règle de Readability lui-même pour les blocs
//   « share ». Sans elle, un `<table class="share-table">` (parts de marché)
//   ou une `div.share-of-voice-analysis` sortaient de l'article alors que
//   Readability les gardait (relecture 1.9.0). Boutons de partage et encarts
//   d'abonnement, eux, sont courts. Même règle (troisième round, A3) pour les
//   publicités (`ad`, `ads`, `advert`, `advertisement`, `sponsor`,
//   `sponsored` : `div.google-ad` de The Register et son « REG AD », le
//   bandeau `#sponsored-banner` d'un blog), les mentions d'affiliation et
//   avertissements (`affiliate`, `disclaimer` : TechCrunch, 01net) et
//   l'invitation à installer l'application (`pwa` : Numerama) ;
// - un bloc `newsletter` qui porte un champ de saisie, quelle que soit sa
//   longueur : c'est un formulaire d'abonnement, que sa FAQ allonge au-delà
//   de la règle des blocs courts (Frandroid, A3) — sauf s'il porte la moitié
//   du texte de son billet : c'est alors le corps d'une lettre publiée comme
//   billet, et seul le conteneur du formulaire, en lui, est visé ;
// - un voile de consentement (`consent`) sans citation ni média, un encart
//   dont tous les liens sont payants, un bouton « retour en haut » nommé en
//   entier (A4-03, resserrés en RX-02 à RX-04 : voir leurs constantes) ;
// - les classes de taxonomie (`tag-*`, `category-*`) ne comptent pas : WordPress
//   y range les SUJETS d'un billet, sur son `<article>` (`tag-pwa`,
//   `category-ads`) ; et ni `<article>` ni le conteneur principal (`<main>`,
//   `[role=main]`) ne sont jamais jugés « courts » ni « formulaire » — un
//   billet court entier sortait (relecture du troisième round) ;
// - le texte de repli d'une démo CodePen (`[data-slug-hash]`) quand une
//   légende la suit : le script de CodePen ne tourne jamais dans l'extrait, et
//   le repli répète la légende (Smashing Magazine, A3). Sans légende, le
//   repli reste : c'est le seul lien vers la démo ;
// - hors d'un `<article>`, la colonne `#secondary` (id exact), barre latérale
//   des thèmes WordPress écrite en `div` (Simon Willison, A2) ;
// - un court bloc qui commence par « Powered by ».
// Rien n'est jugé dans un `<pre>` ni dans un `<code>`, ni eux-mêmes (REG-219) :
// c'est du code, et ses noms de classe sont ceux du surligneur — Shiki pose
// `no-footer` sur le `<pre>` d'un exemple sans pied (blog de Node.js : un
// exemple entier perdu), Prism `token comment` sur ses jetons. Un `<pre>` dans
// un bloc retiré pour une autre raison (`<nav>`, `<footer>`, « Related ») sort
// toujours avec lui : seul le bloc de code lui-même est épargné.
// Trois gardes :
// - un bloc qui porte la moitié du texte de la racine ou plus n'est jamais
//   retiré — c'est le corps, quel que soit son nom (une page entière
//   enveloppée dans un `<form>`, un `div.comments-enabled`) ;
// - un bloc qui porte l'auteur non plus (`carriesByline`) : Readability lit
//   l'auteur dans le document AVANT d'écarter lui-même `aside` et `footer`
//   du corps ; le retirer plus tôt effaçait l'auteur (un `footer.entry-meta`
//   de blog, un `aside.author` de Le Monde Informatique hors règle d'article) ;
// - le code, plus haut.
//
// Mesuré sur les 38 pages réelles de la campagne et deux pages Wikipédia
// (2026-11-06) : seules quatre pages changent — Schneier (fil d'Ariane,
// « Comments », crédits) et trois articles de The Verge (lettre
// d'information et mentions légales) ; aucune autre ne perd ni ne gagne un
// caractère, aucune image, aucun auteur ni titre ne bouge, le CERT-FR garde son
// corps complet (A-1).
// Troisième round (A3), sur 126 pages (corpus et pages fraîches des sites
// cités) : 39 pages changent, chacune par le retrait des seuls blocs visés ;
// aucun titre ni auteur ne bouge, aucune image d'article n'est perdue (seules
// les deux icônes de la carte d'installation de Numerama sortent avec elle).

const BOILERPLATE_TAGS = new Set(['footer', 'nav', 'form']);
const BOILERPLATE_ROLES = new Set(['navigation', 'contentinfo']);
const BOILERPLATE_TOKENS = new Set([
  'related', 'comment', 'comments', 'breadcrumb', 'breadcrumbs', 'footer',
]);
/**
 * Le voile de consentement d'un contenu intégré (A4-03 : Numerama) porte le
 * mot `consent` ; il est retiré, quelle que soit sa longueur, s'il n'est pas
 * le billet et ne porte ni citation ni média. Un gestionnaire qui enveloppe
 * l'intégration ET son voile garde la citation du message (RX-03).
 * ⚠️ Retiré APRÈS Readability, pas avant (V2-02) : il est souvent le frère du
 * message intégré, et son long texte presque sans lien est ce qui gardait le
 * conteneur du message sous le seuil de densité de liens de Readability.
 * Retiré avant, le conteneur n'était plus que le message — un texte court fait
 * de liens (mot-dièse, image, date) — et Readability l'écartait, message
 * compris : les deux tweets intégrés d'un article de Numerama disparaissaient.
 * Le voile est donc seulement marqué (`VEIL_ATTR`, sur lui et chacun de ses
 * descendants : Readability remplace parfois un bloc par son seul enfant, sans
 * ses attributs) ; `withoutVeils` le retire du résultat.
 * Son texte nu est enveloppé d'un `<span>` marqué (RW-01) : Readability range
 * le texte d'un `<div>` dans un `<p>` neuf, qui ne porte pas la marque, puis
 * remplace le `<div>` par ce `<p>` — le texte survivait au retrait.
 * La marque est à FriRSS : `stripBoilerplate` efface d'abord celle qu'une page
 * porterait déjà, qui ferait retirer son texte (RW-02).
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
      if (node.nodeType !== 3 || !(node.textContent || '').trim()) continue;
      const span = holder.ownerDocument.createElement('span');
      span.setAttribute(VEIL_ATTR, '');
      holder.insertBefore(span, node);
      span.appendChild(node);
    }
  }
}

/** Le résultat de Readability sans les voiles marqués ; tel quel s'il n'en porte aucun. */
function withoutVeils<T extends { content: string; length: number; textContent?: string }>(result: T): T {
  if (!result.content.includes(VEIL_ATTR)) return result;
  const { document } = parseHTML(`<!doctype html><html><head></head><body>${result.content}</body></html>`);
  for (const veil of Array.from(document.body.querySelectorAll(`[${VEIL_ATTR}]`))) veil.remove();
  const textContent = document.body.textContent || '';
  return { ...result, content: document.body.innerHTML, length: textContent.length, textContent };
}
const EMBEDDED_CONTENT = 'blockquote, img, picture, video, audio, iframe, figure';
/**
 * Le bouton « retour en haut » : un nom ENTIER de classe ou d'id
 * (`go-to-top`, `back-to-top-link`, `scrolltop`, `top`), jamais un
 * morceau découpé — les utilitaires Tailwind `top-px`, `-top-1`, `md:top-0`
 * sont sur des liens d'article (RX-02).
 */
const BACK_TO_TOP_NAME = /^(?:top|(?:back|go|scroll)?-?to-?top|scroll-?top|back-?top)(?:-(?:button|btn|link|anchor|arrow|icon))?$/;
/** Un lien payant : la campagne qui l'a acheté le dit dans son adresse (A4-03). */
const PAID_LINK = /[?&]utm_medium=paid/i;
/** Mots qui ne désignent un bloc étranger que s'il est court (règle « share » de Readability). */
const SHORT_BLOCK_TOKENS = new Set([
  'share', 'sharing', 'newsletter',
  'ad', 'ads', 'advert', 'advertisement', 'sponsor', 'sponsored', 'affiliate', 'disclaimer', 'pwa',
]);
/** Un champ de saisie : un bloc `newsletter` qui en porte un est un formulaire. */
const FORM_CONTROLS = 'input, select, textarea';
/** Jamais jugés sur leur nom : titres et éléments de texte. */
const NAMED_EXEMPT = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'span', 'b', 'i', 'em', 'strong', 'code', 'small', 'sup', 'sub',
  'time', 'abbr', 'label', 'img', 'figcaption',
]);
/** Du code : rien n'y est jugé, ni lui-même (REG-219). */
const CODE = new Set(['pre', 'code']);
const POWERED_BY = /^powered by\b/i;
/** Un crédit est court : au-delà, c'est une phrase d'article. */
const POWERED_BY_MAX_LENGTH = 120;

/** Texte lisible d'un billet, mesuré une fois par nettoyage (voir `stripBoilerplate`). */
type PostLength = (post: Element) => number;

function isBoilerplate(el: Element, insideArticle: boolean, postLength: PostLength, paid: Map<Node, LinkCounts>, headingIds: () => Set<string>, inFlow: (el: Element) => boolean): boolean | typeof VEIL {
  const tag = el.tagName.toLowerCase();
  const role = (el.getAttribute('role') || '').toLowerCase();
  if ((BOILERPLATE_TAGS.has(tag) || BOILERPLATE_ROLES.has(role)) && !isTableOfContents(el, headingIds)) return true;
  if (!insideArticle && (el.getAttribute('id') || '').toLowerCase() === 'secondary') return true;
  if (!insideArticle && (tag === 'aside' || role === 'complementary') && !inFlow(el)) return true;
  if (el.hasAttribute('data-slug-hash') && hasCaptionSibling(el)) return true;
  const tokens = `${withoutTaxonomy(el.getAttribute('class'))} ${el.getAttribute('id') || ''}`.toLowerCase().split(/[^a-z0-9]+/);
  // Le bouton « retour en haut » : un lien vers la page même
  // (A4-03 : tech-wd, dont seul le libellé pour lecteur d'écran se lisait).
  if (tag === 'a' && (el.getAttribute('href') || '').startsWith('#') && isBackToTop(el)) return true;
  if (!NAMED_EXEMPT.has(tag)) {
    if (tokens.some((token) => BOILERPLATE_TOKENS.has(token))) return true;
    // Ni le billet ni le conteneur principal ne sont jugés « courts »,
    // « formulaire » ou « voile » : ce sont eux qu'on extrait.
    if (!isPostContainer(tag, role)) {
      if (tokens.includes(CONSENT_TOKEN) && !el.querySelector(EMBEDDED_CONTENT)) return VEIL;
      if (tokens.includes('newsletter') && el.querySelector(FORM_CONTROLS) && !carriesMostOfItsPost(el, postLength)) return true;
      if (tokens.some((token) => SHORT_BLOCK_TOKENS.has(token))
        && visibleTextLength(el, READABILITY_CHAR_THRESHOLD) < READABILITY_CHAR_THRESHOLD) return true;
      const counts = paid.get(el);
      if (counts && isPaidPromotion(counts) && !carriesMostOfItsPost(el, postLength, counts.text)) return true;
    }
  }
  // Seulement sur un bloc presque feuille : lire `textContent` de chaque
  // élément d'un arbre profond coûterait le carré de sa taille.
  if (el.childElementCount <= 3 && Array.from(el.children).every((child) => child.childElementCount === 0)) {
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length <= POWERED_BY_MAX_LENGTH && POWERED_BY.test(text)) return true;
  }
  return false;
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
  const links = Array.from(el.querySelectorAll('a[href]')) as Element[];
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
      for (const heading of Array.from(root.querySelectorAll(HEADING)) as Element[]) {
        if (heading.id) ids.add(heading.id);
        for (const inner of Array.from(heading.querySelectorAll('[id]')) as Element[]) ids.add(inner.id);
      }
    }
    return ids;
  };
}

/**
 * La classe sans ses termes de taxonomie. `post_class()` de WordPress met
 * les étiquettes et catégories du billet sur son `<article>` (`tag-pwa`,
 * `category-ads`, `tag-sponsored`, `tag-newsletter`) : ce sont les SUJETS du
 * billet, pas la nature du bloc. Lus comme des mots de bloc étranger, ils
 * faisaient sortir un billet court entier (relecture du troisième round).
 */
function withoutTaxonomy(className: string | null): string {
  return (className || '').split(/\s+/).filter((name) => !/^(tag|category)-/i.test(name)).join(' ');
}

/** Une classe ou l'id du lien est-il, en entier, un nom de bouton « retour en haut » (RX-02) ? */
function isBackToTop(el: Element): boolean {
  const names = `${el.getAttribute('class') || ''} ${el.getAttribute('id') || ''}`.toLowerCase().replace(/_/g, '-').split(/\s+/);
  return names.some((name) => BACK_TO_TOP_NAME.test(name));
}

/**
 * Un encart publicitaire (A4-03 : BleepingComputer, `div.article-callout`,
 * nom que portent aussi de vrais encadrés) : un court bloc dont TOUS les liens
 * sont payants (`PAID_LINK`) et dont l'un enveloppe une image — le visuel de
 * la réclame. Un paragraphe d'article qui cite un lien payant n'a pas
 * d'image en lien : il reste. Un bloc qui porte la moitié de son billet non
 * plus (`carriesMostOfItsPost`) : c'est le corps d'un court billet dont la
 * photo mène à un lien payant, que la colonne d'archives emportait.
 */
function isPaidPromotion(counts: LinkCounts): boolean {
  return counts.text < READABILITY_CHAR_THRESHOLD && counts.links === counts.paidLinks && counts.paidImageLinks > 0;
}

/** Sous un élément : texte lisible (comme `visibleTextLength`), liens, liens payants, liens payants sur une image. */
interface LinkCounts { text: number; links: number; paidLinks: number; paidImageLinks: number; image: boolean }

/**
 * Les ancêtres d'un lien payant (seuls candidats à l'encart), chacun avec ses
 * comptes (`LinkCounts`), faits de bas en haut en UNE passe sur `root`.
 * Relire le sous-arbre à chaque ancêtre coûtait sa profondeur fois sa taille
 * (RX-04 : 240 niveaux au-dessus de 55 000 éléments, 1,5 s au lieu de 0,5).
 * Les comptes restent justes au moment du jugement : un ancêtre est jugé avant
 * tout ce qu'il contient, et rien de son sous-arbre n'a encore été retiré.
 */
function paidLinkAncestors(root: Element): Map<Node, LinkCounts> {
  const candidates = new Map<Node, LinkCounts | null>();
  for (const link of Array.from(root.querySelectorAll('a[href*="utm_medium"]')) as Element[]) {
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

/** Le billet lui-même ou le conteneur principal de la page. */
function isPostContainer(tag: string, role: string): boolean {
  return tag === 'article' || tag === 'main' || role === 'main';
}

/**
 * Le bloc porte-t-il la moitié du texte de son billet (ou du conteneur
 * principal) ? Alors c'est le corps — une lettre d'information publiée comme
 * billet, dont le formulaire d'abonnement n'est qu'une partie — et la règle
 * « newsletter + champ » ne vise que le conteneur du formulaire.
 *
 * Le texte du billet n'est PAS relu à chaque bloc (B-02, quatrième round) :
 * 4 000 formulaires au pied d'un billet de 1 Mo coûtaient 11,4 s, chacun
 * relisant le billet entier. `postLength` le mesure une fois ; celui du bloc
 * s'arrête à la moitié du billet, seule question posée — ou vient de
 * `length`, déjà connu pour un encart payant (RX-04).
 *
 * Même garde pour l'encart payant : un court billet dont la seule image mène
 * à un lien payant n'est pas une réclame.
 */
function carriesMostOfItsPost(el: Element, postLength: PostLength, length?: number): boolean {
  const post = el.parentElement?.closest('article, main, [role="main"]');
  if (!post) return false;
  const half = postLength(post) * MAIN_CONTAINER_MIN_SHARE;
  return (length ?? visibleTextLength(el, half)) >= half;
}

/** Un paragraphe frère de cette longueur dit qu'un encadré est dans le fil du texte. */
const TEXT_FLOW_MIN = 80;

/**
 * Un encadré (`<aside>`) DANS le fil du texte : un frère est un paragraphe
 * d'au moins `TEXT_FLOW_MIN` caractères (REG-232). Le blog de GitHub, qui
 * n'a pas d'`<article>`, y range ses définitions et la liste des
 * intervenants ; une colonne de côté, elle, voisine des gabarits.
 */
function inTextFlow(el: Element): boolean {
  for (let sibling = el.parentElement?.firstElementChild; sibling; sibling = sibling.nextElementSibling) {
    if (sibling.tagName.toLowerCase() === 'p' && visibleTextLength(sibling, TEXT_FLOW_MIN) >= TEXT_FLOW_MIN) return true;
  }
  return false;
}

/** Une `<figcaption>` voisine : la légende qui dit déjà ce que dit le repli. */
function hasCaptionSibling(el: Element): boolean {
  for (let sibling = el.parentElement?.firstElementChild; sibling; sibling = sibling.nextElementSibling) {
    if (sibling !== el && sibling.tagName.toLowerCase() === 'figcaption') return true;
  }
  return false;
}

/**
 * Signaux d'auteur, ceux que Readability lit (`_checkByline`) : un bloc qui en
 * porte un n'est pas retiré, même s'il est un `<footer>` ou un `<aside>`.
 * Readability en tire l'auteur, puis écarte lui-même ce bloc du corps.
 */
const BYLINE_SIGNALS = '[rel~="author"], [itemprop*="author"], [class*="byline"], [id*="byline"], [class*="author"], [id*="author"], [class*="dateline"], [class*="writtenby"]';

function carriesByline(el: Element): boolean {
  return el.matches(BYLINE_SIGNALS) || !!el.querySelector(BYLINE_SIGNALS);
}

/** Éléments dont le texte n'est pas lu : le JSON embarqué d'une page (`__NEXT_DATA__`
 *  de The Verge, ~100 Ko) fausserait la garde de la moitié du texte. */
const INVISIBLE = new Set(['script', 'style', 'template', 'noscript']);

/** Longueur du texte lisible de `root`, blancs réduits — sans script ni style.
 *  Arrêtée dès qu'elle atteint `stopAt` : la question est alors « assez court ? ». */
function visibleTextLength(root: Element, stopAt = Infinity): number {
  let length = 0;
  const stack: Node[] = [root];
  while (stack.length && length < stopAt) {
    const node = stack.pop()!;
    if (node.nodeType === 3) {
      length += (node.textContent || '').replace(/\s+/g, ' ').length;
    } else if (node.nodeType === 1 && !INVISIBLE.has((node as Element).tagName.toLowerCase())) {
      for (let child = node.firstChild; child; child = child.nextSibling) stack.push(child);
    }
  }
  return length;
}

/** Retire de `root` (jamais `root` lui-même) les blocs étrangers à l'article. */
export function stripBoilerplate(root: Element): void {
  // La marque du voile est à FriRSS (RW-02).
  root.removeAttribute(VEIL_ATTR);
  for (const el of Array.from(root.querySelectorAll(`[${VEIL_ATTR}]`)) as Element[]) el.removeAttribute(VEIL_ATTR);
  const total = visibleTextLength(root);
  // Texte des billets déjà mesurés (B-02), tenu à jour à chaque retrait :
  // un billet se mesure tel qu'il reste, comme quand chaque bloc le relisait.
  const posts = new Map<Element, number>();
  const postLength: PostLength = (post) => {
    let length = posts.get(post);
    if (length === undefined) posts.set(post, length = visibleTextLength(post));
    return length;
  };
  // Seuls les ancêtres d'un lien payant peuvent être un encart publicitaire
  // (A4-03) : sans cela, chaque élément relirait tous ses liens.
  const paid = paidLinkAncestors(root);
  // Les cibles d'un sommaire (REG-222), relevées au premier `<nav>` rencontré.
  const headingIds = headingIdsUnder(root);
  // Le fil du texte d'un parent, jugé une fois : mille encadrés frères ne relisent pas mille fois leurs voisins.
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
        // Un voile reste jusqu'après Readability (V2-02) : son texte compte
        // encore, comme pour Readability.
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

/**
 * `el`, de texte lisible `length`, va être retiré : les billets mesurés qui le
 * contiennent perdent ce texte — sauf au-dessus d'un élément dont le texte
 * n'est pas lu (`INVISIBLE`), où il n'avait jamais compté.
 */
function forgetText(posts: Map<Element, number>, el: Element, length: number): void {
  let unread = false;
  for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (INVISIBLE.has(ancestor.tagName.toLowerCase())) unread = true;
    const measured = posts.get(ancestor);
    if (measured !== undefined && !unread) posts.set(ancestor, measured - length);
  }
}

// ── Corps réparti en plusieurs blocs (troisième round) ───────────────
// Ars Technica coupe le corps d'un article en plusieurs `div.post-content`,
// chacun dans sa propre grille (le texte, une colonne de publicité vide), les
// grilles séparées par un emplacement publicitaire. Les blocs sont des
// COUSINS : Readability choisit le mieux noté et ne lui adjoint que ses
// FRÈRES. Il ne gardait donc qu'un bloc — le chapeau disparaissait sur quatre
// pages sur cinq, parfois la moitié du texte. Quand il en gardait moins de la
// moitié, la seconde passe (A-1, faite sur l'`<article>` entier) retrouvait le
// corps, mais ramassait avec lui ce que contient la grille du dernier bloc :
// la notice de l'auteur et « 48 Comments ».
//
// Règle générale : deux blocs qui portent exactement la même classe, un nom
// que Readability juge lui-même favorable (`POSITIVE_NAME`, sans
// `NEGATIVE_NAME` — ses propres expressions), qui contiennent un paragraphe,
// dans le même `<article>` (ou hors de tout `<article>`), et entre lesquels
// RIEN NE SE LIT (ni texte ni média : des gabarits et des emplacements
// publicitaires vides) sont un seul corps : le second est versé dans le
// premier avant toute passe. Readability voit alors un bloc, entier ; le reste
// des gabarits (colonne vide, notice, compteur) reste où il était.
//
// L'ORDRE DU TEXTE NE CHANGE JAMAIS, puisque rien de lisible ne les sépare.
// C'est aussi ce qui protège les entrées d'un direct (l'heure et le titre de
// chaque entrée les séparent) et les cartes d'une liste (leurs titres). Des
// blocs déjà frères sont laissés à Readability, qui les réunit lui-même
// (bonus des frères de même classe : The Verge). Deux `<article>` différents
// ne sont jamais réunis.
//
// TOUT OU RIEN (vérification du troisième round, R3V-01) : les blocs d'un
// même groupe dans un même `<article>` sont réunis tous en un seul, ou aucun.
// Clubic coupe son corps en `div.slate-content` cousins, avec des images
// légendées et des intertitres entre certains d'entre eux ; ne réunir que les
// blocs que rien ne séparait faisait d'un morceau du milieu, ainsi grossi, le
// seul candidat de Readability — chapeau, moitié du texte et images perdus
// (1 970 caractères sur 4 907). Laissés tels quels, ils reviennent à ce que
// Readability en faisait avant cette règle. Une réunion ne rend donc jamais
// moins de texte que sans elle : le bloc réuni contient tout le groupe.
// (Verser aussi ce qui se lit entre les blocs dans le corps a été mesuré :
// cela ramassait les encarts « À découvrir » et les offres glissés entre les
// blocs, et coupait des pages Numerama.)
//
// LES INTERCALAIRES DU CORPS NE LE COUPENT PAS (A4-01, quatrième round) :
// chez Clubic, presque chaque article a ses intertitres seuls dans leur bloc
// (sans paragraphe, donc hors du groupe), une image légendée ou un message
// intégré entre deux blocs. « Tout ou rien » refusait alors toute réunion, et
// Readability ne gardait que le dernier bloc : 1 835 caractères sur ~4 900,
// 840 sur ~2 000. Un intercalaire fait de cela seulement — un autre bloc du
// groupe, une image et sa légende, une citation ou un message intégré
// (`partOfBody`) — est versé avec les blocs, à sa place ; l'ordre de ce qui
// se lit ne change donc pas. Tout autre texte coupe encore (l'heure d'une
// entrée de direct), et un lien qui se lit aussi : encart « À découvrir »,
// offre, bannière.
//
// UN BLOC INVISIBLE POUR READABILITY N'EST PAS UN CORPS (B-01, quatrième
// round) : Readability écarte, avec tout ce qu'ils contiennent, les
// `noscript`, les éléments `[hidden]`, `aria-hidden="true"` (sauf
// `fallback-image`), en `display:none` ou `visibility:hidden`, et les
// dialogues modaux. Versé dans une accroche cachée qui le précédait, le corps
// disparaissait avec elle (extrait vide) ; un doublon caché du corps (sa copie
// en `noscript`) versé dans le corps doublait l'article. Un tel bloc — lui-même
// ou par un ancêtre — sort donc du groupe : `hiddenForReadability`.
//
// Même règle dans le repli du navigateur (`src/utils/extractContent.ts`) ;
// toute modification de l'une va avec l'autre, et avec `EXTRACT_VERSION`.

/** `REGEXPS.positive` de Readability 0.6.0 : un nom qui annonce du contenu. */
const POSITIVE_NAME = /article|body|content|entry|hentry|h-entry|main|page|pagination|post|text|blog|story/i;
/** `REGEXPS.negative` de Readability 0.6.0 : un nom qui annonce autre chose. */
const NEGATIVE_NAME = /-ad-|hidden|^hid$| hid$| hid |^hid |banner|combx|comment|com-|contact|footer|gdpr|masthead|media|meta|outbrain|promo|related|scroll|share|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|widget/i;
/** Un média se lit aussi : dans un lien (une bannière), il coupe le corps ; hors lien, légendé ou non, il en fait partie. */
const MEDIA = 'img, picture, video, audio, iframe, object, embed';
/**
 * Le cadre d'un bloc : seuls les blocs d'un même cadre sont réunis. Deux
 * `<article>` sont deux billets ; deux cellules d'un tableau sont deux cases,
 * que rien de lisible ne sépare pourtant — leurs blocs étaient tous versés
 * dans la première (tableau comparatif de Docker, mesure de R3V-01). Les
 * entrées de liste (`li`) ne sont pas des cadres : mesuré, cela ne changeait
 * que des listes de billets liés (Docker), dont la réunion laisse justement
 * l'article l'emporter sur elles.
 */
const SCOPE = 'article, td, th';

/** Un nœud qui se lit : du texte hors script et style, ou un média. */
function isReadable(node: Node): boolean {
  const stack: Node[] = [node];
  while (stack.length) {
    const current = stack.pop()!;
    if (current.nodeType === 3) {
      if ((current.textContent || '').trim()) return true;
    } else if (current.nodeType === 1) {
      const el = current as Element;
      if (INVISIBLE.has(el.tagName.toLowerCase())) continue;
      if (el.matches(MEDIA)) return true;
      for (let child = el.firstChild; child; child = child.nextSibling) stack.push(child);
    }
  }
  return false;
}

/**
 * Readability écarte-t-il cet élément, et tout ce qu'il contient ? Son
 * `_isProbablyVisible`, son retrait des dialogues modaux, et les éléments
 * jamais rendus (`noscript`, qu'il retire avant toute passe, `template`).
 */
function hiddenForReadability(el: Element): boolean {
  if (INVISIBLE.has(el.tagName.toLowerCase()) || el.hasAttribute('hidden')) return true;
  if (el.getAttribute('aria-hidden') === 'true' && !(el.getAttribute('class') || '').includes('fallback-image')) return true;
  if (el.getAttribute('aria-modal') === 'true' && el.getAttribute('role') === 'dialog') return true;
  if (!el.hasAttribute('style')) return false;
  const style = (el as unknown as { style?: { display?: string; visibility?: string } }).style;
  return !!style && (style.display === 'none' || style.visibility === 'hidden');
}

/**
 * Classes de masquage des bibliothèques courantes (Tailwind, Bootstrap,
 * Bulma, WordPress) : `display: none`, ou un texte réservé aux lecteurs
 * d'écran. Une classe qui ne fait qu'en contenir le mot (`hidden-title`) n'en
 * est pas une.
 */
const HIDING_CLASSES = new Set(['hidden', 'invisible', 'd-none', 'is-hidden', 'sr-only', 'visually-hidden', 'screen-reader-text']);
/** Une classe qui RE-montre l'élément à une taille d'écran : `md:block`, `d-lg-flex`. */
const SHOWN_AT_SOME_SIZE = /^(?:[a-z0-9-]+:)+(?:block|flex|grid|inline|inline-block|inline-flex|inline-grid|table|table-cell|table-row|contents|flow-root|list-item|visible|not-sr-only)$|^d-(?:sm|md|lg|xl|xxl)-(?:block|flex|grid|inline|inline-block|inline-flex|table|table-cell|table-row)$/;

/**
 * La page masque-t-elle cet élément, et tout ce qu'il contient (REG-225) ?
 * Ce que Readability écarte (`hiddenForReadability`), et une classe de
 * masquage (`HIDING_CLASSES`) que rien ne re-montre à une autre taille
 * d'écran : un chapeau `hidden md:block` se lit en bureau, il est de
 * l'article. La garde de non-perte ne remet jamais un tel élément. Une
 * feuille de style externe, elle, ne se lit pas : ses classes hachées ne
 * disent rien (voir `withoutRepeats`).
 */
function hiddenOnPage(el: Element): boolean {
  if (hiddenForReadability(el)) return true;
  const tokens = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
  return tokens.some((token) => HIDING_CLASSES.has(token)) && !tokens.some((token) => SHOWN_AT_SOME_SIZE.test(token));
}

/**
 * `el` ou l'un de ses ancêtres est-il invisible (pour Readability, par
 * défaut, ou selon `hidden`) ? Mémorisé dans `memo` : les blocs d'une page
 * partagent leurs ancêtres.
 */
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

/** Le nœud qui suit `node` dans l'ordre du document, sous-arbre de `node` exclu. */
function nextOutside(node: Node): Node | null {
  for (let current: Node | null = node; current; current = current.parentNode) {
    if (current.nextSibling) return current.nextSibling;
  }
  return null;
}

/** Nœuds que les parcours d'une réunion peuvent encore visiter (voir `joinSplitBody`). */
interface Budget { left: number }

/**
 * Ce qui se lit entre la fin de `a` et le début de `b`, qui le suit, dans
 * l'ordre — ou `null` si l'un de ces nœuds n'est pas du corps (`partOfBody`) :
 * il coupe le groupe. `null` aussi quand le budget est épuisé.
 */
function readableBetween(a: Element, b: Element, members: Set<Element>, budget: Budget): Node[] | null {
  const found: Node[] = [];
  let node = nextOutside(a);
  while (node && node !== b) {
    if (--budget.left < 0) return null;
    if (node.contains(b)) {
      // Un ancêtre de `b` : seul ce qui précède `b` en lui compte.
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

/**
 * Ce qui, entre deux blocs, appartient au corps qu'ils coupent (A4-01) : un
 * autre bloc du groupe (un intertitre seul dans son bloc, sans paragraphe),
 * une image et sa légende, une citation ou un message intégré
 * (`blockquote`). Tout autre texte le coupe — l'heure et le titre des
 * entrées d'un direct —, de même qu'un lien qui se lit : un encart
 * « À découvrir », une offre, une bannière.
 */
function partOfBody(node: Node, members: Set<Element>, budget: Budget): boolean {
  const stack: Node[] = [node];
  while (stack.length) {
    if (--budget.left < 0) return false;
    const current = stack.pop()!;
    if (current.nodeType === 3) {
      if ((current.textContent || '').trim()) return false;
      continue;
    }
    if (current.nodeType !== 1) continue;
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

/**
 * Verse dans `body` ce qu'un intercalaire du corps porte de lisible, dans
 * l'ordre. Un bloc du groupe y est versé comme les autres : son contenu, sans
 * ses gabarits — Readability écarte un `<div>` qui n'enveloppe qu'un
 * intertitre (« No useful content »), et l'intertitre avec lui. Une image
 * légendée ou un message intégré y entre entier.
 */
function pourGap(node: Node, body: Element, members: Set<Element>, holders: Set<Node>): void {
  if (members.has(node as Element)) {
    body.append(takeChildren(node));
  } else if (holders.has(node)) {
    for (const child of Array.from(node.childNodes)) pourGap(child, body, members, holders);
  } else if (isReadable(node)) {
    body.append(node);
  }
}

/** Réunit, sous `root`, les blocs d'un corps réparti dans des gabarits parallèles. */
export function joinSplitBody(root: Element): void {
  const groups = new Map<string, Element[]>();
  for (const el of Array.from(root.querySelectorAll('[class]')) as Element[]) {
    const name = (el.getAttribute('class') || '').replace(/\s+/g, ' ').trim();
    if (!name || !POSITIVE_NAME.test(name) || NEGATIVE_NAME.test(name)) continue;
    const group = groups.get(name);
    if (group) group.push(el);
    else groups.set(name, [el]);
  }
  const hidden = new Map<Element, boolean>();
  // Depuis A4-01, un parcours franchit les intercalaires du corps au lieu de
  // s'arrêter au premier : sur une page faite pour cela, les parcours de
  // groupes différents pourraient franchir le même long intercalaire. Leur
  // total est donc borné ; épuisé, il ne réunit plus rien.
  const budget: Budget = { left: 8 * root.getElementsByTagName('*').length + 10_000 };
  for (const group of groups.values()) {
    // Dans l'ordre du document. Un bloc imbriqué dans un autre du groupe
    // voyage avec lui : seuls les plus extérieurs comptent.
    const blocks: Element[] = [];
    for (const el of group) {
      const last = blocks[blocks.length - 1];
      if (!last || !last.contains(el)) blocks.push(el);
    }
    const members = new Set(blocks.filter((block) => !insideHidden(block, hidden)));
    // Les ancêtres des blocs : un intercalaire qui en contient un est
    // déballé jusqu'à lui (voir `pourGap`).
    const holders = new Set<Node>();
    for (const member of members) {
      for (let up = member.parentNode; up && up !== root && !holders.has(up); up = up.parentNode) holders.add(up);
    }
    // Par `<article>` (ou hors de tout `<article>`), dans l'ordre. Une cellule
    // de tableau est son propre cadre : ses blocs ne sont jamais versés dans
    // ceux d'une autre (`SCOPE`).
    const runs = new Map<Element | null, Element[]>();
    for (const block of blocks) {
      // Un bloc sans texte n'est pas un corps. C'est aussi ce qui borne le
      // coût : un bloc qui se lit arrête tout parcours qui le croise, donc les
      // intervalles parcourus d'un groupe à l'autre ne se recouvrent pas — sans
      // cette règle, 1 000 groupes de blocs vides encadrant 50 000 `<div>`
      // coûtaient 54 s. Un bloc que Readability écartera non plus (B-01).
      if (!block.querySelector('p') || !isReadable(block) || insideHidden(block, hidden)) continue;
      const scope = block.closest(SCOPE);
      const run = runs.get(scope);
      if (run) run.push(block);
      else runs.set(scope, [block]);
    }
    for (const run of runs.values()) {
      // Tout ou rien : une seule coupure, et aucun bloc n'est réuni. Ce qui
      // se lit entre deux blocs sans les couper (A4-01) est versé avec eux, à
      // sa place.
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
