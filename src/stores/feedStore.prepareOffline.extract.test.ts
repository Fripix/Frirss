// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/*
 * Préparation hors ligne : ce qu'elle extrait (L-05), et comment on l'arrête
 * ou on sait combien de temps elle prendra (Idées « Annuler » et
 * « estimation », campagne 1.9.0).
 */

const extract = vi.hoisted(() => ({ fn: vi.fn() }));

vi.mock('../api/feeds', async () => {
  const actual = await vi.importActual<typeof import('../api/feeds')>('../api/feeds');
  return { ...actual, getStreamContents: vi.fn() };
});
vi.mock('../lib/offlineStore', async () => {
  const actual = await vi.importActual<typeof import('../lib/offlineStore')>('../lib/offlineStore');
  return { ...actual, listPut: vi.fn(async () => {}) };
});
vi.mock('../lib/offlineImages', async () => {
  const actual = await vi.importActual<typeof import('../lib/offlineImages')>('../lib/offlineImages');
  return { ...actual, imageBudget: vi.fn(() => ({ bytes: 0, perArticle: 0 })) };
});
vi.mock('../lib/storageEstimate', async () => {
  const actual = await vi.importActual<typeof import('../lib/storageEstimate')>('../lib/storageEstimate');
  return { ...actual, getStorageEstimate: vi.fn(async () => null) };
});
vi.mock('../lib/imageCache', () => ({ cacheImages: vi.fn(), pruneImages: vi.fn(async () => 0) }));
vi.mock('../lib/extractStore', () => ({
  dbGet: vi.fn(() => Promise.resolve(undefined)), dbPut: vi.fn(() => Promise.resolve()),
  dbRecent: vi.fn(() => Promise.resolve([])), dbEvictOlderThan: vi.fn(() => Promise.resolve()),
  dbSetPinned: vi.fn(() => Promise.resolve()), dbUnpinExcept: vi.fn(() => Promise.resolve()),
}));
vi.mock('../utils/extractContent', async (orig) => ({
  ...(await orig<typeof import('../utils/extractContent')>()),
  extractFullContent: (...args: unknown[]) => extract.fn(...args),
}));
vi.mock('../i18n', () => ({ default: { t: (k: string) => k } }));

import { getStreamContents } from '../api/feeds';
import { useFeedStore } from './feedStore';
import { useUiStore } from './uiStore';
import { ExtractorBusyError, ExtractTimeoutError } from '../utils/extractContent';
import { PREP_BUSY_RETRY_DELAYS_MS } from '../lib/prepBusyRetry';

const now = Math.floor(Date.now() / 1000);
let seq = 0;
const item = (feed: string) => {
  seq++;
  return {
    id: `tag:google.com,2005:reader/item/${String(seq).padStart(16, '0')}`, published: now,
    origin: { streamId: feed, title: feed }, alternate: [{ href: `https://example.com/${feed}/${seq}` }],
    content: { content: '<p>rss</p>' },
  };
};
const extracted = (url: string) => ({ title: '', content: `<p>${url}</p>`, excerpt: '', byline: '', siteName: '', length: 1 });

beforeEach(() => {
  vi.clearAllMocks();
  extract.fn.mockReset();
  extract.fn.mockImplementation(async (url: string) => extracted(url));
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  vi.mocked(getStreamContents).mockImplementation(async (feed: string) => ({ items: [item(feed), item(feed)], continuation: null }) as never);
  useFeedStore.setState({
    offlinePrep: null,
    subscriptions: [{ id: 'feed/1', title: 'Non' } as never, { id: 'feed/2', title: 'Oui' } as never, { id: 'feed/3', title: 'Défaut' } as never],
  });
});

const extractedFeeds = () => extract.fn.mock.calls.map(([url]) => String(url).split('/')[3]).sort();

describe('L-05 — la préparation hors ligne respecte « Article complet »', () => {
  it('global éteint : n’extrait que les flux réglés sur Oui', async () => {
    useUiStore.setState({ autoExtractDefault: false, feedSettings: { 'feed/1': { autoExtract: false }, 'feed/2': { autoExtract: true } } } as never);
    await useFeedStore.getState().prepareOffline();
    expect(extractedFeeds()).toEqual(['feed', 'feed']);
    expect(extract.fn.mock.calls.every(([u]) => String(u).includes('/feed/2/'))).toBe(true);
  });

  it('global allumé : extrait tout sauf les flux réglés sur Non', async () => {
    useUiStore.setState({ autoExtractDefault: true, feedSettings: { 'feed/1': { autoExtract: false } } } as never);
    await useFeedStore.getState().prepareOffline();
    const urls = extract.fn.mock.calls.map(([u]) => String(u));
    expect(urls).toHaveLength(4);
    expect(urls.some((u) => u.includes('/feed/1/'))).toBe(false);
  });
});

