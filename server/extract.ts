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
 * Nombre d'extractions qu'on accepte d'avoir en cours ou en attente.
 *
 * `parseHTML` + `Readability` sont **entièrement synchrones** : pendant leur
 * exécution, l'unique processus Node qui sert toute l'instance ne fait rien
 * d'autre. Mesuré avec les modules de ce dépôt : 20 ms pour 0,1 Mo, 113 ms pour
 * 1,6 Mo, 203 ms pour 3,2 Mo de HTML synthétique — et environ le double sur du
 * HTML réel, bien plus dense en balises (471 ms relevés pour 2,7 Mo) — et
 * 2,96 s pour une page plate de 4,9 Mo construite pour coûter cher. D'où le
 * plafond de lecture ramené à 2 Mo (`MAX_HTML_BYTES`) : de l'ordre de la
 * seconde d'immobilité pour TOUS les lecteurs au pire cas. Et cette charge est neuve : elle vivait
 * auparavant sur chaque téléphone.
 *
 * Le seul frein existant était le seau de cadence (600/min par compte), qui
 * autorise un ordre de grandeur de plus que ce que la boucle peut absorber.
 *
 * Ce que compte `pending` : les requêtes ARRIVÉES à l'analyse et pas encore
 * reparties — le compteur est pris à l'entrée, tenu pendant l'attente du tour,
 * et rendu dans un `finally`. C'est la LONGUEUR DE FILE qui est bornée, pas un
 * parallélisme : celui-ci vaut déjà un, l'analyse étant synchrone. Un compteur
 * qui n'entourerait que l'appel à `run()` ne bornerait rien — pendant qu'il
 * s'exécute, aucun autre appelant n'a la main pour le lire, donc il vaut
 * toujours zéro vu de l'extérieur.
 *
 * 5 : une en train de s'exécuter, quatre en attente, donc un retard d'au plus
 * ~5 analyses. Au pire cas mesuré (~1 s la pièce) cela reste bien sous le
 * budget que le client accorde à cette jambe (`SERVER_EXTRACT_TIMEOUT_MS`,
 * 20 s) — une attente qui a donc encore une chance d'aboutir, là où une file
 * plus longue ne promettrait que des réponses arrivant après l'abandon.
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
 * Exécute `run` (l'étape synchrone et coûteuse) à son tour de file.
 *
 * La file n'entoure QUE l'analyse : la tenir pendant la récupération réseau de
 * la page rendrait le débit de l'instance égal à celui du site le plus lent.
 *
 * `setImmediate` entre deux analyses, et pas un simple `await` : une promesse
 * déjà réglée ne rend la main qu'aux micro-tâches, donc enchaînerait N
 * immobilisations sans que la boucle traite la moindre entrée-sortie. Un tour
 * de boucle complet entre deux analyses, c'est la différence entre « le serveur
 * est lent » et « le serveur ne répond plus ».
 */
export async function withExtractSlot<T>(run: () => T): Promise<T> {
  if (pending >= EXTRACT_MAX_PENDING) throw new ExtractorBusyError();
  pending++;
  const turn = tail.then(() => new Promise<void>((resolve) => setImmediate(resolve)));
  // La file avance même si un tour échoue : sans ce `catch`, une seule analyse
  // en erreur laisserait une promesse rejetée en fin de file et bloquerait
  // toutes les suivantes.
  tail = turn.catch(() => {});
  try {
    await turn;
    return run();
  } finally {
    pending--;
  }
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

type ParsedDocument = ReturnType<typeof parseHTML>['document'];

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
