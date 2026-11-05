// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
