// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react';
import BottomSheet from './BottomSheet';
import ConfirmDialog from './ConfirmDialog';
import ArticleContextMenu from './ArticleList/ArticleContextMenu';
import { FeedContextMenu } from './Sidebar/Sidebar';
import { resetBackLayers } from '../hooks/useAndroidBack';
import type { Article, Subscription } from '../types';

// M-08 (1.9.0) : sur Android, le retour avec une feuille du bas, une
// confirmation ou un menu contextuel ouvert fermait l'app (ou l'onglet de
// Chrome), l'article sous la feuille « More », ou le tiroir en laissant le
// menu d'un flux à l'écran. Chaque surface pousse maintenant sa couche
// d'historique ; le retour ferme cette surface seule.

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('../stores/feedStore', () => ({
  useFeedStore: Object.assign(
    (sel: (s: unknown) => unknown) => sel({ feedErrors: {}, refreshResult: null, selectedFeed: null }),
    { getState: () => ({ selectedFeed: null, randomView: false, loadArticles: () => {}, setRandomView: () => {} }) },
  ),
  READ_LATER_LABEL: 'user/-/label/Read later',
  getSampleArticleUrl: () => undefined,
}));

const ANDROID = 'Mozilla/5.0 (Linux; Android 17; Pixel) AppleWebKit/537.36 Chrome/145.0 Mobile Safari/537.36';
let ua = ANDROID;
let push: ReturnType<typeof vi.spyOn>;
let go: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  ua = ANDROID;
  vi.spyOn(navigator, 'userAgent', 'get').mockImplementation(() => ua);
  push = vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
  go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
  resetBackLayers();
});
afterEach(() => {
  cleanup();
  resetBackLayers();
  vi.restoreAllMocks();
});

/** Laisse passer la mise en accord de l'historique (une microtâche). */
const settle = () => act(async () => { await Promise.resolve(); });
/** Le geste retour d'Android, depuis la première entrée poussée. */
const androidBack = () => act(() => { window.dispatchEvent(new PopStateEvent('popstate', { state: null })); });

const article = { id: 'a1', title: 'Hello', url: 'https://example.com/1', read: false, starred: false, labels: [] } as unknown as Article;
const menuHandlers = () => ({
  onClose: vi.fn(), onOpenSource: vi.fn(), onToggleRead: vi.fn(), onMarkRange: vi.fn(),
  onToggleStar: vi.fn(), onToggleReadLater: vi.fn(), onCopyLink: vi.fn(),
});
const feed = { id: 'feed/1', title: 'The Register' } as Subscription;
const yes = async () => true;

describe('Retour Android — chaque surface flottante a sa couche', () => {
  it('feuille du bas : ouverte, elle pousse une entrée ; le retour la ferme', async () => {
    const onClose = vi.fn();
    render(<BottomSheet open onClose={onClose} title="Options"><p>x</p></BottomSheet>);
    await settle();
    expect(push).toHaveBeenCalledTimes(1);
    androidBack();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('feuille du bas fermée par Échap : un seul retour synthétique, qui ne ferme rien d’autre', async () => {
    const onClose = vi.fn();
    const { rerender } = render(<BottomSheet open onClose={onClose}><p>x</p></BottomSheet>);
    await settle();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    rerender(<BottomSheet open={false} onClose={onClose}><p>x</p></BottomSheet>);
    await settle();
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(-1);
    expect(onClose).toHaveBeenCalledTimes(1); // Échap seul
  });

  it('feuille du bas fermée par le retour puis démontée : aucun retour en plus', async () => {
    const onClose = vi.fn();
    const { rerender } = render(<BottomSheet open onClose={onClose}><p>x</p></BottomSheet>);
    await settle();
    androidBack();
    rerender(<BottomSheet open={false} onClose={onClose}><p>x</p></BottomSheet>);
    await settle();
    expect(go).not.toHaveBeenCalled();
  });

  it('hors Android, rien n’est écrit dans l’historique', async () => {
    ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
    render(<BottomSheet open onClose={() => {}}><p>x</p></BottomSheet>);
    await settle();
    expect(push).not.toHaveBeenCalled();
  });

  it('confirmation (« Tout lu ? ») : le retour l’annule', async () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog open title="Tout lu ?" confirmLabel="ok" onConfirm={() => {}} onCancel={onCancel} />);
    await settle();
    expect(push).toHaveBeenCalledTimes(1);
    androidBack();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('menu d’un article en feuille : le retour ferme le menu', async () => {
    const h = menuHandlers();
    render(<ArticleContextMenu article={article} isReadLater={false} canMarkRange x={0} y={0} sheet {...h} />);
    await settle();
    expect(push).toHaveBeenCalledTimes(1);
    androidBack();
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it('menu d’un article flottant (tablette) : le retour ferme le menu', async () => {
    const h = menuHandlers();
    render(<ArticleContextMenu article={article} isReadLater={false} canMarkRange x={0} y={0} sheet={false} {...h} />);
    await settle();
    expect(push).toHaveBeenCalledTimes(1);
    androidBack();
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it('menu d’un flux : le retour ferme le menu', async () => {
    const onClose = vi.fn();
    render(<FeedContextMenu feed={feed} x={10} y={10} onRename={yes} onDelete={yes} onClose={onClose} />);
    await settle();
    expect(push).toHaveBeenCalledTimes(1);
    androidBack();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('menu d’un flux passé à « Se désabonner ? » : un seul retour ferme tout, sans entrée orpheline', async () => {
    const onClose = vi.fn();
    const { rerender } = render(<FeedContextMenu feed={feed} x={10} y={10} onRename={yes} onDelete={yes} onClose={onClose} />);
    await settle();
    fireEvent.click(screen.getByText('sidebar.unsubscribe'));
    await settle();
    expect(push).toHaveBeenCalledTimes(2); // le menu, puis la confirmation
    act(() => { window.dispatchEvent(new PopStateEvent('popstate', { state: { frirssDepth: 1 } })); });
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<></>); // le parent démonte le menu
    await settle();
    expect(go).toHaveBeenCalledWith(-1); // l'entrée du menu est reprise
  });
});
