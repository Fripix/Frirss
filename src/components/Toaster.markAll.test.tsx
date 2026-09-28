// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, act, fireEvent } from '@testing-library/react';

vi.mock('../api/feeds', async () => {
  const actual = await vi.importActual<typeof import('../api/feeds')>('../api/feeds');
  return {
    ...actual,
    markAllAsRead: vi.fn().mockResolvedValue(undefined),
    markAsUnread: vi.fn().mockResolvedValue(undefined),
    getUnreadItemIds: vi.fn().mockResolvedValue({ ids: ['a', 'b'], complete: true }),
    getUnreadCounts: vi.fn().mockResolvedValue([]),
    getStreamContents: vi.fn().mockResolvedValue({ items: [], continuation: null }),
  };
});

import Toaster from './Toaster';
import { useFeedStore } from '../stores/feedStore';
import { useUiStore } from '../stores/uiStore';

beforeEach(() => {
  useUiStore.setState({ toasts: [] });
  useFeedStore.setState({ selectedFeed: null, articles: [], unreadCounts: {} });
});
afterEach(cleanup);

/**
 * Le chemin complet, jusqu'à l'ÉCRAN : l'action du store pousse le bandeau, et
 * le bandeau se rend. Les tests du store s'arrêtaient à l'état ; ils ne
 * voyaient donc pas un bandeau qui ne s'affiche jamais — c'est exactement ce
 * qui a été constaté sur l'instance de dev le 2026-09-28, sans qu'aucun test
 * ne rougisse.
 *
 * ⚠️ `../i18n` n'est PAS simulé ici, délibérément : `markAllAsRead` l'importe
 * dynamiquement pour traduire le bandeau, et c'est précisément ce maillon que
 * les autres tests remplaçaient.
 */
describe('le bandeau de « tout marquer comme lu » arrive à l’écran', () => {
  it('affiche le message et son action Annuler', async () => {
    render(<Toaster />);

    await act(async () => { await useFeedStore.getState().markAllAsRead(); });

    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByRole('button', { name: /annuler|undo/i })).toBeTruthy();
  });

  /**
   * Et le clic doit RENDRE les articles. Le test précédent s'arrêtait à la
   * présence du bouton : il aurait laissé passer une action qui ne fait rien,
   * ce que le navigateur a semblé montrer le 2026-09-28.
   */
  it('rend les articles quand on clique Annuler', async () => {
    const { markAsUnread } = await import('../api/feeds');
    render(<Toaster />);
    await act(async () => { await useFeedStore.getState().markAllAsRead(); });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /annuler|undo/i })); });

    expect(markAsUnread).toHaveBeenCalledWith(['a', 'b']);
  });
});