describe('Annuler une préparation (idée 1.9.0)', () => {
  beforeEach(() => {
    useUiStore.setState({ autoExtractDefault: true, feedSettings: {} } as never);
  });

  it('s’arrête après l’article en cours, sans balayage final, et le dit', async () => {
    extract.fn.mockImplementation(async (url: string) => {
      useFeedStore.getState().cancelOfflinePrep();
      return extracted(url);
    });
    await useFeedStore.getState().prepareOffline();
    expect(extract.fn).toHaveBeenCalledTimes(1);
    const prep = useFeedStore.getState().offlinePrep!;
    expect(prep.running).toBe(false);
    expect(prep.cancelled).toBe(true);
    expect(prep.done).toBe(1);
    expect(prep.total).toBe(6);
    const { pruneImages } = await import('../lib/imageCache');
    expect(pruneImages).not.toHaveBeenCalled();
  });

  it('s’arrête aussi pendant la lecture des listes', async () => {
    vi.mocked(getStreamContents).mockImplementation(async (feed: string) => {
      useFeedStore.getState().cancelOfflinePrep();
      return { items: [item(feed)], continuation: null } as never;
    });
    await useFeedStore.getState().prepareOffline();
    expect(getStreamContents).toHaveBeenCalledTimes(1);
    expect(extract.fn).not.toHaveBeenCalled();
    expect(useFeedStore.getState().offlinePrep?.cancelled).toBe(true);
  });

  it('« Annuler » pendant le dernier article : la préparation est allée au bout, pas annulée', async () => {
    let calls = 0;
    extract.fn.mockImplementation(async (url: string) => {
      if (++calls === 6) useFeedStore.getState().cancelOfflinePrep();
      return extracted(url);
    });
    await useFeedStore.getState().prepareOffline();
    const prep = useFeedStore.getState().offlinePrep!;
    expect(prep.done).toBe(6);
    expect(prep.cancelled).toBeFalsy();
  });

  it('une annulation ne survit pas à la préparation suivante', async () => {
    useFeedStore.getState().cancelOfflinePrep(); // rien ne tourne : sans effet
    await useFeedStore.getState().prepareOffline();
    expect(extract.fn).toHaveBeenCalledTimes(6);
    expect(useFeedStore.getState().offlinePrep?.cancelled).toBeFalsy();
  });

  it('date le début de la phase des articles, pour l’estimation', async () => {
    const seen: (number | undefined)[] = [];
    extract.fn.mockImplementation(async (url: string) => {
      seen.push(useFeedStore.getState().offlinePrep?.startedAt);
      return extracted(url);
    });
    const before = Date.now();
    await useFeedStore.getState().prepareOffline();
    expect(seen[0]).toBeGreaterThanOrEqual(before);
    expect(new Set(seen).size).toBe(1);
  });
});

// M-03 (second round) : l'extrait d'une version antérieure n'était plus lu par
// la préparation ; sa réextraction échouait, et ses images, absentes de la
// liste gardée, partaient au balayage final — alors que l'extrait, lui, reste
// servi hors ligne.
describe('M-03 — extrait d’une version antérieure, réextraction en échec', () => {
  it('ses images sont préparées et gardées comme celles d’un extrait courant', async () => {
    useUiStore.setState({ autoExtractDefault: true, feedSettings: {} } as never);
    useFeedStore.setState({ subscriptions: [{ id: 'feed/9', title: 'Épinglé' } as never] });
    const { imageBudget } = await import('../lib/offlineImages');
    vi.mocked(imageBudget).mockReturnValueOnce({ bytes: 1e9, perArticle: 10 });
    const { cacheImages } = await import('../lib/imageCache');
    vi.mocked(cacheImages).mockImplementation(async (urls: string[]) => ({ stored: urls.length, bytes: 0, reusedBytes: 0, kept: urls, sizes: {}, failed: 0 }) as never);
    const { dbGet } = await import('../lib/extractStore');
    const old = { title: '', content: '<p>texte</p><img src="https://img.example.com/ancien.jpg">', excerpt: '', byline: '', siteName: '', length: 5, cachedAt: Date.now(), pinned: true };
    vi.mocked(dbGet).mockImplementation(async (id: string) => ({ ...old, id }) as never);
    extract.fn.mockRejectedValue(new Error('NO_CONTENT'));
    try {
      await useFeedStore.getState().prepareOffline();
      const urls = vi.mocked(cacheImages).mock.calls.flatMap(([u]) => u as string[]);
      expect(urls).toContain('https://img.example.com/ancien.jpg');
      // Il s'ouvre sur cet extrait : il ne manque pas d'article complet.
      expect(useFeedStore.getState().offlinePrep!.missingFull).toBe(0);
    } finally {
      vi.mocked(dbGet).mockImplementation(() => Promise.resolve(undefined));
    }
  });

  // Relecture R2-6 : un flux réglé « Article complet : Non » s'ouvre sur le
  // contenu du flux, jamais sur l'ancien extrait. La préparation le lisait
  // quand même, et en gardait les images.
  it('flux réglé « Non » : l’ancien extrait n’est pas lu, ses images ne sont pas gardées', async () => {
    useUiStore.setState({ autoExtractDefault: true, feedSettings: { 'feed/9': { autoExtract: false } } } as never);
    useFeedStore.setState({ subscriptions: [{ id: 'feed/9', title: 'Non' } as never] });
    const { imageBudget } = await import('../lib/offlineImages');
    vi.mocked(imageBudget).mockReturnValueOnce({ bytes: 1e9, perArticle: 10 });
    const { cacheImages } = await import('../lib/imageCache');
    vi.mocked(cacheImages).mockImplementation(async (urls: string[]) => ({ stored: urls.length, bytes: 0, reusedBytes: 0, kept: urls, sizes: {}, failed: 0 }) as never);
    const { dbGet } = await import('../lib/extractStore');
    const old = { title: '', content: '<p>texte</p><img src="https://img.example.com/ancien.jpg">', excerpt: '', byline: '', siteName: '', length: 5, cachedAt: Date.now(), pinned: true };
    vi.mocked(dbGet).mockImplementation(async (id: string) => ({ ...old, id }) as never);
    try {
      await useFeedStore.getState().prepareOffline();
      const urls = vi.mocked(cacheImages).mock.calls.flatMap(([u]) => u as string[]);
      expect(urls).not.toContain('https://img.example.com/ancien.jpg');
      expect(extract.fn).not.toHaveBeenCalled();
    } finally {
      vi.mocked(dbGet).mockImplementation(() => Promise.resolve(undefined));
    }
  });
});

