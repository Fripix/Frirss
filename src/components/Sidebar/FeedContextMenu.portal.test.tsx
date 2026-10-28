// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, act, within } from '@testing-library/react';
import { CONFIRM_GRACE_MS } from '../ConfirmDialog';
import { useUiStore } from '../../stores/uiStore';
import { FeedContextMenu } from './Sidebar';
import type { Subscription } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('../../stores/feedStore', () => ({
  useFeedStore: Object.assign(
    (sel: (s: unknown) => unknown) => sel({ feedErrors: {}, refreshResult: null, selectedFeed: null }),
    { getState: () => ({ selectedFeed: null, loadArticles: () => {} }) },
  ),
  READ_LATER_LABEL: 'user/-/label/Read later',
  getSampleArticleUrl: () => undefined,
}));

const feed = { id: 'feed/1', title: 'The Register' } as Subscription;
const yes = async () => true;

afterEach(cleanup);

describe('FeedContextMenu — un menu flottant hors du tiroir', () => {
  it("est rendu sous <body>, pas dans l'ancêtre qui le rognerait", () => {
    // Sur mobile le tiroir est `fixed`, transformé (glissement) et
    // `overflow: hidden` : un `position: fixed` rendu dedans s'y ancre et s'y
    // rogne. Vu le 14.10 sur iPhone (320 px) : le tiroir fait 272 px, le menu
    // recalé sur la fenêtre allait jusqu'à 312, et les sélecteurs des lignes
    // « Article complet auto » et « Ordre de ce flux » étaient coupés.
    const { container } = render(
      <div data-testid="drawer" style={{ transform: 'translateX(0)', overflow: 'hidden', width: 272 }}>
        <FeedContextMenu feed={feed} x={272} y={40} onRename={yes} onDelete={yes} onClose={() => {}} />
      </div>,
    );
    const menu = screen.getByText('sidebar.feedOrderThisFeed').closest('[style*="position: fixed"]');
    expect(menu).not.toBeNull();
    expect(container.querySelector('[data-testid="drawer"]')!.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
  });

  it('se ferme à Échap', () => {
    // La garde de `useKeyboardNav` se tait tant que le menu est ouvert : sans
    // son propre Échap, le clavier restait mort jusqu'à un clic.
    const onClose = vi.fn();
    const { unmount } = render(<FeedContextMenu feed={feed} x={10} y={10} onRename={yes} onDelete={yes} onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
  });
});

// Le désabonnement se confirmait dans le menu lui-même, « Supprimer » posé à
// l'endroit de l'entrée qui l'ouvrait ; et un échec fermait le menu comme si
// le flux était parti.
describe('FeedContextMenu — se désabonner et renommer', () => {
  const grace = () => act(async () => { await new Promise((r) => setTimeout(r, CONFIRM_GRACE_MS + 30)); });

  it('se désabonner passe par la boîte, que ni un double-clic ni un clic dedans ne referment', async () => {
    const onDelete = vi.fn(async () => true);
    const onClose = vi.fn();
    render(<FeedContextMenu feed={feed} x={10} y={10} onRename={yes} onDelete={onDelete} onClose={onClose} />);
    fireEvent.click(screen.getByText('sidebar.unsubscribe'));
    const dialog = screen.getByRole('dialog');
    fireEvent.pointerDown(dialog);
    const confirm = within(dialog).getByRole('button', { name: 'sidebar.unsubscribe' });
    fireEvent.click(confirm);
    expect(onDelete).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await grace();
    await act(async () => { fireEvent.click(confirm); });
    expect(onDelete).toHaveBeenCalledWith('feed/1');
    expect(onClose).toHaveBeenCalled();
  });

  it('un désabonnement refusé le dit', async () => {
    useUiStore.setState({ toasts: [] });
    render(<FeedContextMenu feed={feed} x={10} y={10} onRename={yes} onDelete={async () => false} onClose={() => {}} />);
    fireEvent.click(screen.getByText('sidebar.unsubscribe'));
    await grace();
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'sidebar.unsubscribe' })); });
    expect(useUiStore.getState().toasts.map((x) => x.message)).toContain('sidebar.unsubscribeFailed');
  });

  it('un renommage refusé le dit', async () => {
    useUiStore.setState({ toasts: [] });
    render(<FeedContextMenu feed={feed} x={10} y={10} onRename={async () => false} onDelete={yes} onClose={() => {}} />);
    fireEvent.click(screen.getByText('sidebar.rename'));
    const field = screen.getByDisplayValue('The Register');
    fireEvent.change(field, { target: { value: 'El Reg' } });
    await act(async () => { fireEvent.submit(field.closest('form')!); });
    expect(useUiStore.getState().toasts.map((x) => x.message)).toContain('sidebar.renameFailed');
  });
});

// L'Échap du menu, posé en capture avant celui de la boîte, refermait la
// confirmation pendant que la requête tournait : la boîte refuse Échap tant
// qu'elle travaille, mais `stopPropagation` n'arrête pas un autre écouteur du
// même nœud.
describe('FeedContextMenu — Échap pendant le désabonnement', () => {
  it('ne ferme rien tant que la requête n’a pas répondu', async () => {
    const onClose = vi.fn();
    const pending = () => new Promise<boolean>(() => {});
    render(<FeedContextMenu feed={feed} x={10} y={10} onRename={yes} onDelete={pending} onClose={onClose} />);
    fireEvent.click(screen.getByText('sidebar.unsubscribe'));
    await act(async () => { await new Promise((r) => setTimeout(r, CONFIRM_GRACE_MS + 30)); });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'sidebar.unsubscribe' }));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
