// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import RefreshBanner from './RefreshBanner';
import { useFeedStore } from '../stores/feedStore';
import { useUiStore } from '../stores/uiStore';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

afterEach(cleanup);

/*
 * L'icône était une coche pour tout ce qui n'était ni en cours ni nouveau :
 * « La relève a échoué » s'affichait avec un ✓. Une icône par état.
 */
describe('bandeau de relève — une icône par état', () => {
  for (const [phase, totalNew, icon] of [
    ['done', 0, 'done'],
    ['done', 3, 'new'],
    ['failed', 0, 'failed'],
    ['timeout', 0, 'pending'],
    ['continuing', 0, 'pending'],
    ['continuing', 2, 'new'],
    ['timeout', 2, 'new'],
    ['failed', 2, 'failed'],
    ['running', 0, 'running'],
  ] as const) {
    it(`${phase}, ${totalNew} nouveau(x) → ${icon}`, () => {
      useFeedStore.setState({ refreshResult: null, refreshPhase: 'idle', hasRefreshToken: true } as never);
      const { container } = render(<RefreshBanner />);
      act(() => { useFeedStore.setState({ refreshResult: { totalNew }, refreshPhase: phase } as never); });
      expect(container.querySelector('.refresh-banner__icon')?.getAttribute('data-icon')).toBe(icon);
    });
  }
});

/*
 * L'invitation « Activer la relève des flux » partait au bout de 5 s, même
 * sous le focus clavier, qui retombait sur <body>. Et la croix, annoncée
 * « Fermer », oubliait en fait l'invitation pour toujours.
 */
describe('bandeau de relève — invitation au clavier', () => {
  it('attend tant que le focus est dedans, et dit ce que fait la croix', () => {
    vi.useFakeTimers();
    try {
      useUiStore.setState({ refreshHintDismissed: false } as never);
      useFeedStore.setState({ refreshResult: null, refreshPhase: 'idle', hasRefreshToken: false } as never);
      const c = render(<RefreshBanner />);
      act(() => { useFeedStore.setState({ refreshResult: { totalNew: 0 }, refreshPhase: 'done' } as never); });
      const enable = c.getByRole('button', { name: 'refresh.enable' });
      act(() => { enable.focus(); });
      act(() => { vi.advanceTimersByTime(20_000); });
      expect(useFeedStore.getState().refreshResult).not.toBeNull();
      expect(c.getByRole('button', { name: 'refresh.hintDismiss' })).toBeTruthy();
      act(() => { enable.blur(); });
      act(() => { vi.advanceTimersByTime(20_000); });
      expect(useFeedStore.getState().refreshResult).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});

/*
 * Deux chronomètres, le délai CSS de l'effacement et le `setTimeout`, dont un
 * seul repartait à chaque résultat : une deuxième relève à +3 s laissait le
 * texte invisible, boutons cliquables, de +5,5 s à +8 s.
 */
describe('bandeau de relève — un seul chronomètre', () => {
  const banner = (c: HTMLElement) => c.querySelector('.refresh-banner');

  it('un nouveau résultat repousse l’effacement', () => {
    vi.useFakeTimers();
    try {
      useFeedStore.setState({ refreshResult: null, refreshPhase: 'idle', hasRefreshToken: true } as never);
      const { container } = render(<RefreshBanner />);
      act(() => { useFeedStore.setState({ refreshResult: { totalNew: 0 }, refreshPhase: 'done' } as never); });
      act(() => { vi.advanceTimersByTime(3000); });
      act(() => { useFeedStore.setState({ refreshResult: { totalNew: 4 } } as never); });
      act(() => { vi.advanceTimersByTime(2500); });
      expect(banner(container)?.className).not.toContain('refresh-banner--leaving');
      act(() => { vi.advanceTimersByTime(2100); });
      expect(banner(container)?.className).toContain('refresh-banner--leaving');
      act(() => { vi.advanceTimersByTime(400); });
      expect(useFeedStore.getState().refreshResult).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('le focus arrivé pendant l’effacement l’annule', () => {
    vi.useFakeTimers();
    try {
      useUiStore.setState({ refreshHintDismissed: false } as never);
      useFeedStore.setState({ refreshResult: null, refreshPhase: 'idle', hasRefreshToken: false } as never);
      const c = render(<RefreshBanner />);
      act(() => { useFeedStore.setState({ refreshResult: { totalNew: 0 }, refreshPhase: 'done' } as never); });
      act(() => { vi.advanceTimersByTime(4700); });
      expect(banner(c.container)?.className).toContain('refresh-banner--leaving');
      act(() => { c.getByRole('button', { name: 'refresh.enable' }).focus(); });
      expect(banner(c.container)?.className).not.toContain('refresh-banner--leaving');
    } finally { vi.useRealTimers(); }
  });

  it('l’invitation se signale : sa rangée peut passer à la ligne', () => {
    useUiStore.setState({ refreshHintDismissed: false } as never);
    useFeedStore.setState({ refreshResult: { totalNew: 0 }, refreshPhase: 'done', hasRefreshToken: false } as never);
    const { container } = render(<RefreshBanner />);
    expect(banner(container)?.className).toContain('refresh-banner--hint');
  });
});
