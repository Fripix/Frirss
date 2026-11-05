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
