// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
import { LabelGroupHeader } from './Sidebar';

afterEach(cleanup);

/*
 * Un groupe d'étiquettes dont le parent est lui-même une étiquette : le clic
 * ouvre ses articles, replier passait par le double-clic ou par le chevron —
 * un <span onClick> sans rôle ni tabulation, de 16 px. Au clavier, on ne
 * pouvait ni replier ni déplier.
 */
describe('LabelGroupHeader — replier au clavier', () => {
  const props = { name: 'Hardware', isCollapsed: false, isSelected: false, hasParentTag: true, onToggle: vi.fn(), onViewArticles: vi.fn(), labelColor: null };

  it('le chevron est un bouton qui dit son état et replie', () => {
    const p = { ...props, onToggle: vi.fn(), onViewArticles: vi.fn() };
    const c = render(<LabelGroupHeader {...p} />);
    const chevron = c.getByRole('button', { name: 'sidebar.collapse Hardware' });
    expect(chevron.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(chevron);
    expect(p.onToggle).toHaveBeenCalledTimes(1);
    expect(p.onViewArticles).not.toHaveBeenCalled();
  });

  it('replié, il le dit aussi', () => {
    const c = render(<LabelGroupHeader {...props} isCollapsed />);
    expect(c.getByRole('button', { name: 'sidebar.expand Hardware' }).getAttribute('aria-expanded')).toBe('false');
  });

  // Un lecteur d'écran lisait N fois « Replier » sans savoir de quel groupe.
  // Le nom vient de l'étiquette du groupe, sans nouvelle chaîne à traduire.

  // Le premier clic armait un minuteur que le second écrasait sans l'annuler :
  // un double-clic repliait ET ouvrait les articles.
  it('un double-clic replie sans ouvrir les articles', () => {
    vi.useFakeTimers();
    try {
      const p = { ...props, onToggle: vi.fn(), onViewArticles: vi.fn() };
      const c = render(<LabelGroupHeader {...p} />);
      const main = c.getByText('Hardware').closest('button')!;
      fireEvent.click(main, { detail: 1 });
      fireEvent.click(main, { detail: 2 });
      fireEvent.doubleClick(main, { detail: 2 });
      act(() => { vi.advanceTimersByTime(1000); });
      expect(p.onToggle).toHaveBeenCalledTimes(1);
      expect(p.onViewArticles).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  // Deux activations sans `dblclick` (Entrée deux fois, double-tape d'un
  // navigateur tactile qui n'en émet pas) : le second clic annulait le premier
  // et rien ne se passait. Seul le second clic d'un vrai double-clic
  // (`detail` 2) annule l'ouverture.
  it('deux activations au clavier ouvrent les articles une fois', () => {
    vi.useFakeTimers();
    try {
      const p = { ...props, onToggle: vi.fn(), onViewArticles: vi.fn() };
      const c = render(<LabelGroupHeader {...p} />);
      const main = c.getByText('Hardware').closest('button')!;
      fireEvent.click(main, { detail: 0 });
      fireEvent.click(main, { detail: 0 });
      act(() => { vi.advanceTimersByTime(1000); });
      expect(p.onViewArticles).toHaveBeenCalledTimes(1);
      expect(p.onToggle).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
