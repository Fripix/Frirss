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
import { listPut } from '../lib/offlineStore';
import { useFeedStore } from './feedStore';
import { useAuthStore } from './authStore';

/*
 * Les images préparées ont leur propre cache, que rien n'évince seul : la
 * préparation retire à la fin ce qu'elle n'a pas gardé. Retirer est la seule
 * étape qui détruit — elle ne doit jouer que sur une préparation qui a vu
 * toute la liste.
 */
const now = Math.floor(Date.now() / 1000);
const item = (n: number) => ({ id: `i${n}`, published: now, content: { content: `https://img.example/${n}.jpg` } });
const result = (urls: string[], bytes: number, reusedBytes = 0, error?: string) => ({
  stored: urls.length, bytes, reusedBytes, kept: urls, failed: 0, error,
  sizes: Object.fromEntries(urls.map((u) => [u, (bytes + reusedBytes) / urls.length])),
});

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
    vi.mocked(cacheImages).mockImplementation(async () => ({ stored: 0, bytes: 0, reusedBytes: 0, kept: [], sizes: {}, failed: 1, error: 'open: QuotaExceededError' }));
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

  // Appareil plein : plus rien n'est téléchargé, mais la préparation va au
  // bout. Le retrait final est le seul qui libère de la place (articles de
  // plus de 30 jours) : les images déjà préparées des articles suivants y
  // échappent, relevées sans téléchargement (`noFetch`) et comptées dans le
  // budget comme les autres.
  it('appareil plein : plus de téléchargement, les images préparées suivantes restent, le retrait tourne', async () => {
    vi.mocked(cacheImages).mockImplementation(async (urls, deps) => (deps?.noFetch
      ? { ...result(urls, 0, 10), stored: 0 }
      : { ...result([], 0), failed: urls.length, full: true }));
    await useFeedStore.getState().prepareOffline();
    expect(vi.mocked(cacheImages).mock.calls.map((c) => !!c[1]?.noFetch)).toEqual([false, true, true]);
    const prep = useFeedStore.getState().offlinePrep;
    expect(prep?.deviceFull).toBe(true);
    expect(prep?.running).toBe(false);
    expect(prep?.done).toBe(prep?.total);
    expect(pruneImages).toHaveBeenCalledTimes(1);
    expect([...vi.mocked(pruneImages).mock.calls[0][0]].sort())
      .toEqual(['https://img.example/2.jpg', 'https://img.example/3.jpg']);
  });

  it('appareil plein : le relevé respecte le budget', async () => {
    vi.mocked(imageBudget).mockReturnValue({ bytes: 5, perArticle: 1 });
    vi.mocked(cacheImages).mockImplementation(async (urls, deps) => (deps?.noFetch
      ? { ...result(urls, 0, 10), stored: 0 }
      : { ...result([], 0), failed: urls.length, full: true }));
    await useFeedStore.getState().prepareOffline();
    // Les 10 octets du 2e article dépassent le budget (5) : le 3e n'est plus
    // relevé, et son image part au retrait comme au-delà de tout budget.
    expect(vi.mocked(cacheImages)).toHaveBeenCalledTimes(2);
    expect([...vi.mocked(pruneImages).mock.calls[0][0]]).toEqual(['https://img.example/2.jpg']);
  });

  // Une image commune à plusieurs articles (un logo, un avatar) ne pèse
  // qu'une fois : comptée à chaque article, elle atteignait le budget trop
  // tôt, et le retrait ôtait les images des articles suivants.
  it('compte une seule fois une image commune à plusieurs articles', async () => {
    vi.mocked(imageBudget).mockReturnValue({ bytes: 15, perArticle: 1 });
    const shared = { content: { content: 'https://img.example/logo.jpg' } };
    vi.mocked(getStreamContents).mockResolvedValue({ items: [1, 2, 3].map((n) => ({ ...item(n), ...shared })), continuation: null } as never);
    vi.mocked(cacheImages).mockImplementation(async (urls) => result(urls, 0, 10));
    await useFeedStore.getState().prepareOffline();
    expect(cacheImages).toHaveBeenCalledTimes(3);
    expect(useFeedStore.getState().offlinePrep?.budgetStopped).toBe(false);
  });

  it('demande un stockage protégé quand l’utilisateur lance la préparation', async () => {
    const persist = vi.fn(async () => true);
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { persist } });
    vi.mocked(cacheImages).mockImplementation(async (urls) => result(urls, 10));
    await useFeedStore.getState().prepareOffline({ userInitiated: true });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  // Firefox affiche une demande d'autorisation : jamais sans geste, donc pas
  // depuis la préparation automatique de l'ouverture.
  it('ne la demande pas pour la préparation automatique', async () => {
    const persist = vi.fn(async () => true);
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { persist } });
    vi.mocked(cacheImages).mockImplementation(async (urls) => result(urls, 10));
    await useFeedStore.getState().prepareOffline();
    expect(persist).not.toHaveBeenCalled();
  });

  it('prépare quand même si le navigateur n’offre pas de stockage protégé', async () => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: {} });
    vi.mocked(cacheImages).mockImplementation(async (urls) => result(urls, 10));
    await useFeedStore.getState().prepareOffline();
    expect(useFeedStore.getState().offlinePrep?.phase).toBe('done');
  });
});

