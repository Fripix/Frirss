// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/feeds', async () => {
  const actual = await vi.importActual<typeof import('../api/feeds')>('../api/feeds');
  return {
    ...actual,
    markAllAsRead: vi.fn().mockResolvedValue(undefined),
    markAsUnread: vi.fn().mockResolvedValue(undefined),
    getUnreadItemIds: vi.fn().mockResolvedValue({ ids: [], complete: true }),
    getUnreadCounts: vi.fn().mockResolvedValue([]),
    getStreamContents: vi.fn().mockResolvedValue({ items: [], continuation: null }),
    fetchStreamPage: vi.fn().mockResolvedValue({ items: [], continuation: null }),
  };
});

vi.mock('../i18n', () => ({ default: { t: (k: string) => k } }));

import { markAllAsRead as apiMarkAllAsRead, markAsUnread, getUnreadItemIds } from '../api/feeds';
import { useFeedStore } from './feedStore';
import { useUiStore } from './uiStore';

const ids = (n: number, prefix = 'id') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

beforeEach(() => {
  vi.clearAllMocks();
  useUiStore.setState({ toasts: [] });
  useFeedStore.setState({ selectedFeed: null, articles: [], unreadCounts: {} });
});

/**
 * « Tout marquer comme lu » ne se défaisait pas : `mark-all-as-read` ne rend
 * pas ce qu'il a touché, donc rien ne permettait de revenir en arrière — c'est
 * la moitié de l'issue #17, où un clic accidentel a vidé une liste entière.
 *
 * Le relevé des non-lus AVANT l'appel donne exactement les articles à rendre :
 * ceux qui étaient déjà lus ne doivent surtout pas redevenir non lus.
 */
describe('markAllAsRead — retour en arrière', () => {
  it('relève les non-lus avant de marquer, et propose de défaire', async () => {
    (getUnreadItemIds as ReturnType<typeof vi.fn>).mockResolvedValue({ ids: ['a', 'b', 'c'], complete: true });

    await useFeedStore.getState().markAllAsRead();

    expect(apiMarkAllAsRead).toHaveBeenCalled();
    const toast = useUiStore.getState().toasts.at(-1);
    expect(toast?.action).toBeTruthy();
  });

  it('rend non lus exactement les articles relevés', async () => {
    (getUnreadItemIds as ReturnType<typeof vi.fn>).mockResolvedValue({ ids: ['a', 'b', 'c'], complete: true });

    await useFeedStore.getState().markAllAsRead();
    await useUiStore.getState().toasts.at(-1)!.action!.run();

    expect(markAsUnread).toHaveBeenCalledWith(['a', 'b', 'c']);
  });

  it('découpe la remise en non lus par lots de 500', async () => {
    (getUnreadItemIds as ReturnType<typeof vi.fn>).mockResolvedValue({ ids: ids(1200), complete: true });

    await useFeedStore.getState().markAllAsRead();
    await useUiStore.getState().toasts.at(-1)!.action!.run();

    const lots = (markAsUnread as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[0] as string[]).length);
    expect(lots).toEqual([500, 500, 200]);
  });

  /**
   * Le relevé pagine (`stream/items/ids` rend une continuation) : plusieurs
   * milliers d'articles non lus, c'est ordinaire dès qu'on suit beaucoup de
   * flux, et s'arrêter à la première page privait justement ces comptes-là du
   * retour en arrière.
   */
  it('propose de défaire bien au-delà d’une page', async () => {
    (getUnreadItemIds as ReturnType<typeof vi.fn>).mockResolvedValue({ ids: ids(4300), complete: true });

    await useFeedStore.getState().markAllAsRead();
    await useUiStore.getState().toasts.at(-1)!.action!.run();

    const rendus = (markAsUnread as ReturnType<typeof vi.fn>).mock.calls
      .reduce((n, c) => n + (c[0] as string[]).length, 0);
    expect(rendus).toBe(4300);
  });

  it('ne promet rien quand le relevé n’a pas pu aller au bout', async () => {
    (getUnreadItemIds as ReturnType<typeof vi.fn>).mockResolvedValue({ ids: ids(25000), complete: false });

    await useFeedStore.getState().markAllAsRead();

    expect(apiMarkAllAsRead).toHaveBeenCalled();
    expect(useUiStore.getState().toasts.at(-1)?.action).toBeFalsy();
  });

  /**
   * Le relevé est lancé À L'OUVERTURE de la boîte de confirmation : la
   * pagination coûte une requête par millier d'articles, et ce temps doit se
   * dépenser pendant que la question est lue, pas après la validation.
   */
  it('réutilise le relevé préparé pendant la question, sans le refaire', async () => {
    (getUnreadItemIds as ReturnType<typeof vi.fn>).mockResolvedValue({ ids: ['a', 'b'], complete: true });

    useFeedStore.getState().prepareMarkAllUndo();
    await useFeedStore.getState().markAllAsRead();

    expect(getUnreadItemIds).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().toasts.at(-1)?.action).toBeTruthy();
  });

  /**
   * Le relevé préparé appartient à la vue qui a posé la question. Annuler la
   * boîte, changer de flux, puis marquer ailleurs ne doit pas rendre non lus
   * les articles de la vue précédente — le pire des retours en arrière, celui
   * qui touche autre chose que ce qu'on vient de faire.
   */
  it('ignore un relevé préparé pour une autre vue', async () => {
    (getUnreadItemIds as ReturnType<typeof vi.fn>).mockResolvedValue({ ids: ['ancien'], complete: true });
    useFeedStore.setState({ selectedFeed: { id: 'feed/1', title: 'A' } as never });
    useFeedStore.getState().prepareMarkAllUndo();

    (getUnreadItemIds as ReturnType<typeof vi.fn>).mockResolvedValue({ ids: ['nouveau'], complete: true });
    useFeedStore.setState({ selectedFeed: { id: 'feed/2', title: 'B' } as never });
    await useFeedStore.getState().markAllAsRead();
    await useUiStore.getState().toasts.at(-1)!.action!.run();

    expect(markAsUnread).toHaveBeenCalledWith(['nouveau']);
  });

  /** Le relevé est un confort : son échec ne doit pas retenir l'action. */
  it('marque quand même si le relevé échoue, sans proposer de défaire', async () => {
    (getUnreadItemIds as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('réseau'));

    await useFeedStore.getState().markAllAsRead();

    expect(apiMarkAllAsRead).toHaveBeenCalled();
    expect(useUiStore.getState().toasts.at(-1)?.action).toBeFalsy();
  });
});
