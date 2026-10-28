// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act, screen } from '@testing-library/react';
import Toaster from './Toaster';
import OfflineBanner from './OfflineBanner';
import RefreshBanner from './RefreshBanner';
import { useUiStore } from '../stores/uiStore';
import { useFeedStore } from '../stores/feedStore';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

afterEach(cleanup);

/*
 * Une région `aria-live` montée EN MÊME TEMPS que son contenu n'est souvent
 * pas annoncée : le lecteur d'écran n'écoute que les changements d'une région
 * qu'il connaît déjà. Ces trois messages étaient rendus `null` au repos, puis
 * apparaissaient d'un bloc, région comprise. La région reste désormais montée,
 * vide au repos, et c'est le même nœud qui reçoit le texte.
 */
describe('régions annoncées montées en permanence', () => {
  it('toasts', () => {
    useUiStore.setState({ toasts: [] });
    render(<Toaster />);
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');
    act(() => { useUiStore.getState().pushToast('Article enregistré'); });
    expect(screen.getByRole('status')).toBe(region);
    expect(region.textContent).toContain('Article enregistré');
  });

  it('bandeau hors ligne', () => {
    useFeedStore.setState({ pendingActions: 0, failedActions: 0 });
    render(<OfflineBanner />);
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(screen.getByRole('status')).toBe(region);
    expect(region.textContent).toContain('connection.offline');
    act(() => { window.dispatchEvent(new Event('online')); });
  });

  it('bandeau de relève', () => {
    useFeedStore.setState({ refreshResult: null, refreshPhase: 'idle', hasRefreshToken: true } as never);
    render(<RefreshBanner />);
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');
    act(() => { useFeedStore.setState({ refreshResult: { totalNew: 0 }, refreshPhase: 'done' } as never); });
    expect(screen.getByRole('status')).toBe(region);
    expect(region.textContent).toContain('refresh.upToDate');
  });
});
