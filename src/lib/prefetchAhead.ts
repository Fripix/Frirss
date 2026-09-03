// Préchargement « en avant » : ce que FriRSS prépare pendant qu'un article est
// lu, pour que le suivant s'affiche entier.
//
// Le volet de lecture extrayait déjà le TEXTE des articles suivants. Mais ce
// HTML n'est jamais rendu tant qu'on n'y glisse pas : aucune requête d'image
// n'était donc émise, et sur iPhone le texte apparaissait d'abord, puis les
// images tombaient et le poussaient vers le bas. Extraire sans réchauffer les
// images ne règle que la moitié du saut.
//
// Deux garde-fous encadrent ce travail :
//
//  1. **Le réglage « images hors ligne » commande.** Un budget nul (preset
//     `none`) veut dire « aucune image » : on continue d'extraire le texte,
//     mais plus rien ne part sur le réseau pour les images.
//  2. **Le total reste borné et prévisible.** Le proxy backend est limité par
//     utilisateur et par minute, et l'extraction de fond (`warmSchedule.ts`)
//     le consomme déjà. D'où : au plus dix articles, au plus `perArticle`
//     images chacun, arrêt dès que le budget d'octets est épuisé — le même
//     motif que la préparation hors ligne — et **aucune reprise sur échec**.
//
// Le travail est séquentiel : lancer dix articles en parallèle ferait
// exactement ce qu'on cherche à éviter, une rafale sur un lien mobile pendant
// que l'article courant se charge.

import { articleImageUrls, type ImageBudget } from './offlineImages';

/** Nombre d'articles préparés en avant de celui qui est ouvert. */
export const PREFETCH_AHEAD_WINDOW = 10;

/** Le strict minimum dont le préchargement a besoin d'un article. */
export interface PrefetchItem {
  id: string;
  /** Page d'origine — sans elle, rien à extraire. */
  url?: string | null;
  sourceId: string;
  /** HTML du flux RSS : porte la vignette, et sert de repli sans extrait. */
  content: string;
}

/**
 * Les articles à préparer, dans l'ordre de lecture.
 *
 * ⚠️ Le plan ne sait RIEN des caches. Un article déjà extrait doit y rester :
 * son texte est prêt, mais ses images peuvent très bien ne pas l'être. C'est
 * le runner qui saute l'extraction déjà faite, pas le plan qui écarte
 * l'article — l'ancienne version filtrait sur le cache d'extraits et privait
 * ces articles-là de tout préchargement d'images.
 */
export function planPrefetchAhead(opts: {
  articles: readonly PrefetchItem[];
  currentId: string;
  autoExtract: (sourceId: string) => boolean;
  ahead?: number;
}): PrefetchItem[] {
  const { articles, currentId, autoExtract, ahead = PREFETCH_AHEAD_WINDOW } = opts;
  const idx = articles.findIndex((a) => a.id === currentId);
  if (idx < 0) return [];
  return articles
    .slice(idx + 1, idx + 1 + ahead)
    .filter((a) => !!a.url && autoExtract(a.sourceId));
}

export interface PrefetchAheadDeps {
  /** Budget d'images en vigueur (`imageBudget`). `bytes: 0` = pas d'images. */
  budget: ImageBudget;
  /** Extrait déjà connu (mémoire puis base), ou `null`. */
  cachedExtract: (item: PrefetchItem) => Promise<string | null>;
  /** Extraire et archiver ; renvoie le HTML extrait. Un rejet est absorbé. */
  extract: (item: PrefetchItem) => Promise<string | null>;
  /** Mise en cache best-effort ; renvoie les octets réellement stockés. */
  cacheImages: (urls: string[]) => Promise<{ bytes: number }>;
  /** Le run appartient-il encore à l'article ouvert ? */
  cancelled: () => boolean;
}

export interface PrefetchAheadResult {
  /** Extractions réellement lancées et abouties. */
  extracted: number;
  /** Images demandées au cache (stockées ou non — le cache est best-effort). */
  imagesRequested: number;
  /** Octets réellement stockés, tels que `cacheImages` les rapporte. */
  imagesBytes: number;
  /** Le budget d'octets a-t-il coupé le préchargement d'images ? */
  budgetStopped: boolean;
}

/**
 * Préparer les articles du plan, un par un.
 *
 * Rien de ce qui échoue ici ne remonte : ni une extraction, ni une image. Un
 * article suivant n'a aucun rapport avec celui qui vient de rater, et ce
 * travail est invisible — le faire échouer bruyamment ne rendrait service à
 * personne.
 */
export async function runPrefetchAhead(
  items: readonly PrefetchItem[],
  deps: PrefetchAheadDeps,
): Promise<PrefetchAheadResult> {
  const { budget } = deps;
  // Un budget nul n'est pas un cas dégradé : c'est le réglage « aucune image ».
  let budgetStopped = budget.bytes <= 0 || budget.perArticle <= 0;
  let extracted = 0;
  let imagesRequested = 0;
  let imagesBytes = 0;

  for (const item of items) {
    if (deps.cancelled()) break;

    let html: string | null = null;
    try {
      html = await deps.cachedExtract(item);
    } catch { /* le cache ne dit rien : on extraira */ }
    if (deps.cancelled()) break;

    if (!html) {
      try {
        html = await deps.extract(item);
        if (html) extracted++;
      } catch { /* on garde le HTML du flux pour les images */ }
      if (deps.cancelled()) break;
    }

    if (budgetStopped) continue;
    const urls = articleImageUrls(item.content, html, budget.perArticle);
    if (!urls.length) continue;
    imagesRequested += urls.length;
    try {
      const { bytes } = await deps.cacheImages(urls);
      imagesBytes += bytes;
      // On compte les octets réellement stockés, comme la préparation hors
      // ligne : l'estimation du navigateur rembourre les réponses opaques au
      // point d'être inutilisable.
      if (imagesBytes >= budget.bytes) budgetStopped = true;
    } catch { /* pas de reprise : l'article suivant n'y est pour rien */ }
  }

  return { extracted, imagesRequested, imagesBytes, budgetStopped };
}
