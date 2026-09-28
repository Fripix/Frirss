// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/feeds', async () => {
  const actual = await vi.importActual<typeof import('../api/feeds')>('../api/feeds');
  return {
    ...actual,
    markAllAsRead: vi.fn().mockResolvedValue(undefined),
    markAsUnread: vi.fn().mockResolvedValue(undefined),
    getUnreadItemIds: vi.fn().mockResolvedValue([]),
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
    (getUnreadItemIds as ReturnType<typeof vi.fn>).mockResolvedValue(['a', 'b', 'c']);

    await useFeedStore.getState().markAllAsRead();

    expect(apiMarkAllAsRead).toHaveBeenCalled();
    const toast = useUiStore.getState().toasts.at(-1);
    expect(toast?.action).toBeTruthy();
  });

  it('rend non lus exactement les articles relevés', async () => {
    (getUnreadItemIds as ReturnType<typeof vi.fn>).mockResolvedValue(['a', 'b', 'c']);

    await useFeedStore.getState().markAllAsRead();
    await useUiStore.getState().toasts.at(-1)!.action!.run();

    expect(markAsUnread).toHaveBeenCalledWith(['a', 'b', 'c']);
  });

  it('découpe la remise en non lus par lots de 100', async () => {
    (getUnreadItemIds as ReturnType<typeof vi.fn>).mockResolvedValue(ids(250));

    await useFeedStore.getState().markAllAsRead();
    await useUiStore.getState().toasts.at(-1)!.action!.run();

    const lots = (markAsUnread as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[0] as string[]).length);
    expect(lots).toEqual([100, 100, 50]);
  });

  /**
   * Au-delà du plafond, le relevé est forcément incomplet : promettre un
   * retour en arrière qui ne rendrait qu'une partie des articles serait pire
   * que ne rien promettre.
   */
  it('ne propose rien quand le relevé bute sur le plafond', async () => {
    (getUnreadItemIds as ReturnType<typeof vi.fn>).mockResolvedValue(ids(1000));

    await useFeedStore.getState().markAllAsRead();

    expect(apiMarkAllAsRead).toHaveBeenCalled();
    expect(useUiStore.getState().toasts.at(-1)?.action).toBeFalsy();
  });

  /** Le relevé est un confort : son échec ne doit pas retenir l'action. */
  it('marque quand même si le relevé échoue, sans proposer de défaire', async () => {
    (getUnreadItemIds as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('réseau'));

    await useFeedStore.getState().markAllAsRead();

    expect(apiMarkAllAsRead).toHaveBeenCalled();
    expect(useUiStore.getState().toasts.at(-1)?.action).toBeFalsy();
  });
});
