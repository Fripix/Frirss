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
 * HTML réel, bien plus dense en balises (471 ms relevés pour 2,7 Mo). Au
 * plafond de lecture (5 Mo, `MAX_HTML_BYTES`), c'est de l'ordre de la seconde
 * d'immobilité pour TOUS les lecteurs. Et cette charge est neuve : elle vivait
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
  const { document } = parseHTML(html);

  // Une URL relative dans la page ne veut rien dire pour le navigateur, qui
  // reçoit le HTML sans savoir d'où il vient. `<base>` les résout ici.
  const base = document.createElement('base');
  base.setAttribute('href', url);
  document.head?.prepend(base);

  const parsed = new Readability(document as never, { charThreshold: 50 }).parse();
  if (!parsed?.content) return null;

  return {
    title: parsed.title || '',
    content: parsed.content,
    excerpt: parsed.excerpt || '',
    byline: parsed.byline || '',
    siteName: parsed.siteName || '',
    length: parsed.length || 0,
  };
}
