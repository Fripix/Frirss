// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react';
import ConfirmDialog, { CONFIRM_GRACE_MS } from './ConfirmDialog';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

afterEach(cleanup);

function ouvrir(over: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const props = {
    open: true,
    title: 'Marquer 712 articles comme lus ?',
    message: 'Tous les flux',
    confirmLabel: 'Marquer lu',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  };
  return { props, ...render(<ConfirmDialog {...props} />) };
}

/** Franchit la grâce anti-double-clic, minuteurs réels : les tests qui
 *  attendent une promesse ne peuvent pas vivre sous minuteurs factices. */
async function franchirLaGrace() {
  await act(async () => { await new Promise((r) => setTimeout(r, CONFIRM_GRACE_MS + 30)); });
}

/** Avance le temps ET laisse React appliquer les états différés. */
function attendre(ms: number) {
  act(() => { vi.advanceTimersByTime(ms); });
}

describe('ConfirmDialog', () => {
  it('annonce le titre et le périmètre', () => {
    ouvrir();
    expect(screen.getByText('Marquer 712 articles comme lus ?')).toBeTruthy();
    expect(screen.getByText('Tous les flux')).toBeTruthy();
  });

  // La boîte se rend dans un PORTAIL sur `document.body` : elle n'est pas sous
  // le conteneur rendu par le test, d'où les requêtes sur le document.
  it('se déclare comme boîte de dialogue modale, nommée par son titre', () => {
    ouvrir();
    const dlg = document.body.querySelector('[role="dialog"]')!;
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    const titreId = dlg.getAttribute('aria-labelledby')!;
    expect(document.getElementById(titreId)?.textContent)
      .toBe('Marquer 712 articles comme lus ?');
  });

  /**
   * Le cœur de l'issue #17 : le « Confirmer ? » posé à la place du bouton
   * était validé par le second clic d'un double-clic. Deux gardes ici — le
   * bouton de validation n'est pas celui qui a le focus, et il n'accepte rien
   * pendant un court instant après l'ouverture.
   */
  it('donne le focus à Annuler, pas à la validation', () => {
    ouvrir();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'dialog.cancel' }));
  });

  it('ignore une validation trop rapprochée de l’ouverture', () => {
    vi.useFakeTimers();
    try {
      const { props } = ouvrir();
      fireEvent.click(screen.getByRole('button', { name: 'Marquer lu' }));
      expect(props.onConfirm).not.toHaveBeenCalled();

      attendre(CONFIRM_GRACE_MS + 10);
      fireEvent.click(screen.getByRole('button', { name: 'Marquer lu' }));
      expect(props.onConfirm).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * Sur un gros compte, le relevé des non-lus tourne encore quand on valide —
   * mesuré à ~1 s par millier d'articles sur l'instance de dev. Sans rien à
   * l'écran, la validation semble n'avoir rien fait, et on reclique.
   *
   * Ce qui s'affiche est le travail en cours, pas son objet : un libellé du
   * genre « préparation de l'annulation » parlerait d'un filet avant même que
   * l'action soit faite — mauvais signal. Même patron que le bouton
   * d'enregistrement de `RefreshTokenField` : rotation, `aria-busy`, libellé
   * inchangé.
   */
  it('montre que ça travaille tant que la validation n’a pas rendu la main', async () => {
    let resoudre: () => void = () => {};
    const onConfirm = vi.fn(() => new Promise<void>((r) => { resoudre = r; }));
    ouvrir({ onConfirm });
    await franchirLaGrace();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Marquer lu' })); });

    const valider = screen.getByRole('button', { name: 'Marquer lu' });
    expect(valider.getAttribute('aria-busy')).toBe('true');
    expect((valider as HTMLButtonElement).disabled).toBe(true);
    expect(valider.querySelector('svg.animate-spin')).toBeTruthy();
    expect(document.body.querySelector('[role="dialog"]')).toBeTruthy();

    await act(async () => { resoudre(); });
  });

  it('ignore les clics suivants pendant le travail', async () => {
    let resoudre: () => void = () => {};
    const onConfirm = vi.fn(() => new Promise<void>((r) => { resoudre = r; }));
    ouvrir({ onConfirm });
    await franchirLaGrace();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Marquer lu' })); });
    fireEvent.click(screen.getByRole('button', { name: 'Marquer lu' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await act(async () => { resoudre(); });
  });

  it('neutralise Annuler pendant le travail — l’action est déjà partie', async () => {
    let resoudre: () => void = () => {};
    const props = { onConfirm: vi.fn(() => new Promise<void>((r) => { resoudre = r; })), onCancel: vi.fn() };
    ouvrir(props);
    await franchirLaGrace();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Marquer lu' })); });
    fireEvent.click(screen.getByRole('button', { name: 'dialog.cancel' }));
    expect(props.onCancel).not.toHaveBeenCalled();

    await act(async () => { resoudre(); });
  });

  it('annule au clic sur Annuler', () => {
    const { props } = ouvrir();
    fireEvent.click(screen.getByRole('button', { name: 'dialog.cancel' }));
    expect(props.onCancel).toHaveBeenCalled();
  });

  it('annule sur Échap', () => {
    const { props } = ouvrir();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onCancel).toHaveBeenCalled();
  });

  it('annule au clic sur le fond', () => {
    const { props } = ouvrir();
    fireEvent.click(document.body.querySelector('.confirm-dialog-root')!);
    expect(props.onCancel).toHaveBeenCalled();
  });

  it('ne rend rien quand elle est fermée', () => {
    ouvrir({ open: false });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});
