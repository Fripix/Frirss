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

  // Idées de la campagne 1.9.0 : une préparation de 6 000 articles dure ~40 min,
  // sans moyen de l'arrêter ni de savoir combien de temps il reste.
  describe('préparation en cours : Annuler et durée restante', () => {
    it('propose « Annuler », qui arrête la préparation', async () => {
      const cancelOfflinePrep = vi.fn();
      useFeedStore.setState({ cancelOfflinePrep, offlinePrep: { running: true, phase: 'articles', done: 20, total: 6000, startedAt: Date.now() } } as never);
      await act(async () => { render(<OfflineTab />); });
      fireEvent.click(screen.getByRole('button', { name: 'preferences.offline.cancel' }));
      expect(cancelOfflinePrep).toHaveBeenCalledTimes(1);
    });

    it('n’offre pas « Annuler » quand rien ne tourne', async () => {
      await act(async () => { render(<OfflineTab />); });
      expect(screen.queryByRole('button', { name: 'preferences.offline.cancel' })).toBeNull();
    });

    it('dit combien de temps il reste, au rythme observé', async () => {
      // 100 articles en 40 s : 5 900 restants à 0,4 s → 39 min 20 s, dits 40.
      useFeedStore.setState({ cancelOfflinePrep: vi.fn(), offlinePrep: { running: true, phase: 'articles', done: 100, total: 6000, startedAt: Date.now() - 40_000 } } as never);
      await act(async () => { render(<OfflineTab />); });
      expect(screen.getByText('preferences.offline.etaMinutes{"count":40}')).toBeTruthy();
    });

    it('se tait tant que la mesure est trop jeune', async () => {
      useFeedStore.setState({ cancelOfflinePrep: vi.fn(), offlinePrep: { running: true, phase: 'articles', done: 2, total: 6000, startedAt: Date.now() - 1_000 } } as never);
      await act(async () => { render(<OfflineTab />); });
      expect(screen.queryByText(/preferences\.offline\.eta/)).toBeNull();
    });

    // M-07 (second round) : « Annuler », désactivé puis démonté sous le focus,
    // le renvoyait sur la page ; « Préparer », désactivé dès le clic, aussi.
    describe('focus (M-07)', () => {
      const running = { running: true, phase: 'articles', done: 0, total: 10, startedAt: Date.now() };

      it('« Préparer » donne le focus à « Annuler »', async () => {
        const prepareOffline = vi.fn(() => { useFeedStore.setState({ offlinePrep: running } as never); });
        useFeedStore.setState({ prepareOffline, cancelOfflinePrep: vi.fn() } as never);
        await act(async () => { render(<OfflineTab />); });
        const prepare = screen.getByRole('button', { name: 'preferences.offline.button' });
        prepare.focus();
        await act(async () => { fireEvent.click(prepare); });
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'preferences.offline.cancel' }));
      });

      it('« Annuler » garde le focus pendant l’arrêt, puis le rend à « Préparer » qui revient', async () => {
        useFeedStore.setState({ cancelOfflinePrep: vi.fn(), offlinePrep: running } as never);
        await act(async () => { render(<OfflineTab />); });
        const cancel = screen.getByRole('button', { name: 'preferences.offline.cancel' });
        cancel.focus();
        await act(async () => { fireEvent.click(cancel); });
        // « Arrêt… » : toujours le même bouton, toujours focalisé, et inerte.
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'preferences.offline.cancelling' }));
        expect(document.activeElement?.getAttribute('aria-disabled')).toBe('true');
        await act(async () => { useFeedStore.setState({ offlinePrep: { running: false, phase: 'done', done: 3, total: 10, cancelled: true } } as never); });
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'preferences.offline.button' }));
      });

      it('une préparation qui finit seule, focus sur « Annuler » : le focus revient à « Préparer »', async () => {
        useFeedStore.setState({ cancelOfflinePrep: vi.fn(), offlinePrep: running } as never);
        await act(async () => { render(<OfflineTab />); });
        screen.getByRole('button', { name: 'preferences.offline.cancel' }).focus();
        await act(async () => { useFeedStore.setState({ offlinePrep: { running: false, phase: 'done', done: 10, total: 10 } } as never); });
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'preferences.offline.button' }));
      });

      it('le focus posé ailleurs n’est pas déplacé à la fin', async () => {
        useFeedStore.setState({ cancelOfflinePrep: vi.fn(), offlinePrep: running } as never);
        await act(async () => { render(<OfflineTab />); });
        const elsewhere = screen.getByRole('button', { name: 'preferences.offline.imagesClear' });
        elsewhere.focus();
        await act(async () => { useFeedStore.setState({ offlinePrep: { running: false, phase: 'done', done: 10, total: 10 } } as never); });
        expect(document.activeElement).toBe(elsewhere);
      });
    });

    // Idée du troisième round 1.9.0 : jusqu'à 15 s sans un mot pendant les
    // reprises, puis « Hors ligne prêt (6) » sans un seul article complet.
    describe('attente du serveur et compte rendu honnête', () => {
      it('pendant l’attente d’une reprise, dit qu’elle attend le serveur, à la place de la durée', async () => {
        useFeedStore.setState({ cancelOfflinePrep: vi.fn(), offlinePrep: { running: true, phase: 'articles', done: 100, total: 6000, startedAt: Date.now() - 40_000, waitingServer: 2 } } as never);
        await act(async () => { render(<OfflineTab />); });
        expect(screen.getByRole('status').textContent).toBe('preferences.offline.waitingServer{"count":2}');
        expect(screen.queryByText(/preferences\.offline\.eta/)).toBeNull();
      });

      it('ne compte pas comme complets les articles restés sans article complet', async () => {
        useFeedStore.setState({ offlinePrep: { running: false, phase: 'done', done: 6, total: 6, wantFull: 6, missingFull: 6 } } as never);
        await act(async () => { render(<OfflineTab />); });
        expect(screen.getByText('preferences.offline.doneMissing{"count":6,"full":0,"wanted":6}')).toBeTruthy();
        expect(screen.getByText('preferences.offline.missingFull{"count":6}')).toBeTruthy();
        expect(screen.queryByText(/preferences\.offline\.done \(/)).toBeNull();
      });

      it('tout obtenu : « Hors ligne prêt (n) », sans ligne de plus', async () => {
        useFeedStore.setState({ offlinePrep: { running: false, phase: 'done', done: 6, total: 6, missingFull: 0 } } as never);
        await act(async () => { render(<OfflineTab />); });
        expect(screen.getByText('preferences.offline.done (6)')).toBeTruthy();
        expect(screen.queryByText(/missingFull/)).toBeNull();
      });

      // Relecture du troisième round : « 4 articles complets sur 6 » comptait
      // les articles d’un flux réglé « Non » (contenu du flux, voulu) comme
      // complets, et se disait aussi d’une préparation interrompue.
      it('les articles d’un flux réglé « Non » ne sont pas comptés comme complets : prêts, dont ceux qui ont l’article complet attendu', async () => {
        useFeedStore.setState({ offlinePrep: { running: false, phase: 'done', done: 6, total: 6, wantFull: 2, missingFull: 2 } } as never);
        await act(async () => { render(<OfflineTab />); });
        expect(screen.getByText('preferences.offline.doneMissing{"count":6,"full":0,"wanted":2}')).toBeTruthy();
        expect(screen.getByText('preferences.offline.missingFull{"count":2}')).toBeTruthy();
      });

      it('une préparation interrompue (réseau coupé, autre serveur) se dit arrêtée, pas « prête »', async () => {
        useFeedStore.setState({ offlinePrep: { running: false, phase: 'done', done: 3, total: 6, wantFull: 3, missingFull: 0 } } as never);
        await act(async () => { render(<OfflineTab />); });
        expect(screen.getByText('preferences.offline.cancelledReport{"done":3,"total":6,"count":6}')).toBeTruthy();
        expect(screen.queryByText(/preferences\.offline\.done/)).toBeNull();
      });

      it('une préparation annulée dit aussi ce qui manque', async () => {
        useFeedStore.setState({ offlinePrep: { running: false, phase: 'done', done: 3, total: 6, missingFull: 1, cancelled: true } } as never);
        await act(async () => { render(<OfflineTab />); });
        expect(screen.getByText('preferences.offline.missingFull{"count":1}')).toBeTruthy();
      });
    });

    it('une préparation annulée le dit, et ne se dit pas « prête »', async () => {
      useFeedStore.setState({ offlinePrep: { running: false, phase: 'done', done: 120, total: 6068, cancelled: true } } as never);
      await act(async () => { render(<OfflineTab />); });
      expect(screen.getByText('preferences.offline.cancelledReport{"done":120,"total":6068,"count":6068}')).toBeTruthy();
      expect(screen.queryByText(/preferences\.offline\.done/)).toBeNull();
    });
  });
});