/*
 * La préparation dure plusieurs minutes et relisait la portée en route : une
 * bascule vers le serveur 2 étiquetait ses images suivantes « serveur 2 »,
 * puis le balayage final tournait sous le serveur 2 avec la liste du 1 — et
 * effaçait toutes les images préparées pour le 2.
 */
describe('prepareOffline — la portée change en cours de route (M5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    vi.mocked(imageBudget).mockReturnValue({ bytes: 100000, perArticle: 1 });
    vi.mocked(getStreamContents).mockResolvedValue({ items: [item(1), item(2), item(3)], continuation: null } as never);
    useAuthStore.setState({ backendToken: 'jwt', backendUser: { id: 7 } as never, activeServerId: '1', serverUrl: 'https://a.example', isAuthenticated: true });
    useFeedStore.setState({ offlinePrep: null, subscriptions: [{ id: 'feed/1', title: 'F' } as never, { id: 'feed/2', title: 'G' } as never] });
  });

  it('bascule en phase images : s’interrompt, sans balayage ni étiquette de l’autre serveur', async () => {
    const scopes: string[] = [];
    vi.mocked(cacheImages).mockImplementation(async (urls, deps) => {
      scopes.push(String(deps?.scope));
      if (scopes.length === 1) useAuthStore.getState().setFreshrssAuth('2', 'https://b.example');
      return result(urls, 10);
    });
    await useFeedStore.getState().prepareOffline();
    expect(scopes.every((s) => s === '7@1'), scopes.join()).toBe(true);
    expect(scopes.length, 'arrêtée après la bascule').toBe(1);
    expect(pruneImages).not.toHaveBeenCalled();
    expect(useFeedStore.getState().offlinePrep?.running).toBe(false);
  });

  it('bascule en phase listes : aucune liste rangée sous la nouvelle portée', async () => {
    vi.mocked(cacheImages).mockImplementation(async (urls) => result(urls, 10));
    vi.mocked(getStreamContents).mockImplementation(async () => {
      useAuthStore.getState().setFreshrssAuth('2', 'https://b.example');
      return { items: [item(1)], continuation: null } as never;
    });
    await useFeedStore.getState().prepareOffline();
    const keys = vi.mocked(listPut).mock.calls.map((c) => String(c[0]));
    expect(keys.filter((k) => !k.startsWith('7@1|')), keys.join()).toEqual([]);
    expect(pruneImages).not.toHaveBeenCalled();
  });
});
