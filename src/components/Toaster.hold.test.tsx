// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import Toaster from './Toaster';
import { useUiStore } from '../stores/uiStore';

/*
 * Un bandeau qui propose une action (« Annuler » après « Tout lu ») partait
 * au bout de 6,5 s, même pendant qu'on visait son bouton : au clavier ou au
 * lecteur d'écran, l'atteindre prend souvent plus, et le focus retombait sur
 * <body> — l'annulation était perdue (WCAG 2.2.1). Il attend désormais tant
 * que la souris le survole ou que le focus y est.
 */
describe('Toaster — un bandeau visé ne part pas', () => {
  beforeEach(() => { vi.useFakeTimers(); useUiStore.setState({ toasts: [] }); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  const push = () => act(() => { useUiStore.getState().pushToast('fait', { action: { label: 'Annuler', run: () => {} } }); });

  it('attend tant que la souris le survole', () => {
    const c = render(<Toaster />);
    push();
    fireEvent.mouseEnter(c.container.querySelector('.toast')!);
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(useUiStore.getState().toasts).toHaveLength(1);
    fireEvent.mouseLeave(c.container.querySelector('.toast')!);
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(useUiStore.getState().toasts).toHaveLength(0);
  });

  it('attend tant que le focus est sur son bouton', () => {
    const c = render(<Toaster />);
    push();
    const btn = c.getByRole('button', { name: 'Annuler' });
    fireEvent.focus(btn);
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(useUiStore.getState().toasts).toHaveLength(1);
    fireEvent.blur(btn);
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(useUiStore.getState().toasts).toHaveLength(0);
  });
});
