// Quand le fantôme de balayage peut-il s'effacer ?
//
// Sur mobile, glisser d'un article à l'autre affiche un calque « fantôme »
// (`swipe-ghost`, monté par `ReadingPane`) qui porte l'article visé. Une fois
// le vrai article rendu derrière lui, le fantôme se fond — et il ne doit le
// faire qu'au moment où le vrai article sait PEINDRE la même image, sinon on
// remplace une image visible par un trou blanc : le clignotement.
//
// ⚠️ `HTMLImageElement.complete` ne répond pas à cette question. Il dit
// « la ressource a fini d'arriver », pas « la trame est décodée et prête à
// être peinte ». Sur iOS l'écart entre les deux est réel. Tant que les images
// n'étaient pas en cache, il ne se voyait pas : elles n'étaient jamais
// `complete` au moment du fondu, on tombait donc dans la branche qui attend
// l'événement `load`, tardif au point de couvrir le décodage. Depuis que
// `prefetchAhead.ts` (1.4.9) réchauffe les images des articles suivants,
// elles sont `complete` dès le rendu : le fondu partait aussitôt, avant le
// décodage, et l'image clignotait pile à l'arrivée de l'article.
//
// La réponse est `decode()`, qui ne se résout qu'une fois la trame décodée.
// Trois garde-fous l'encadrent, tous repris de la version précédente :
//
//  1. **Un rejet vaut un `error`.** `decode()` rejette sur une image cassée :
//     il faut cesser d'attendre, pas rester suspendu.
//  2. **Un délai de garde.** Rien ne doit pouvoir laisser le fantôme collé à
//     l'écran ; passé `GHOST_FADE_TIMEOUT_MS`, on fond quoi qu'il arrive.
//  3. **Un repli.** `decode()` n'existe pas partout (jsdom, vieux moteurs) :
//     sans lui, on retrouve exactement l'ancien comportement plutôt que de
//     lever.

/** Au-delà, plus rien n'est sous le fantôme au moment du fondu. */
export const GHOST_FADE_IMAGE_LIMIT = 3;

/** Filet de sécurité : le fantôme ne peut jamais rester à l'écran. */
export const GHOST_FADE_TIMEOUT_MS = 1500;

/** Le strict minimum dont ce module se sert d'une image. */
export interface GhostImage {
  complete: boolean;
  /** `'lazy'` pour une image différée ; absent sur les moteurs qui l'ignorent. */
  loading?: string;
  /** Absent sur jsdom et les vieux moteurs — d'où le repli. */
  decode?: () => Promise<unknown>;
  addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void;
}

/**
 * Les images qu'il vaut la peine d'attendre.
 *
 * Deux coupes, pour la même raison : seule une image qui va réellement peindre
 * sous le fantôme peut clignoter.
 *
 *  - **Les premières seulement.** Le fantôme couvre le haut de l'article ; ce
 *    qui charge plus bas ne se voit pas au moment du fondu.
 *  - **Pas les différées, TANT QU'IL RESTE AUTRE CHOSE.** `buildArticleBody`
 *    pose `loading="lazy"` sur tout ce qui suit les deux premières images :
 *    hors écran, elles ne peignent rien, et les attendre retiendrait le
 *    fantôme pour une image invisible — `decode()` forcerait même leur
 *    chargement. Mais `loading` ne dit pas « invisible » : la façade YouTube
 *    (`facadeMarkup`) porte `loading="lazy"` alors qu'elle EST l'image de tête
 *    de l'article. Écarter les différées sans condition faisait donc fondre
 *    ces articles-là sans rien attendre. D'où le repli sur l'ordre du
 *    document quand il ne reste rien : la première image d'un article est
 *    sous le fantôme, différée ou non.
 */
export function pickGhostImages<T extends GhostImage>(
  images: Iterable<T>,
  limit: number = GHOST_FADE_IMAGE_LIMIT,
): T[] {
  const all = Array.from(images);
  const eager = all.filter((i) => i.loading !== 'lazy');
  return (eager.length > 0 ? eager : all).slice(0, limit);
}

export interface GhostPaintOptions {
  /** Sauter l'attente : l'article était déjà rendu, rien à décoder. */
  immediate?: boolean;
  limit?: number;
  timeoutMs?: number;
}

/**
 * Appelle `onReady` quand le fantôme peut s'effacer — une fois au plus.
 *
 * On fond dès la PREMIÈRE image prête, pas la dernière : c'est l'image de tête
 * qui recouvre l'écran, et attendre les suivantes retiendrait le fantôme sans
 * rien ajouter à ce qu'on voit. C'était déjà la sémantique de la version à
 * base d'événements.
 */
export function awaitGhostPaint(
  images: Iterable<GhostImage>,
  onReady: () => void,
  opts: GhostPaintOptions = {},
): void {
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    onReady();
  };

  const waited = pickGhostImages(images, opts.limit);
  if (opts.immediate || waited.length === 0) {
    finish();
    return;
  }

  const decodable = waited.filter(
    (i): i is GhostImage & { decode: () => Promise<unknown> } => typeof i.decode === 'function',
  );

  if (decodable.length === 0) {
    // Repli — comportement d'avant `decode()` : « chargée » fait foi.
    if (waited.every((i) => i.complete)) {
      finish();
      return;
    }
    waited.forEach((i) => {
      if (!i.complete) {
        i.addEventListener('load', finish, { once: true });
        i.addEventListener('error', finish, { once: true });
      }
    });
  } else {
    // Un rejet libère au même titre qu'une réussite : l'image cassée ne
    // peindra jamais, la retenir figerait le fantôme.
    decodable.forEach((i) => { i.decode().then(finish, finish); });
  }

  setTimeout(finish, opts.timeoutMs ?? GHOST_FADE_TIMEOUT_MS);
}
