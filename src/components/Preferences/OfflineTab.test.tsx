// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, act, within } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}${JSON.stringify(o)}` : k),
    i18n: { language: 'fr' },
  }),
}));
vi.mock('../../lib/storageEstimate', () => ({
  getStorageEstimate: vi.fn(async () => ({ usage: 12 * 1024 ** 3, quota: 0 })),
  formatBytes: (n: number) => `${n}`,
  clearImageCache: vi.fn(async () => {}),
}));
vi.mock('../../lib/imageCache', () => ({
  cachedImageStats: vi.fn(async () => ({ total: 12, prepared: 4, preparedBytes: 3000, browsing: 8 })),
}));

import OfflineTab from './OfflineTab';
import { useFeedStore } from '../../stores/feedStore';
import { clearImageCache } from '../../lib/storageEstimate';
import { cachedImageStats } from '../../lib/imageCache';
import { CONFIRM_GRACE_MS } from '../ConfirmDialog';

const setOnline = (v: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => v });

describe('Préférences › Hors ligne', () => {
  beforeEach(() => { vi.clearAllMocks(); setOnline(true); useFeedStore.setState({ offlinePrep: null, prepareOffline: vi.fn() } as never); });
  afterEach(() => { cleanup(); setOnline(true); });

  // Hors ligne, `prepareOffline` ne fait rien : le bouton cliquait dans le vide.
  it('hors ligne, le bouton de préparation est inactif et dit pourquoi', async () => {
    setOnline(false);
    await act(async () => { render(<OfflineTab />); });
    const button = screen.getByRole('button', { name: 'preferences.offline.button' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText('preferences.offline.needsNetwork')).toBeTruthy();
  });

  // Vider les images se faisait d'un clic, et le bouton restait « Images
  // supprimées » pour toujours, même une fois le cache rempli de nouveau.
  it('vider les images demande confirmation', async () => {
    await act(async () => { render(<OfflineTab />); });
    fireEvent.click(screen.getByRole('button', { name: 'preferences.offline.imagesClear' }));
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'preferences.offline.imagesClear' });
    fireEvent.click(confirm);
    expect(clearImageCache).not.toHaveBeenCalled();
    await act(async () => { await new Promise((r) => setTimeout(r, CONFIRM_GRACE_MS + 30)); });
    await act(async () => { fireEvent.click(confirm); });
    expect(clearImageCache).toHaveBeenCalledTimes(1);
    expect(screen.getByText('preferences.offline.imagesCleared')).toBeTruthy();
  });

  it('« Images supprimées » s’efface au retour sur la section', async () => {
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(<OfflineTab />); });
    fireEvent.click(screen.getByRole('button', { name: 'preferences.offline.imagesClear' }));
    await act(async () => { await new Promise((r) => setTimeout(r, CONFIRM_GRACE_MS + 30)); });
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'preferences.offline.imagesClear' })); });
    await act(async () => { view.rerender(<OfflineTab active={false} />); });
    await act(async () => { view.rerender(<OfflineTab active />); });
    expect(screen.queryByText('preferences.offline.imagesCleared')).toBeNull();
  });

  // « Espace utilisé : ~12 Go » pour quelques Mo d'images préparées : le
  // navigateur compte large chaque image d'un autre site gardée à la lecture.
  // L'onglet donne la taille réelle des images préparées, et dit pourquoi le
  // chiffre du navigateur est plus grand.
  it('donne la taille réelle des images préparées et explique le chiffre du navigateur', async () => {
    await act(async () => { render(<OfflineTab />); });
    expect(screen.getByText(/preferences\.offline\.imagesPrepared\{"count":4,"size":"3000"\}/)).toBeTruthy();
    expect(screen.getByText(/preferences\.offline\.imagesUsage\{/)).toBeTruthy();
    expect(screen.getByText('preferences.offline.imagesUsageNote')).toBeTruthy();
  });

  it('sans image gardée à la lecture, ni avertissement ni ligne vide', async () => {
    vi.mocked(cachedImageStats).mockResolvedValueOnce({ total: 3, prepared: 3, preparedBytes: 10, browsing: 0 });
    await act(async () => { render(<OfflineTab />); });
    expect(screen.queryByText('preferences.offline.imagesUsageNote')).toBeNull();
  });

  it('sans image préparée, pas de ligne « 0 préparée »', async () => {
    vi.mocked(cachedImageStats).mockResolvedValueOnce({ total: 5, prepared: 0, preparedBytes: 0, browsing: 5 });
    await act(async () => { render(<OfflineTab />); });
    expect(screen.queryByText(/imagesPrepared/)).toBeNull();
  });

  it('dit qu’une préparation s’est arrêtée faute de place, pas à cause du budget', async () => {
    useFeedStore.setState({ offlinePrep: { running: false, phase: 'done', done: 3, total: 3, imagesFound: 9, imagesStored: 2, imagesFailed: 7, deviceFull: true } } as never);
    await act(async () => { render(<OfflineTab />); });
    expect(screen.getByText(/imagesDeviceFull/)).toBeTruthy();
    expect(screen.queryByText(/imagesBudgetStopped/)).toBeNull();
  });
});

