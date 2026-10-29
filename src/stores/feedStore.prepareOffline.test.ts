// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  return {
    ...actual,
    imageBudget: vi.fn(() => ({ bytes: 1000, perArticle: 1 })),
    articleImageUrls: (content: string) => [content],
  };
});
vi.mock('../lib/storageEstimate', async () => {
  const actual = await vi.importActual<typeof import('../lib/storageEstimate')>('../lib/storageEstimate');
  return { ...actual, getStorageEstimate: vi.fn(async () => null) };
});
vi.mock('../lib/imageCache', () => ({ cacheImages: vi.fn(), pruneImages: vi.fn(async () => 0) }));
vi.mock('../i18n', () => ({ default: { t: (k: string) => k } }));

import { getStreamContents } from '../api/feeds';
import { imageBudget } from '../lib/offlineImages';
import { cacheImages, pruneImages } from '../lib/imageCache';
import { useFeedStore } from './feedStore';

/*
 * Les images préparées ont leur propre cache, que rien n'évince seul : la
 * préparation retire à la fin ce qu'elle n'a pas gardé. Retirer est la seule
 * étape qui détruit — elle ne doit jouer que sur une préparation qui a vu
 * toute la liste.
 */
const now = Math.floor(Date.now() / 1000);
const item = (n: number) => ({ id: `i${n}`, published: now, content: { content: `https://img.example/${n}.jpg` } });
const result = (urls: string[], bytes: number, reusedBytes = 0, error?: string) =>
  ({ stored: urls.length, bytes, reusedBytes, kept: urls, failed: 0, error });

describe('prepareOffline — images préparées', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    vi.mocked(imageBudget).mockReturnValue({ bytes: 1000, perArticle: 1 });
    vi.mocked(getStreamContents).mockResolvedValue({ items: [item(1), item(2), item(3)], continuation: null } as never);
    useFeedStore.setState({ offlinePrep: null, subscriptions: [{ id: 'feed/1', title: 'F' } as never] });
  });

  it('retire ce que la préparation n’a pas gardé', async () => {
    vi.mocked(cacheImages).mockImplementation(async (urls) => result(urls, 10));
    await useFeedStore.getState().prepareOffline();
    expect(pruneImages).toHaveBeenCalledTimes(1);
    expect([...vi.mocked(pruneImages).mock.calls[0][0]].sort())
      .toEqual(['https://img.example/1.jpg', 'https://img.example/2.jpg', 'https://img.example/3.jpg']);
  });

  // Une image gardée d'une préparation précédente pèse dans le budget comme
  // une nouvelle : sans cela, le cache dépassait le budget d'une préparation
  // à l'autre.
  it('compte les images déjà préparées dans le budget', async () => {
    vi.mocked(cacheImages).mockImplementation(async (urls) => ({ ...result(urls, 0, 1000), stored: 0 }));
    await useFeedStore.getState().prepareOffline();
    expect(cacheImages).toHaveBeenCalledTimes(1);
    expect(useFeedStore.getState().offlinePrep?.budgetStopped).toBe(true);
    expect([...vi.mocked(pruneImages).mock.calls[0][0]]).toEqual(['https://img.example/1.jpg']);
  });

  it('ne retire rien quand le réseau coupe la préparation', async () => {
    vi.mocked(cacheImages).mockImplementation(async (urls) => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
      return result(urls, 10);
    });
    await useFeedStore.getState().prepareOffline();
    expect(pruneImages).not.toHaveBeenCalled();
  });

  it('ne retire rien quand le cache n’a pas pu s’ouvrir', async () => {
    vi.mocked(cacheImages).mockImplementation(async () => ({ stored: 0, bytes: 0, reusedBytes: 0, kept: [], failed: 1, error: 'open: QuotaExceededError' }));
    await useFeedStore.getState().prepareOffline();
    expect(pruneImages).not.toHaveBeenCalled();
  });

  // Couper le téléchargement des images ne doit pas effacer celles déjà
  // préparées : le retour du réglage les retrouve.
  it('ne retire rien quand les images sont désactivées', async () => {
    vi.mocked(imageBudget).mockReturnValue({ bytes: 0, perArticle: 0 });
    await useFeedStore.getState().prepareOffline();
    expect(cacheImages).not.toHaveBeenCalled();
    expect(pruneImages).not.toHaveBeenCalled();
  });

  // Un flux sauté (FreshRSS en panne, 429 du plafond, 504) n'a rien apporté à
  // la liste : ses images n'étaient pas « hors des 30 jours ». Avec FreshRSS
  // en panne, la liste était vide et tout le cache des préparées partait.
  it('ne retire rien quand la liste d’un flux n’a pas pu être lue', async () => {
    useFeedStore.setState({ subscriptions: [{ id: 'feed/1', title: 'F' } as never, { id: 'feed/2', title: 'G' } as never] });
    vi.mocked(getStreamContents)
      .mockResolvedValueOnce({ items: [item(1)], continuation: null } as never)
      .mockRejectedValueOnce(new Error('503'));
    vi.mocked(cacheImages).mockImplementation(async (urls) => result(urls, 10));
    await useFeedStore.getState().prepareOffline();
    expect(pruneImages).not.toHaveBeenCalled();
  });

  it('ne retire rien sans abonnements chargés', async () => {
    useFeedStore.setState({ subscriptions: [] });
    await useFeedStore.getState().prepareOffline();
    expect(pruneImages).not.toHaveBeenCalled();
  });

  it('ne reste pas « en cours » après une erreur imprévue', async () => {
    vi.mocked(cacheImages).mockRejectedValue(new Error('IndexedDB'));
    await useFeedStore.getState().prepareOffline().catch(() => {});
    expect(useFeedStore.getState().offlinePrep?.running).toBe(false);
    expect(pruneImages).not.toHaveBeenCalled();
  });
});