// Limites restantes du second round : un article refusé par l'extracteur du
// serveur parce que sa file était pleine (503 `busy`) restait sans article
// complet jusqu'à la préparation suivante. Il est redemandé en fin de passage,
// après une attente courte et croissante, deux fois au plus.
describe('préparation : articles refusés pour occupation, redemandés en fin de passage', () => {
  beforeEach(() => {
    useUiStore.setState({ autoExtractDefault: true, feedSettings: {} } as never);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });
  afterEach(() => { vi.useRealTimers(); });

  /** Le premier article demandé est refusé `times` fois, les autres jamais. */
  const busyFirst = (times: number) => {
    const calls: Array<{ url: string; at: number }> = [];
    extract.fn.mockImplementation(async (url: string) => {
      calls.push({ url, at: Date.now() });
      if (url === calls[0].url && calls.filter((c) => c.url === url).length <= times) throw new ExtractorBusyError();
      return extracted(url);
    });
    return calls;
  };

  it('un article refusé est redemandé après les autres, et son extrait est gardé', async () => {
    const calls = busyFirst(1);
    const run = useFeedStore.getState().prepareOffline();
    await vi.advanceTimersByTimeAsync(PREP_BUSY_RETRY_DELAYS_MS[0]);
    await run;
    expect(calls).toHaveLength(7);
    expect(calls[6].url).toBe(calls[0].url);
    const { dbPut } = await import('../lib/extractStore');
    expect(JSON.stringify(vi.mocked(dbPut).mock.calls)).toContain(calls[0].url);
    const prep = useFeedStore.getState().offlinePrep!;
    expect(prep.done).toBe(6);
    expect(prep.total).toBe(6);
    expect(prep.cancelled).toBeFalsy();
  });

  it('deux nouvelles tentatives au plus, après une attente croissante', async () => {
    const calls = busyFirst(Infinity);
    const run = useFeedStore.getState().prepareOffline();
    await vi.advanceTimersByTimeAsync(PREP_BUSY_RETRY_DELAYS_MS[0] + PREP_BUSY_RETRY_DELAYS_MS[1] + 1_000);
    await run;
    const tries = calls.filter((c) => c.url === calls[0].url);
    expect(tries).toHaveLength(3);
    expect(tries[1].at - tries[0].at).toBeGreaterThanOrEqual(PREP_BUSY_RETRY_DELAYS_MS[0]);
    expect(tries[2].at - tries[1].at).toBeGreaterThanOrEqual(PREP_BUSY_RETRY_DELAYS_MS[1]);
    expect(useFeedStore.getState().offlinePrep!.done).toBe(6);
  });

  it('pendant l’attente, l’article refusé compte comme restant (estimation), et « Annuler » arrête aussitôt', async () => {
    const calls = busyFirst(1);
    const run = useFeedStore.getState().prepareOffline();
    await vi.advanceTimersByTimeAsync(1_000);
    const waiting = useFeedStore.getState().offlinePrep!;
    expect(waiting.running).toBe(true);
    expect(waiting.done).toBe(5);
    expect(waiting.total).toBe(6);
    useFeedStore.getState().cancelOfflinePrep();
    await vi.advanceTimersByTimeAsync(250);
    await run;
    expect(calls).toHaveLength(6);
    const prep = useFeedStore.getState().offlinePrep!;
    expect(prep.running).toBe(false);
    expect(prep.cancelled).toBe(true);
    expect(prep.done).toBe(5);
    const { pruneImages } = await import('../lib/imageCache');
    expect(pruneImages).not.toHaveBeenCalled();
  });

  // Un flux en échec pendant la lecture des listes marque la préparation
  // « incomplète » (pas de retrait final des images) : ce drapeau empêchait
  // aussi toute reprise, et les refusés restaient sans article complet.
  it('un flux en échec à la lecture des listes n’empêche pas la reprise des refusés', async () => {
    vi.mocked(getStreamContents).mockImplementation(async (feed: string) => {
      if (feed === 'feed/3') throw new Error('500');
      return { items: [item(feed), item(feed)], continuation: null } as never;
    });
    const calls = busyFirst(1);
    const run = useFeedStore.getState().prepareOffline();
    await vi.advanceTimersByTimeAsync(PREP_BUSY_RETRY_DELAYS_MS[0] + 1_000);
    await run;
    expect(calls).toHaveLength(5);
    expect(calls[4].url).toBe(calls[0].url);
    const prep = useFeedStore.getState().offlinePrep!;
    expect(prep.done).toBe(4);
    expect(prep.missingFull).toBe(0);
  });

  it('un autre échec passager n’est pas redemandé dans le passage', async () => {
    let first: string | null = null;
    extract.fn.mockImplementation(async (url: string) => {
      first ??= url;
      if (url === first) throw new ExtractTimeoutError();
      return extracted(url);
    });
    const run = useFeedStore.getState().prepareOffline();
    await vi.advanceTimersByTimeAsync(30_000);
    await run;
    expect(extract.fn).toHaveBeenCalledTimes(6);
  });
});

