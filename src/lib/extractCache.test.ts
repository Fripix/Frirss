import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ExtractRecord } from './extractStore';

// Le magasin IndexedDB remplacé par une table en mémoire : ce qui est testé
// ici, c'est la politique du cache (quoi servir, quoi garder), pas IndexedDB.
const rows = new Map<string, ExtractRecord>();
vi.mock('./extractStore', async (importActual) => {
  const actual = await importActual<typeof import('./extractStore')>();
  return {
    ...actual,
    dbGet: async (id: string) => rows.get(id),
    dbPut: async (rec: ExtractRecord) => { rows.set(rec.id, rec); },
    dbRecent: async (limit: number) => [...rows.values()].sort((a, b) => b.cachedAt - a.cachedAt).slice(0, limit),
    dbEvictOlderThan: async () => {},
  };
});

const extractFullContent = vi.fn();
vi.mock('../utils/extractContent', () => ({ extractFullContent: (url: string) => extractFullContent(url) }));

const { revalidateIfStale, getExtract, putExtract, peekExtract, hydrateExtractCache } = await import('./extractCache');
const { EXTRACT_VERSION } = await import('./extractVersion');

const body = { title: 'T', content: '<p>fragment</p>', excerpt: '', byline: '', siteName: '', length: 8 };
/** Un extrait gardé avant la version courante de l'extraction (sans tampon, comme avant A-2). */
const outdated = (id: string, pinned = false): ExtractRecord => ({ ...body, id, cachedAt: Date.now(), pinned, ...(pinned ? { pinScopes: ['u@s'] } : {}) });

afterEach(() => { vi.unstubAllGlobals(); });

// A-2 (campagne 1.9.0) : l'avis tronqué d'avant L-04/A-1 restait servi tant
// qu'il était en cache — 30 jours, et sans limite pour un article épinglé.
describe('extractCache — version de l’extraction', () => {
  it('ne sert plus, en ligne, un extrait d’une version antérieure', async () => {
    rows.set('a1', outdated('a1'));
    expect(await getExtract('a1')).toBeUndefined();
  });

  it('le sert encore hors ligne : mieux qu’aucun article', async () => {
    rows.set('a2', outdated('a2', true));
    vi.stubGlobal('navigator', { onLine: false });
    expect((await getExtract('a2'))?.content).toBe('<p>fragment</p>');
    // …sans le promouvoir en mémoire, d'où il serait resservi une fois en ligne.
    expect(peekExtract('a2')).toBeUndefined();
  });

  it('garde l’extrait épinglé jusqu’à ce qu’un nouveau le remplace, épinglage compris', async () => {
    rows.set('a3', outdated('a3', true));
    await getExtract('a3');
    expect(rows.get('a3')).toBeDefined();
    await putExtract('a3', { ...body, content: '<p>avis complet</p>' });
    expect(rows.get('a3')).toMatchObject({ pinned: true, pinScopes: ['u@s'], extractVersion: EXTRACT_VERSION });
    expect((await getExtract('a3'))?.content).toBe('<p>avis complet</p>');
  });

  it('ne réchauffe pas la mémoire avec un extrait d’une version antérieure', async () => {
    rows.set('a4', outdated('a4'));
    rows.set('a5', { ...outdated('a5'), extractVersion: EXTRACT_VERSION });
    await hydrateExtractCache();
    expect(peekExtract('a4')).toBeUndefined();
    expect(peekExtract('a5')).toBeDefined();
  });

  it('réextrait un extrait d’une version antérieure même récent, et le retamponne', async () => {
    rows.set('a6', outdated('a6'));
    extractFullContent.mockResolvedValueOnce(body); // même texte : seule la fraîcheur bouge
    await revalidateIfStale('a6', 'https://example.com/a6');
    expect(extractFullContent).toHaveBeenCalledWith('https://example.com/a6');
    expect(rows.get('a6')?.extractVersion).toBe(EXTRACT_VERSION);
  });
});
