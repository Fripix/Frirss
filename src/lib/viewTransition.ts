/**
 * Morphing liste → lecture par l'API View Transitions.
 *
 * Le titre de la ligne sélectionnée et celui du volet de lecture portent le
 * même `view-transition-name` : le navigateur anime le passage de l'un à
 * l'autre au lieu de le faire disparaître d'un côté et réapparaître de
 * l'autre. Là où l'API n'existe pas, il ne se passe rien — dégradation propre,
 * rien à installer.
 *
 * **Uniquement quand la liste est REMPLACÉE par le volet** (2 panneaux,
 * grille, mobile). En 3 panneaux les deux titres sont à l'écran en même temps,
 * revendiquent le même nom, et le navigateur saute la transition en émettant
 * un avertissement — autant ne pas la demander.
 */

interface MorphContext {
  /** La liste disparaît-elle au profit du volet de lecture ? */
  listIsReplaced: boolean;
  reducedMotion: boolean;
}

type StartViewTransition = (callback: () => void) => unknown;

function startViewTransition(): StartViewTransition | null {
  const fn = (document as unknown as { startViewTransition?: StartViewTransition })
    .startViewTransition;
  return typeof fn === 'function' ? fn.bind(document) : null;
}

export function canMorph({ listIsReplaced, reducedMotion }: MorphContext): boolean {
  if (!listIsReplaced || reducedMotion) return false;
  return startViewTransition() !== null;
}

/**
 * Exécute la mise à jour, avec la transition si `enabled`.
 *
 * `run` doit committer le DOM de façon **synchrone** (côté React : `flushSync`),
 * sinon le navigateur photographie l'ancien état deux fois.
 *
 * Toute erreur retombe sur l'exécution nue : une animation ratée ne doit
 * jamais coûter la navigation elle-même.
 */
export function withMorph(run: () => void, enabled: boolean): void {
  const start = enabled ? startViewTransition() : null;
  if (!start) {
    run();
    return;
  }
  // `ran` évite la double exécution si `start` lance APRÈS avoir appelé le
  // rappel : rejouer une mise à jour d'état serait pire que pas d'animation.
  let ran = false;
  const guarded = () => { ran = true; run(); };
  try {
    start(guarded);
  } catch {
    if (!ran) run();
  }
}
