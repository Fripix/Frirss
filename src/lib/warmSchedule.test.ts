import { describe, it, expect, vi } from 'vitest';
import { planWarmRun, createWarmRunner, type WarmState } from './warmSchedule';

const idle: WarmState = { view: null, running: false, settled: false, queued: [] };

describe('planWarmRun', () => {
  it('démarre un run et paie l’installation quand la vue change', () => {
    expect(planWarmRun({ view: 'feed/1:unread:', candidates: ['a', 'b'], state: idle }))
      .toEqual({ action: 'start', add: ['a', 'b'], queued: ['a', 'b'], settle: true });
  });

  // Le cœur de la régression : le rattrapage de pagination rappelle
  // `warmExtracts` pour la MÊME vue. Redémarrer annulait le run en vol et
  // repayait deux secondes ; il ne prenait jamais d'avance.
  it('étend le run en cours quand la vue n’a pas changé', () => {
    const state: WarmState = { view: 'v', running: true, settled: true, queued: ['a', 'b'] };
    expect(planWarmRun({ view: 'v', candidates: ['a', 'b', 'c'], state }))
      .toEqual({ action: 'extend', add: ['c'], queued: ['a', 'b', 'c'] });
  });

  it('ne fait rien quand la même vue n’apporte aucun nouvel article', () => {
    const state: WarmState = { view: 'v', running: true, settled: true, queued: ['a', 'b'] };
    expect(planWarmRun({ view: 'v', candidates: ['a', 'b'], state })).toEqual({ action: 'idle' });
  });

  // Le run précédent a fini : il faut bien en relancer un, mais la vue est
  // posée depuis longtemps — le délai d'installation n'a plus de raison d'être.
  it('relance sans repayer l’installation quand le run précédent a fini', () => {
    const state: WarmState = { view: 'v', running: false, settled: true, queued: ['a'] };
    expect(planWarmRun({ view: 'v', candidates: ['a', 'b'], state }))
      .toEqual({ action: 'start', add: ['b'], queued: ['a', 'b'], settle: false });
  });

  // Une vue « Tous les articles » peut n'avoir aucun flux à extraire sur sa
  // première page et en apporter à la deuxième : l'installation n'a alors
  // jamais été payée, et elle est encore due.
  it('paie l’installation si la vue ne l’a jamais payée', () => {
    const state: WarmState = { view: 'v', running: false, settled: false, queued: [] };
    expect(planWarmRun({ view: 'v', candidates: ['a'], state }))
      .toEqual({ action: 'start', add: ['a'], queued: ['a'], settle: true });
  });

  // Changer de vue doit annuler le run en vol même quand la nouvelle vue n'a
  // rien à extraire : c'est la raison d'être du jeton (« ne pas empiler des
  // dizaines de requêtes parallèles »).
  it('démarre quand même sur une vue sans candidat, pour annuler le run en vol', () => {
    const state: WarmState = { view: 'v', running: true, settled: true, queued: ['a'] };
    expect(planWarmRun({ view: 'w', candidates: [], state }))
      .toEqual({ action: 'start', add: [], queued: [], settle: true });
  });

  it('dédoublonne les candidats d’un même appel', () => {
    expect(planWarmRun({ view: 'v', candidates: ['a', 'a', 'b'], state: idle }))
      .toEqual({ action: 'start', add: ['a', 'b'], queued: ['a', 'b'], settle: true });
  });
});

/**
 * Jeu de dépendances instrumenté : compte les installations, enregistre
 * l'ordre des extractions, et signale tout recouvrement (deux extractions en
 * vol en même temps). En mode `holdExtractions`, chaque extraction attend
 * d'être libérée à la main, ce qui permet de tester l'état « run en cours ».
 */
function harness(opts: { cached?: string[] } = {}) {
  const cached = new Set(opts.cached || []);
  const extracted: string[] = [];
  const overlaps: string[] = [];
  const failures = new Set<string>();
  const releases = new Map<string, () => void>();
  let inFlight = 0;
  let hold = false;

  const deps = {
    isCached: (item: { id: string }) => cached.has(item.id),
    extract: async (item: { id: string }) => {
      if (inFlight > 0) overlaps.push(item.id);
      inFlight++;
      try {
        if (hold) await new Promise<void>((r) => releases.set(item.id, r));
        extracted.push(item.id);
        if (failures.has(item.id)) throw new Error('extraction refusée');
      } finally {
        inFlight--;
      }
    },
    settle: vi.fn(() => Promise.resolve()),
  };

  /** Attend que l'extraction de `id` soit effectivement en vol. */
  const started = async (id: string) => {
    for (let i = 0; i < 100 && !releases.has(id); i++) await Promise.resolve();
    if (!releases.has(id)) throw new Error(`extraction jamais lancée pour ${id}`);
  };

  return {
    deps, extracted, overlaps, failures, started,
    holdExtractions: () => { hold = true; },
    release: async (id: string) => {
      await started(id);
      const r = releases.get(id)!;
      releases.delete(id);
      r();
      await Promise.resolve();
    },
  };
}

