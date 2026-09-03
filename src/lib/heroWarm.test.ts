import { describe, it, expect, vi } from 'vitest';
import {
  planHeroWarm,
  runHeroWarm,
  HERO_WARM_AHEAD,
  HERO_WARM_CONCURRENCY,
  type HeroWarmItem,
  type HeroWarmDeps,
} from './heroWarm';

const art = (id: string, content: string): HeroWarmItem => ({ id, content });
const img = (u: string) => `<img src="${u}">`;

describe('planHeroWarm', () => {
  const list = [
    art('a', img('https://ex.com/a.jpg')),
    art('b', img('https://ex.com/b.jpg')),
    art('c', img('https://ex.com/c.jpg')),
    art('d', img('https://ex.com/d.jpg')),
  ];

  it('ne prend que les articles APRÈS celui qui est ouvert', () => {
    expect(planHeroWarm({ articles: list, currentId: 'b' })).toEqual([
      { id: 'c', url: 'https://ex.com/c.jpg' },
      { id: 'd', url: 'https://ex.com/d.jpg' },
    ]);
  });

  it('s’arrête à la fenêtre demandée', () => {
    expect(planHeroWarm({ articles: list, currentId: 'a', ahead: 2 })).toHaveLength(2);
  });

  it('ouvre dix articles par défaut', () => {
    expect(HERO_WARM_AHEAD).toBe(10);
    const many = Array.from({ length: 30 }, (_, i) => art(`x${i}`, img(`https://ex.com/${i}.jpg`)));
    expect(planHeroWarm({ articles: many, currentId: 'x0' })).toHaveLength(10);
  });

  it('ne garde que la PREMIÈRE image de chaque article', () => {
    const plan = planHeroWarm({
      articles: [art('a', ''), art('b', img('https://ex.com/1.jpg') + img('https://ex.com/2.jpg'))],
      currentId: 'a',
    });
    expect(plan).toEqual([{ id: 'b', url: 'https://ex.com/1.jpg' }]);
  });

  it('saute les articles sans image réseau', () => {
    const plan = planHeroWarm({
      articles: [
        art('a', ''),
        art('b', '<p>que du texte</p>'),
        art('c', img('data:image/png;base64,AAA')),
        art('d', img('/relative.jpg')),
        art('e', img('https://ex.com/e.jpg')),
      ],
      currentId: 'a',
    });
    expect(plan).toEqual([{ id: 'e', url: 'https://ex.com/e.jpg' }]);
  });

  it('dédoublonne une image partagée par deux articles', () => {
    const plan = planHeroWarm({
      articles: [art('a', ''), art('b', img('https://ex.com/x.jpg')), art('c', img('https://ex.com/x.jpg'))],
      currentId: 'a',
    });
    expect(plan).toEqual([{ id: 'b', url: 'https://ex.com/x.jpg' }]);
  });

  it('décode l’URL échappée pour que le navigateur demande la bonne', () => {
    const plan = planHeroWarm({
      articles: [art('a', ''), art('b', img('https://ex.com/x.jpg?w=1&amp;h=2'))],
      currentId: 'a',
    });
    expect(plan[0].url).toBe('https://ex.com/x.jpg?w=1&h=2');
  });

  it('renvoie une liste vide si l’article ouvert n’est plus dans la liste', () => {
    expect(planHeroWarm({ articles: list, currentId: 'zzz' })).toEqual([]);
  });
});

describe('runHeroWarm', () => {
  const deps = (over: Partial<HeroWarmDeps> = {}): HeroWarmDeps & { warmed: string[] } => {
    const warmed: string[] = [];
    return {
      warmed,
      isCached: async () => false,
      warm: async (u: string) => { warmed.push(u); return { width: 100, height: 50 }; },
      remember: () => {},
      cancelled: () => false,
      ...over,
    };
  };

  const targets = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `a${i}`, url: `https://ex.com/${i}.jpg` }));

  it('réchauffe chaque image et enregistre sa mesure', async () => {
    const remember = vi.fn();
    const d = deps({ remember });
    const res = await runHeroWarm(targets(3), d);
    expect(d.warmed).toHaveLength(3);
    expect(res.warmed).toBe(3);
    expect(remember).toHaveBeenCalledWith('https://ex.com/0.jpg', { width: 100, height: 50 });
  });

  it('saute ce que le cache d’images détient déjà', async () => {
    const d = deps({ isCached: async (u) => u.endsWith('1.jpg') });
    const res = await runHeroWarm(targets(3), d);
    expect(d.warmed).toEqual(['https://ex.com/0.jpg', 'https://ex.com/2.jpg']);
    expect(res.skipped).toBe(1);
  });

  it('ne dépasse jamais le plafond de requêtes simultanées', async () => {
    let live = 0;
    let peak = 0;
    const d = deps({
      warm: async () => {
        live++; peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 1));
        live--;
        return { width: 10, height: 10 };
      },
    });
    await runHeroWarm(targets(10), d);
    expect(peak).toBeLessThanOrEqual(HERO_WARM_CONCURRENCY);
    expect(HERO_WARM_CONCURRENCY).toBeLessThanOrEqual(3);
  });

  it('un échec n’arrête pas les autres, et rien n’est réessayé', async () => {
    const d = deps({
      warm: async (u) => {
        if (u.endsWith('1.jpg')) throw new Error('403');
        return { width: 10, height: 10 };
      },
    });
    const res = await runHeroWarm(targets(4), d);
    expect(res.warmed).toBe(3);
    expect(res.failed).toBe(1);
  });

  it('une image sans mesure exploitable compte comme un échec, sans mémoire', async () => {
    const remember = vi.fn();
    const res = await runHeroWarm(targets(2), deps({ warm: async () => null, remember }));
    expect(res.warmed).toBe(0);
    expect(res.failed).toBe(2);
    expect(remember).not.toHaveBeenCalled();
  });

  it('un cache illisible ne fait pas tomber le réchauffage', async () => {
    const d = deps({ isCached: async () => { throw new Error('no caches'); } });
    const res = await runHeroWarm(targets(2), d);
    expect(res.warmed).toBe(2);
  });

  it('s’arrête net dès que le balayage reprend', async () => {
    let cancel = false;
    const d = deps({
      cancelled: () => cancel,
      warm: async (u: string) => { cancel = true; return { width: 10, height: 10, u } as never; },
    });
    const res = await runHeroWarm(targets(8), d);
    // Au plus une vague de HERO_WARM_CONCURRENCY requêtes est déjà partie.
    expect(res.warmed + res.skipped + res.failed).toBeLessThanOrEqual(HERO_WARM_CONCURRENCY);
  });

  it('ne fait rien du tout sur un plan vide', async () => {
    const d = deps();
    const res = await runHeroWarm([], d);
    expect(res).toEqual({ warmed: 0, skipped: 0, failed: 0 });
    expect(d.warmed).toEqual([]);
  });
});
