// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, act } from '@testing-library/react';
import MobileStack from './MobileStack';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// Sur téléphone, l'article recouvre la liste, qui reste montée derrière
// (position de défilement) : la tabulation parcourait les 40 lignes cachées
// avant d'atteindre l'article, et un lecteur d'écran les lisait.
describe('MobileStack — une seule vue atteignable', () => {
  const base = <button>Ligne de la liste</button>;
  const overlay = <button>Retour</button>;
  const container = (name: string) => screen.getByText(name).parentElement as HTMLElement;

  it('article ouvert : la liste derrière est inerte, l’article ne l’est pas', () => {
    render(<MobileStack showOverlay base={base} overlay={overlay} />);
    expect(container('Ligne de la liste').hasAttribute('inert')).toBe(true);
    expect(container('Retour').hasAttribute('inert')).toBe(false);
  });

  it('article fermé : la liste est atteignable', () => {
    render(<MobileStack showOverlay={false} base={base} overlay={null} />);
    expect(container('Ligne de la liste').hasAttribute('inert')).toBe(false);
  });

  it('pendant l’animation de sortie, l’article qui glisse est déjà inerte', () => {
    vi.useFakeTimers();
    const { rerender } = render(<MobileStack showOverlay base={base} overlay={overlay} />);
    act(() => { vi.advanceTimersByTime(50); });
    rerender(<MobileStack showOverlay={false} base={base} overlay={null} />);
    // Encore monté (400 ms d'animation), plus atteignable.
    expect(container('Retour').hasAttribute('inert')).toBe(true);
    expect(container('Ligne de la liste').hasAttribute('inert')).toBe(false);
  });
});
