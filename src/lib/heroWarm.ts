// Réchauffage de l'image d'en-tête des articles suivants.
//
// Le volet de lecture prépare déjà le TEXTE des articles suivants. Mais ce
// HTML n'est rendu qu'au moment où l'on glisse vers l'article : aucune requête
// d'image n'est émise avant. Sur iPhone, le texte apparaît donc d'abord et
// l'image tombe une fraction de seconde plus tard, en poussant le texte.
//
// ⚠️ POURQUOI CETTE VERSION-CI TIENT, alors que celle du cycle 1.4.10 a dû
// être retirée. Elle passait par `cacheImages()`, donc par le **proxy
// backend** — plafonné par utilisateur et par minute, et déjà sollicité par
// l'extraction de fond. Dix articles × quatre images saturaient ce plafond et
// le balayage suivant attendait derrière la file : 2 à 7 s au lieu de ~0,9 s.
//
// Ici, **rien ne passe par le proxy**. Rien ne réécrit le `src` des images
// d'article : quand un article s'affiche, le navigateur va chercher ses images
// directement à leur origine, et le service worker les met en cache
// (`vite.config.js`, `request.destination === 'image'`, CacheFirst, cache
// `frirss-images`). Réchauffer, c'est donc simplement faire ce que ferait le
// rendu : affecter `src` sur une `new Image()` détachée. Même destination,
// même route de cache, aucun octet par le proxy. C'est ce qui permet une
// fenêtre généreuse — dix articles — là où la précédente devait se rationner.
//
// Le reste tient en quatre règles :
//
//  1. **L'image d'en-tête seulement**, la première du corps. Les suivantes
//     sont hors écran et déjà en `loading="lazy"`.
//  2. **Deux requêtes en vol au plus.** Ce travail est invisible : il ne doit
//     jamais disputer la bande passante à l'article qu'on est en train de lire.
//  3. **Rien ne part pendant un balayage.** L'appelant tient le drapeau
//     `cancelled` et le délai d'installation d'une seconde ; le runner le relit
//     avant chaque départ. Une vague déjà en vol (deux images) va au bout : une
//     requête d'image directe ne bloque personne.
//  4. **Aucune reprise sur échec.** Une image qui rate ne dit rien des autres,
//     et personne ne regarde le résultat.
//
// Bénéfice second, et pas le moindre : l'événement `load` donne
// `naturalWidth`/`naturalHeight` gratuitement. `imageAspect.ts` les retient, et
// `reserveImgAspect()` réserve enfin la bonne boîte pour les flux qui
// n'annoncent pas les dimensions de leurs images.

import { collectImageUrls } from './offlineImages';
import { normalizeImageUrl, type ImageMeasure } from './imageAspect';

/** Articles préparés en avant de celui qui est ouvert. */
export const HERO_WARM_AHEAD = 10;

/** Chargements d'image simultanés au plus. */
export const HERO_WARM_CONCURRENCY = 2;

/** Le strict minimum dont le réchauffage a besoin d'un article. */
export interface HeroWarmItem {
  id: string;
  /** HTML du flux RSS : c'est lui qui porte l'image d'en-tête. */
  content?: string | null;
}

export interface HeroWarmTarget {
  id: string;
  url: string;
}

/**
 * Les images à réchauffer, dans l'ordre de lecture.
 *
 * L'image retenue est la première du HTML du flux. Sur un flux à extraction
 * automatique aussi : `displayedHtml()` réinjecte justement cette image en
 * tête quand l'extraction l'a perdue, et quand l'extraction la contient, c'est
 * la même URL. Une image relative ou en `data:` est écartée — la première n'est
 * pas résoluble hors du rendu, la seconde n'est pas une requête réseau.
 *
 * Aucun filtre sur les réglages de flux : contrairement à l'extraction du
 * texte, une image se réchauffe de la même façon quel que soit le flux.
 */
export function planHeroWarm(opts: {
  articles: readonly HeroWarmItem[];
  currentId: string;
  ahead?: number;
}): HeroWarmTarget[] {
  const { articles, currentId, ahead = HERO_WARM_AHEAD } = opts;
  const idx = articles.findIndex((a) => a.id === currentId);
  if (idx < 0) return [];

  const out: HeroWarmTarget[] = [];
  const seen = new Set<string>();
  for (const a of articles.slice(idx + 1, idx + 1 + ahead)) {
    const [first] = collectImageUrls(a.content || '', 1);
    if (!first) continue;
    const url = normalizeImageUrl(first);
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ id: a.id, url });
  }
  return out;
}

export interface HeroWarmDeps {
  /** Le cache d'images détient-il déjà cette URL ? Un rejet vaut « non ». */
  isCached: (url: string) => Promise<boolean>;
  /** Charger l'image comme le ferait le rendu ; `null` si elle a échoué. */
  warm: (url: string) => Promise<ImageMeasure | null>;
  /** Retenir les dimensions mesurées (`imageAspect.rememberImageSize`). */
  remember: (url: string, measure: ImageMeasure) => void;
  /** Le travail appartient-il encore à l'article ouvert ? */
  cancelled: () => boolean;
  /** Chargements simultanés. Défaut : `HERO_WARM_CONCURRENCY`. */
  concurrency?: number;
}

export interface HeroWarmResult {
  /** Images chargées et mesurées. */
  warmed: number;
  /** Images que le cache détenait déjà — le vrai gain d'une relecture. */
  skipped: number;
  /** Images qui n'ont rien donné. Personne n'y revient. */
  failed: number;
}

/**
 * Réchauffer les images du plan, `concurrency` à la fois.
 *
 * Rien de ce qui échoue ici ne remonte : c'est du travail d'avance, invisible,
 * dont l'échec ne coûte que ce qu'il aurait fait gagner.
 */
export async function runHeroWarm(
  targets: readonly HeroWarmTarget[],
  deps: HeroWarmDeps,
): Promise<HeroWarmResult> {
  const result: HeroWarmResult = { warmed: 0, skipped: 0, failed: 0 };
  if (!targets.length) return result;

  let next = 0;
  const lanes = Math.max(1, Math.min(deps.concurrency ?? HERO_WARM_CONCURRENCY, targets.length));

  async function lane(): Promise<void> {
    for (;;) {
      // Le drapeau est relu ICI, avant chaque départ : un balayage qui reprend
      // arrête la file, sans annuler ce qui est déjà en vol.
      if (deps.cancelled()) return;
      const i = next++;
      if (i >= targets.length) return;
      const { url } = targets[i];

      let cached = false;
      try {
        cached = await deps.isCached(url);
      } catch { /* cache illisible : on réchauffe, au pire pour rien */ }
      if (cached) { result.skipped++; continue; }
      if (deps.cancelled()) return;

      try {
        const measure = await deps.warm(url);
        if (measure && measure.width > 0 && measure.height > 0) {
          deps.remember(url, measure);
          result.warmed++;
        } else {
          result.failed++;
        }
      } catch {
        result.failed++; // pas de reprise : l'image suivante n'y est pour rien
      }
    }
  }

  await Promise.all(Array.from({ length: lanes }, () => lane()));
  return result;
}
