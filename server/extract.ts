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
// balises facultatives omises) en faisait lever une dans Readability, qui
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

/** Complète `doc` en `<html>` + `<head>` + `<body>` ; `false` s'il n'a aucun élément. */
function wholeDocument(doc: ParsedDocument): boolean {
  const top = Array.from(doc.childNodes as unknown as ArrayLike<Node>);
  const roots = top.filter((node) => node.nodeType === 1) as Element[];
  if (!roots.length) return false;
  const childOf = (parent: Element, tag: string) => Array.from(parent.children).find((child) => child.tagName === tag) ?? null;
  let html = roots.find((root) => root.tagName === 'HTML') ?? null;
  if (roots.length === 1 && html && childOf(html, 'BODY')) return true;

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
  // ferme. Sans `<body>`, les enfants de `<html>` sont aussi le début de la page.
  const opening: Node[] = [];
  const closing: Node[] = [];
  let afterHtml = false;
  for (const node of top) {
    if (node === html) afterHtml = true;
    else if (node.nodeType !== 10) (afterHtml ? closing : opening).push(node);
  }
  let body = childOf(html, 'BODY');
  if (!body) {
    opening.push(...Array.from(html.childNodes).filter((node) => node !== head));
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
  body.prepend(...content);
  body.append(...closing);
  return true;
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
  const load = () => {
    const { document } = parseHTML(html);
    // Rien à lire sans élément ; et Readability veut un document entier (C-03).
    if (!wholeDocument(document)) return null;
    // Une URL relative dans la page ne veut rien dire pour le navigateur, qui
    // reçoit le HTML sans savoir d'où il vient. `<base>` les résout ici.
    const base = document.createElement('base');
    base.setAttribute('href', url);
    document.head.prepend(base);
    // Images paresseuses et boutons d'agrandissement, avant toute passe (A1).
    resolveLazyImages(document.documentElement as unknown as Element);
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

  // Le refus rapide d'abord, sur le texte : l'analyse HTML d'une page piégée
  // coûte déjà le carré de sa profondeur, Readability le cube.
  const tooComplex = markupTooComplex(html, { maxDepth: EXTRACT_MAX_DEPTH, maxElements: EXTRACT_MAX_ELEMENTS });
  if (tooComplex) throw new PageTooComplexError(tooComplex);
  const document = load();
  if (!document) return null;
  assertTreeBounded(document);
  clean(document);
  // Mesuré AVANT Readability, qui modifie le document qu'il lit.
  const mainLength = mainContainerTextLength(document);
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
      }
    }
  }

  return {
    title: parsed.title || '',
    content,
    excerpt: parsed.excerpt || '',
    byline: parsed.byline || '',
    siteName: parsed.siteName || '',
    length,
  };
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
function aroundTheList(doc: ParsedDocument, list: OnlyList): { content: string; length: number; textContent: string } | null {
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
  const textContent = (again.textContent || '').replace(token, list.text);
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
//   (pas une icône) est déballé (`isZoomButton`, plus bas).
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
  const v = value?.trim();
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
  for (const button of Array.from(root.querySelectorAll('button')) as Element[]) {
    if (isZoomButton(button)) button.replaceWith(...Array.from(button.childNodes));
  }
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
//   `contentinfo` ;
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
// Deux gardes :
// - un bloc qui porte la moitié du texte de la racine ou plus n'est jamais
//   retiré — c'est le corps, quel que soit son nom (une page entière
//   enveloppée dans un `<form>`, un `div.comments-enabled`) ;
// - un bloc qui porte l'auteur non plus (`carriesByline`) : Readability lit
//   l'auteur dans le document AVANT d'écarter lui-même `aside` et `footer`
//   du corps ; le retirer plus tôt effaçait l'auteur (un `footer.entry-meta`
//   de blog, un `aside.author` de Le Monde Informatique hors règle d'article).
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
const POWERED_BY = /^powered by\b/i;
/** Un crédit est court : au-delà, c'est une phrase d'article. */
const POWERED_BY_MAX_LENGTH = 120;

/** Texte lisible d'un billet, mesuré une fois par nettoyage (voir `stripBoilerplate`). */
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
    // Ni le billet ni le conteneur principal ne sont jugés « courts » ou
    // « formulaire » : ce sont eux qu'on extrait.
    if (!isPostContainer(tag, role)) {
      if (tokens.includes('newsletter') && el.querySelector(FORM_CONTROLS) && !carriesMostOfItsPost(el, postLength)) return true;
      if (tokens.some((token) => SHORT_BLOCK_TOKENS.has(token))
        && visibleTextLength(el, READABILITY_CHAR_THRESHOLD) < READABILITY_CHAR_THRESHOLD) return true;
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
 * s'arrête à la moitié du billet, seule question posée.
 */
function carriesMostOfItsPost(el: Element, postLength: PostLength): boolean {
  const post = el.parentElement?.closest('article, main, [role="main"]');
  if (!post) return false;
  const half = postLength(post) * MAIN_CONTAINER_MIN_SHARE;
  return visibleTextLength(el, half) >= half;
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
  const total = visibleTextLength(root);
  // Texte des billets déjà mesurés (B-02), tenu à jour à chaque retrait :
  // un billet se mesure tel qu'il reste, comme quand chaque bloc le relisait.
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
 * `el` ou l'un de ses ancêtres est-il invisible pour Readability ? Mémorisé
 * dans `memo` : les blocs d'une page partagent leurs ancêtres.
 */
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
    body.append(...Array.from(node.childNodes));
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
        body.append(...Array.from(block.childNodes));
        block.remove();
      });
    }
  }
}
