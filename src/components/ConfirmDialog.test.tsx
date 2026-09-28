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
