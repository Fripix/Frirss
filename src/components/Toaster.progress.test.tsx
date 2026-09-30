// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react';
import Toaster from './Toaster';
import { useUiStore } from '../stores/uiStore';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

beforeEach(() => { useUiStore.setState({ toasts: [] }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

/**
 * L'annulation d'un « tout marquer comme lu » peut durer une dizaine de
 * secondes (une écriture par centaine d'articles). Elle n'avait pour seul
 * signe qu'une barre de 3 px en haut de la fenêtre, quand le regard est resté
 * en bas, sur le bandeau qu'on vient de cliquer : « c'est vraiment peu visible
 * que c'est en cours » (2026-09-30).
 *
 * Le bandeau reste donc, et devient lui-même l'avancement.
 */
describe('Toaster — avancement dans le bandeau', () => {
  it('montre l’avancement chiffré et sa jauge', () => {
    act(() => { useUiStore.getState().pushToast('Annulation…', { progress: { done: 300, total: 1200 } }); });
    render(<Toaster />);

    const jauge = document.querySelector('.toast__progress') as HTMLElement;
    expect(jauge).toBeTruthy();
    expect(jauge.style.width).toBe('25%');
    expect(screen.getByRole('status').textContent).toContain('Annulation…');
  });

  it('ne s’efface pas tant que le travail tourne', () => {
    vi.useFakeTimers();
    act(() => { useUiStore.getState().pushToast('Annulation…', { progress: { done: 1, total: 10 } }); });
    render(<Toaster />);

    act(() => { vi.advanceTimersByTime(30_000); });

    expect(document.querySelector('.toast')).toBeTruthy();
  });

  it('s’efface une fois l’avancement retiré', () => {
    vi.useFakeTimers();
    let id = 0;
    act(() => { id = useUiStore.getState().pushToast('Annulation…', { progress: { done: 1, total: 10 } }); });
    render(<Toaster />);

    act(() => { useUiStore.getState().updateToast(id, { message: 'Terminé', progress: undefined }); });
    act(() => { vi.advanceTimersByTime(10_000); });

    expect(document.querySelector('.toast')).toBeNull();
  });

  /**
   * Une action qui rend une promesse a du travail devant elle : le bandeau lui
   * appartient jusqu'à ce qu'elle le relâche. Une action ordinaire, elle, ferme
   * le bandeau comme avant.
   */
  it('garde le bandeau quand l’action rend une promesse', () => {
    act(() => {
      useUiStore.getState().pushToast('Marqué comme lu', {
        action: { label: 'Annuler', run: () => new Promise<void>(() => {}) },
      });
    });
    render(<Toaster />);

    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));

    expect(document.querySelector('.toast')).toBeTruthy();
  });

  it('ferme le bandeau quand l’action est immédiate', () => {
    act(() => {
      useUiStore.getState().pushToast('Copié', { action: { label: 'Annuler', run: () => {} } });
    });
    render(<Toaster />);

    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));

    expect(document.querySelector('.toast')).toBeNull();
  });
});
