// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, act, within } from '@testing-library/react';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../lib/storageEstimate', () => ({
  getStorageEstimate: vi.fn(async () => ({ usage: 0, quota: 0 })),
  formatBytes: (n: number) => `${n}`,
  clearImageCache: vi.fn(async () => {}),
}));
vi.mock('../../lib/imageCache', () => ({ countCachedImages: vi.fn(async () => 12) }));

import OfflineTab from './OfflineTab';
import { useFeedStore } from '../../stores/feedStore';
import { clearImageCache } from '../../lib/storageEstimate';
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
});