const rows = (...ids: string[]) => ids.map((id) => ({ id }));

describe('createWarmRunner', () => {
  it('extrait toute la file, dans l’ordre et une seule à la fois', async () => {
    const h = harness();
    await createWarmRunner(h.deps).schedule('v', rows('a', 'b', 'c'));
    expect(h.extracted).toEqual(['a', 'b', 'c']);
    expect(h.overlaps).toEqual([]);
  });

  it('saute ce qui est déjà en cache', async () => {
    const h = harness({ cached: ['b'] });
    await createWarmRunner(h.deps).schedule('v', rows('a', 'b', 'c'));
    expect(h.extracted).toEqual(['a', 'c']);
  });

  // Le refus d'une extraction ne dit rien des suivantes.
  it('un échec n’arrête pas les extractions suivantes', async () => {
    const h = harness();
    h.failures.add('b');
    await createWarmRunner(h.deps).schedule('v', rows('a', 'b', 'c'));
    expect(h.extracted).toEqual(['a', 'b', 'c']);
  });

  // La régression signalée depuis l'iPhone : sur un flux à extraction
  // automatique, le rattrapage de pagination rappelait `warmExtracts` pour la
  // même vue à chaque retrait de ligne. L'installation était repayée à chaque
  // fois et le run repartait de zéro ; l'article suivant n'était jamais prêt.
  it('un second appel sur la MÊME vue ne relance rien et ne repaie pas l’installation', async () => {
    const h = harness();
    h.holdExtractions();
    const runner = createWarmRunner(h.deps);
    const run = runner.schedule('v', rows('a', 'b'));
    await h.started('a');

    await runner.schedule('v', rows('a', 'b', 'c'));
    expect(h.deps.settle).toHaveBeenCalledTimes(1);
    expect(h.extracted).toEqual([]); // « a » est toujours en vol : rien n'a repris à zéro

    await h.release('a');
    await h.release('b');
    await h.release('c');
    await run;
    expect(h.extracted).toEqual(['a', 'b', 'c']);
    expect(h.overlaps).toEqual([]);
    expect(h.deps.settle).toHaveBeenCalledTimes(1);
  });

  // Corollaire : les articles apportés par la page suivante doivent bien être
  // extraits, sans qu'un second run parallèle soit lancé pour eux.
  it('un second appel sur la même vue fait extraire ses nouveaux articles', async () => {
    const h = harness();
    const runner = createWarmRunner(h.deps);
    await runner.schedule('v', rows('a'));
    await runner.schedule('v', rows('a', 'b'));
    expect(h.extracted).toEqual(['a', 'b']);
    expect(h.overlaps).toEqual([]);
  });

  // Ce que le jeton protège depuis toujours : quitter la vue arrête le travail
  // engagé pour elle, sinon on empile des dizaines de requêtes parallèles.
  it('un appel sur une AUTRE vue annule le run en vol', async () => {
    const h = harness();
    h.holdExtractions();
    const runner = createWarmRunner(h.deps);
    const run = runner.schedule('v', rows('a', 'b', 'c'));
    await h.started('a');

    const next = runner.schedule('w', rows('x'));
    await h.release('a');
    await run;
    expect(h.extracted).toEqual(['a']); // « b » et « c » partent avec leur vue

    await h.release('x');
    await next;
    expect(h.extracted).toEqual(['a', 'x']);
    expect(h.deps.settle).toHaveBeenCalledTimes(2); // une installation par vue
  });

  it('une vue sans article à extraire annule quand même le run en vol', async () => {
    const h = harness();
    h.holdExtractions();
    const runner = createWarmRunner(h.deps);
    const run = runner.schedule('v', rows('a', 'b'));
    await h.started('a');

    await runner.schedule('w', []);
    await h.release('a');
    await run;
    expect(h.extracted).toEqual(['a']);
  });
});
