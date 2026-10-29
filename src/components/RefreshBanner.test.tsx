// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import RefreshBanner from './RefreshBanner';
import { useFeedStore } from '../stores/feedStore';

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
