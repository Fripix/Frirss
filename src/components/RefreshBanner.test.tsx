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
