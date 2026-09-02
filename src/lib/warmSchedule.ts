// Ordonnancement de l'extraction de fond (« warm ») du contenu complet.
//
// Sur un flux à extraction automatique, FriRSS extrait la page en arrière-plan
// pour que l'article soit prêt AVANT que l'utilisateur ne l'ouvre. Ce travail
// est séquentiel, et il est précédé d'un délai d'installation : rien ne doit
// concurrencer le premier rendu de la vue.
//
// ⚠️ La décision « faut-il (re)partir de zéro ? » a longtemps tenu dans un
// simple compteur module : chaque appel incrémentait un jeton, ce qui annulait
// le run en vol. Cela convenait tant que le second appelant était rare — on ne
// repaginait qu'en descendant volontairement au bas de la liste. Le rattrapage
// de pagination (`listTopUp.ts`) a changé cela : il redemande une page à chaque
// retrait de ligne qui laisse la liste sans débordement. Sur un flux à
// extraction automatique, le run était donc annulé et relancé sans arrêt, en
// repayant deux secondes à chaque fois. Il ne prenait jamais d'avance, et
// l'article vers lequel on glissait arrivait en deux temps : le texte, puis
// l'image, qui poussait le texte vers le bas.
//
// D'où la règle : **seul un changement de VUE annule**. Un nouvel appel pour
// la même vue ÉTEND le travail en cours — ses articles rejoignent la file, un
// seul run travaille, et le délai d'installation se paie une fois par vue.
//
// L'identité de vue est celle de `viewIdentity()` dans `feedStore.ts` (flux,
// filtre, recherche) : la même notion que le rollback d'un retrait optimiste.

/** État du travail d'extraction, tel que le runner le tient. */
export interface WarmState {
  /** Vue à laquelle le travail en cours (ou le dernier) appartient. */
  view: string | null;
  /** Un run est-il encore en train de vider la file ? */
  running: boolean;
  /** Le délai d'installation a-t-il déjà été payé pour cette vue ? */
  settled: boolean;
  /** Ids déjà pris en charge pour cette vue — traités ou encore en file. */
  queued: readonly string[];
}

export type WarmPlan =
  /** Rien de neuf à extraire : ne toucher à rien. */
  | { action: 'idle' }
  /** Même vue, run en cours : ajouter à la file, sans second run ni délai. */
  | { action: 'extend'; add: string[]; queued: string[] }
  /** (Re)démarrer un run. `settle` dit si le délai d'installation est dû. */
  | { action: 'start'; add: string[]; queued: string[]; settle: boolean };

/**
 * Que faire d'une demande d'extraction de fond ?
 *
 * @param view Identité de la vue affichée (`viewIdentity`).
 * @param candidates Ids des articles éligibles, dans l'ordre de la liste.
 * @param state État courant du travail d'extraction.
 */
export function planWarmRun(opts: {
  view: string;
  candidates: readonly string[];
  state: WarmState;
}): WarmPlan {
  const { view, candidates, state } = opts;

  // Vue différente : on abandonne ce qui restait de la précédente. C'est la
  // raison d'être de l'annulation — sans elle, changer dix fois de flux
  // empilerait dix extractions parallèles. Le `start` est émis même sans
  // candidat, précisément pour que l'appelant annule le run en vol.
  if (state.view !== view) {
    const add = [...new Set(candidates)];
    return { action: 'start', add, queued: add, settle: true };
  }

  const known = new Set(state.queued);
  const add: string[] = [];
  for (const id of candidates) {
    if (known.has(id)) continue;
    known.add(id);
    add.push(id);
  }
  if (!add.length) return { action: 'idle' };

  const queued = [...state.queued, ...add];
  // Un run travaille encore : il prendra ces articles à la suite. Le relancer
  // ne ferait que le faire repartir de zéro.
  if (state.running) return { action: 'extend', add, queued };
  // Plus personne ne travaille : il faut bien repartir. Mais la vue est déjà
  // posée si le délai a été payé — le repayer retarderait pour rien.
  return { action: 'start', add, queued, settle: !state.settled };
}

/** Le strict minimum dont le runner a besoin d'un article. */
export interface WarmItem {
  id: string;
}

export interface WarmRunnerDeps<T extends WarmItem> {
  /** L'article est-il déjà extrait ? (cache mémoire puis persistant) */
  isCached: (item: T) => boolean | Promise<boolean>;
  /** Extraire l'article et l'archiver. Un rejet est absorbé par le runner. */
  extract: (item: T) => Promise<void>;
  /** Laisser la vue se poser avant la première extraction d'une vue. */
  settle: () => Promise<void>;
}

export interface WarmRunner<T extends WarmItem> {
  /**
   * Demander l'extraction de fond de `items` pour la vue `view`.
   *
   * La promesse retournée se résout quand le run correspondant a fini (ou
   * tout de suite si l'appel n'a fait qu'alimenter un run existant). Les
   * appelants applicatifs n'ont pas à l'attendre ; les tests, si.
   */
  schedule: (view: string, items: readonly T[]) => Promise<void>;
}

/**
 * Runner séquentiel : une extraction à la fois, la file se remplit en marche.
 *
 * Le jeton reste le mécanisme d'annulation, mais il n'est plus incrémenté
 * qu'aux `start` — c'est-à-dire, en pratique, aux changements de vue.
 */
export function createWarmRunner<T extends WarmItem>(deps: WarmRunnerDeps<T>): WarmRunner<T> {
  let token = 0;
  let state: WarmState & { queue: T[] } = {
    view: null, running: false, settled: false, queued: [], queue: [],
  };

  async function run(mine: number, settle: boolean): Promise<void> {
    if (settle) {
      await deps.settle();
      if (mine !== token) return; // une autre vue a pris la main entre-temps
      state.settled = true;
    }
    try {
      // La condition est relue à chaque tour : un `extend` survenu pendant une
      // extraction est pris en compte sans second run.
      while (state.queue.length) {
        if (mine !== token) return; // le run appartient à une vue quittée
        const item = state.queue.shift()!;
        if (await deps.isCached(item)) continue;
        try {
          await deps.extract(item);
        } catch { /* un échec ne dit rien des suivants : on continue */ }
      }
    } finally {
      // Ne rien écrire si la main est passée à une autre vue : `state` est
      // alors l'état de CE run-là, pas du nôtre.
      if (mine === token) state.running = false;
    }
  }

  return {
    schedule(view: string, items: readonly T[]): Promise<void> {
      const plan = planWarmRun({ view, candidates: items.map((i) => i.id), state });
      if (plan.action === 'idle') return Promise.resolve();

      const byId = new Map(items.map((i) => [i.id, i]));
      const add = plan.add.map((id) => byId.get(id)!);

      if (plan.action === 'extend') {
        state.queue.push(...add);
        state.queued = plan.queued;
        return Promise.resolve();
      }

      const mine = ++token; // annule le run de la vue précédente, s'il y en a un
      const sameView = state.view === view;
      state = {
        view,
        running: true,
        settled: sameView && state.settled,
        queued: plan.queued,
        // Même vue : le reliquat du run précédent est encore dû. Vue
        // différente : il part avec elle.
        queue: sameView ? [...state.queue, ...add] : add,
      };
      if (!state.queue.length) {
        state.running = false;
        return Promise.resolve();
      }
      return run(mine, plan.settle);
    },
  };
}
