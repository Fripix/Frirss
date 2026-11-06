import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';

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
 * Au-delà, la requête est REFUSÉE plutôt que mise en attente : le client sait
 * se replier sur son propre extracteur, donc un refus lui coûte une extraction
 * locale — ce qu'il faisait de toute façon avant la 1.4.10 — quand une file
 * sans borne coûterait la mémoire du serveur et la patience du lecteur.
 */
export const EXTRACT_MAX_PENDING = 5;

/** La file d'extraction est pleine — échec ordinaire, le client se replie. */
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
// Mesuré juste après `parseHTML`, avant toute passe Readability : un parcours
// itératif de l'arbre, qui s'arrête au premier dépassement. Son coût est celui
// de l'analyse HTML (~7 ms pour 5000 niveaux), pas celui de Readability.
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
 * d'éléments (`elements`), délai du worker dépassé (`timeout`) ou mémoire du
 * worker épuisée (`memory`). Échec DÉFINITIF : la route le dit, le serveur le
 * garde quelques minutes, et le client ne se replie pas sur son propre
 * extracteur.
 */
export class PageTooComplexError extends Error {
  constructor(readonly reason: 'depth' | 'elements' | 'timeout' | 'memory') {
    super(`Page too complex (${reason})`);
    this.name = 'PageTooComplexError';
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

// ── L'analyse dans un worker (M-01) ──────────────────────────────────

/**
 * Délai accordé à une analyse. Une vraie page de 2 Mo s'analyse en moins d'une
 * seconde (0,57 s pour la plus lourde du corpus) ; au-delà de 10 s, ce n'est
 * plus une page, c'est un piège. Le client abandonne de toute façon à 20 s.
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
 * l'échéance. Un dépassement est rendu comme `PageTooComplexError('timeout')`.
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
    const timer = setTimeout(() => settle(() => reject(new PageTooComplexError('timeout'))), timeoutMs);
    worker.once('message', (reply: WorkerReply) => settle(() => {
      if (reply.ok) resolve(reply.article);
      else if (reply.tooComplex) reject(new PageTooComplexError(reply.tooComplex));
      else reject(new Error(reply.message));
    }));
    worker.once('error', (err: Error & { code?: string }) => settle(() => {
      reject(err.code === 'ERR_WORKER_OUT_OF_MEMORY' ? new PageTooComplexError('memory') : err);
    }));
    worker.once('exit', (code) => settle(() => reject(new Error(`extract worker exited (${code})`))));
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
 * `null` quand Readability ne trouve pas d'article : l'appelant doit alors
 * laisser la main au navigateur plutôt que de renvoyer un corps vide.
 *
 * Lève `PageTooComplexError` quand l'arbre dépasse `EXTRACT_MAX_DEPTH` ou
 * `EXTRACT_MAX_ELEMENTS` — vérifié avant toute passe Readability (M-01).
 * Synchrone : la route ne l'appelle qu'à travers `extractInWorker`.
 */
export function extractArticle(url: string, html: string): ExtractedArticle | null {
  const load = () => {
    const { document } = parseHTML(html);
    // Une URL relative dans la page ne veut rien dire pour le navigateur, qui
    // reçoit le HTML sans savoir d'où il vient. `<base>` les résout ici.
    const base = document.createElement('base');
    base.setAttribute('href', url);
    document.head?.prepend(base);
    return document;
  };

  const document = load();
  // Le refus rapide d'abord : c'est Readability qui coûte, pas l'analyse HTML.
  assertTreeBounded(document);
  // Mesuré AVANT Readability, qui modifie le document qu'il lit.
  const mainLength = mainContainerTextLength(document);
  const parsed = new Readability(document as never, { charThreshold: READABILITY_CHAR_THRESHOLD }).parse();
  if (!parsed?.content) return null;

  let content = parsed.content;
  let length = parsed.length || 0;
  if (mainLength != null && keptTooLittle(parsed.textContent || '', mainLength)) {
    const retry = load();
    if (keepOnlyMainContainer(retry)) {
      const again = new Readability(retry as never, MAIN_CONTAINER_OPTIONS).parse();
      if (again?.content && normalizedLength(again.textContent || '') > normalizedLength(parsed.textContent || '')) {
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
// ne peut rien ramasser hors du conteneur (navigation, pied), et n'est retenue
// que si elle rend plus de texte. Le titre, l'auteur et le chapeau restent
// ceux de la passe normale, qui voit toute la page.
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

/** Vide `<body>` de tout sauf le conteneur principal. `false` s'il n'y en a pas. */
function keepOnlyMainContainer(doc: ParsedDocument): boolean {
  const container = findMainContainer(doc);
  if (!container || !doc.body) return false;
  doc.body.replaceChildren(container);
  return true;
}
