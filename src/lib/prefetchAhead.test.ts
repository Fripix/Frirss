import { describe, it, expect, vi } from 'vitest';
import {
  PREFETCH_AHEAD_WINDOW, planPrefetchAhead, runPrefetchAhead,
  type PrefetchItem, type PrefetchAheadDeps,
} from './prefetchAhead';

const MB = 1024 * 1024;

const img = (n: number) => `<img src="https://cdn.example/${n}.jpg">`;
const body = (n: number) => Array.from({ length: n }, (_, i) => img(i)).join('');

function item(i: number, over: Partial<PrefetchItem> = {}): PrefetchItem {
  return {
    id: `a${i}`,
    url: `https://example.com/${i}`,
    sourceId: 'feed/1',
    content: body(3),
    ...over,
  };
}

const list = (n: number) => Array.from({ length: n }, (_, i) => item(i));

const auto = () => true;

// Dépendances par défaut : rien n'est en cache, tout s'extrait, tout se met en
// cache pour 1 Mo. Chaque test ne surcharge que ce qu'il observe.
function deps(over: Partial<PrefetchAheadDeps> = {}): PrefetchAheadDeps {
  return {
    budget: { bytes: 100 * MB, perArticle: 6 },
    cachedExtract: async () => null,
    extract: async () => '<p>extrait</p>',
    cacheImages: async () => ({ bytes: MB }),
    cancelled: () => false,
    ...over,
  };
}

describe('planPrefetchAhead', () => {
  it('retient les dix articles qui suivent celui qui est ouvert', () => {
    const articles = list(30);
    const plan = planPrefetchAhead({ articles, currentId: 'a5', autoExtract: auto });
    expect(PREFETCH_AHEAD_WINDOW).toBe(10);
    expect(plan.map((a) => a.id)).toEqual(
      ['a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15'],
    );
  });

  it('s’arrête au bas de la liste sans se replier sur le début', () => {
    const plan = planPrefetchAhead({ articles: list(8), currentId: 'a5', autoExtract: auto });
    expect(plan.map((a) => a.id)).toEqual(['a6', 'a7']);
  });

  it('ignore les articles sans URL ou dont le flux n’extrait pas', () => {
    const articles = [
      item(0),
      item(1, { url: '' }),
      item(2, { sourceId: 'feed/2' }),
      item(3),
    ];
    const plan = planPrefetchAhead({
      articles,
      currentId: 'a0',
      autoExtract: (sourceId) => sourceId === 'feed/1',
    });
    expect(plan.map((a) => a.id)).toEqual(['a3']);
  });

  it('ne rend rien quand l’article ouvert n’est plus dans la liste', () => {
    expect(planPrefetchAhead({ articles: list(5), currentId: 'zz', autoExtract: auto })).toEqual([]);
  });
});

describe('runPrefetchAhead', () => {
  it('extrait sans toucher aux images quand le budget est nul', async () => {
    const extract = vi.fn(async () => '<p>extrait</p>');
    const cacheImages = vi.fn(async () => ({ bytes: MB }));
    const res = await runPrefetchAhead(
      list(3),
      deps({ budget: { bytes: 0, perArticle: 0 }, extract, cacheImages }),
    );
    expect(extract).toHaveBeenCalledTimes(3);
    expect(cacheImages).not.toHaveBeenCalled();
    expect(res.imagesRequested).toBe(0);
  });

  // Le preset « aucune » annule les deux moitiés du budget à la fois ; on
  // épingle chacune séparément, sinon un seul des deux garde-fous suffirait à
  // garder le test vert et l'autre pourrait disparaître sans bruit.
  it('coupe les images sur le seul budget d’octets nul', async () => {
    const cacheImages = vi.fn(async () => ({ bytes: MB }));
    await runPrefetchAhead(list(3), deps({ budget: { bytes: 0, perArticle: 6 }, cacheImages }));
    expect(cacheImages).not.toHaveBeenCalled();
  });

  it('respecte le nombre d’images par article', async () => {
    const cacheImages = vi.fn(async (_urls: string[]) => ({ bytes: MB }));
    await runPrefetchAhead(
      [item(0, { content: body(8) })],
      deps({ budget: { bytes: 100 * MB, perArticle: 3 }, extract: async () => body(8), cacheImages }),
    );
    expect(cacheImages).toHaveBeenCalledTimes(1);
    expect(cacheImages.mock.calls[0][0]).toHaveLength(3);
  });

  it('arrête les images dès que le budget d’octets est atteint, sans arrêter l’extraction', async () => {
    const extract = vi.fn(async () => '<p>extrait</p>');
    const cacheImages = vi.fn(async () => ({ bytes: 2 * MB }));
    const res = await runPrefetchAhead(
      list(4),
      deps({ budget: { bytes: MB, perArticle: 6 }, extract, cacheImages }),
    );
    expect(cacheImages).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledTimes(4);
    expect(res.budgetStopped).toBe(true);
  });

  // Le piège de la version précédente : le filtre « déjà extrait » écartait
  // l'article entier, images comprises.
  it('précharge les images d’un article dont l’extrait est déjà en cache', async () => {
    const extract = vi.fn(async () => '<p>extrait</p>');
    const cacheImages = vi.fn(async () => ({ bytes: MB }));
    await runPrefetchAhead(
      [item(0)],
      deps({ cachedExtract: async () => body(2), extract, cacheImages }),
    );
    expect(extract).not.toHaveBeenCalled();
    expect(cacheImages).toHaveBeenCalledTimes(1);
  });

  it('s’arrête net quand le run est annulé', async () => {
    let done = 0;
    const extract = vi.fn(async () => { done++; return '<p>extrait</p>'; });
    await runPrefetchAhead(
      list(5),
      deps({ extract, cancelled: () => done >= 2 }),
    );
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it('un échec d’images n’empêche pas les articles suivants', async () => {
    const cacheImages = vi.fn()
      .mockRejectedValueOnce(new Error('réseau'))
      .mockResolvedValue({ bytes: MB });
    const res = await runPrefetchAhead(list(3), deps({ cacheImages }));
    expect(cacheImages).toHaveBeenCalledTimes(3);
    expect(res.imagesBytes).toBe(2 * MB);
  });

  it('un échec d’extraction n’empêche ni les images ni la suite', async () => {
    const extract = vi.fn()
      .mockRejectedValueOnce(new Error('proxy'))
      .mockResolvedValue('<p>extrait</p>');
    const cacheImages = vi.fn(async () => ({ bytes: MB }));
    const res = await runPrefetchAhead(list(3), deps({ extract, cacheImages }));
    expect(cacheImages).toHaveBeenCalledTimes(3);
    expect(res.extracted).toBe(2);
  });

  it('travaille un article à la fois', async () => {
    let inFlight = 0;
    let peak = 0;
    const extract = vi.fn(async () => {
      peak = Math.max(peak, ++inFlight);
      await Promise.resolve();
      inFlight--;
      return '<p>extrait</p>';
    });
    await runPrefetchAhead(list(4), deps({ extract }));
    expect(peak).toBe(1);
  });
});