// Idée du troisième round 1.9.0 : pendant les reprises (jusqu'à 15 s), rien ne
// disait que la préparation attendait le serveur ; puis « Hors ligne prêt (6) »
// s'affichait alors qu'aucun article complet n'avait été obtenu.
describe('préparation : attente du serveur dite, compte rendu honnête', () => {
  beforeEach(() => {
    useUiStore.setState({ autoExtractDefault: true, feedSettings: {} } as never);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('pendant l’attente d’une reprise, dit combien d’articles attendent le serveur, puis cesse de le dire', async () => {
    let first: string | null = null;
    let tries = 0;
    extract.fn.mockImplementation(async (url: string) => {
      first ??= url;
      if (url === first && ++tries === 1) throw new ExtractorBusyError();
      return extracted(url);
    });
    const run = useFeedStore.getState().prepareOffline();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(useFeedStore.getState().offlinePrep!.waitingServer).toBe(1);
    await vi.advanceTimersByTimeAsync(PREP_BUSY_RETRY_DELAYS_MS[0]);
    await run;
    const prep = useFeedStore.getState().offlinePrep!;
    expect(prep.waitingServer).toBeUndefined();
    expect(prep.missingFull).toBe(0);
  });

  it('les articles restés sans article complet après les reprises sont comptés à part', async () => {
    extract.fn.mockImplementation(async () => { throw new ExtractorBusyError(); });
    const run = useFeedStore.getState().prepareOffline();
    await vi.advanceTimersByTimeAsync(PREP_BUSY_RETRY_DELAYS_MS[0] + PREP_BUSY_RETRY_DELAYS_MS[1] + 1_000);
    await run;
    const prep = useFeedStore.getState().offlinePrep!;
    expect(prep.done).toBe(6);
    expect(prep.total).toBe(6);
    expect(prep.missingFull).toBe(6);
    expect(prep.waitingServer).toBeUndefined();
  });

  it('un autre échec d’extraction compte aussi comme sans article complet', async () => {
    let first: string | null = null;
    extract.fn.mockImplementation(async (url: string) => {
      first ??= url;
      if (url === first) throw new ExtractTimeoutError();
      return extracted(url);
    });
    await useFeedStore.getState().prepareOffline();
    expect(useFeedStore.getState().offlinePrep!.missingFull).toBe(1);
  });

  it('un flux réglé « Article complet : Non » ne manque de rien', async () => {
    useUiStore.setState({ autoExtractDefault: false, feedSettings: { 'feed/2': { autoExtract: true } } } as never);
    await useFeedStore.getState().prepareOffline();
    expect(useFeedStore.getState().offlinePrep!.missingFull).toBe(0);
  });
});
