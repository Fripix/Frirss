// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
const updateServiceWorker = vi.fn();
const sw = vi.hoisted(() => ({ needRefresh: true }));
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [sw.needRefresh, () => {}], updateServiceWorker }),
}));

import UpdatePrompt, { UPDATE_RELOAD_FALLBACK_MS } from './UpdatePrompt';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); updateServiceWorker.mockClear(); });

/*
 * Le rideau « Mise à jour… » attend que le nouveau service worker prenne la
 * main, puis recharge. Un rechargement fait pendant ses 700 ms laissait la
 * page suivante devant un service worker déjà actif : l'événement attendu ne
 * venait plus, et le rideau restait affiché pour toujours. Passé un délai, la
 * page se recharge d'elle-même.
 */
describe('UpdatePrompt', () => {
  it('demande la nouvelle version, puis recharge d’elle-même si rien ne vient', () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload } as Location);
    render(<UpdatePrompt />);
    act(() => { vi.advanceTimersByTime(700); });
    expect(updateServiceWorker).toHaveBeenCalledWith(true);
    expect(reload).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(UPDATE_RELOAD_FALLBACK_MS); });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // Montée avec son texte, la région n'était souvent pas annoncée
  // (liveRegions.test) : elle reste montée, vide au repos.
  it('garde sa région annoncée montée, vide au repos', () => {
    sw.needRefresh = false;
    try {
      const c = render(<UpdatePrompt />);
      const region = c.getByRole('status');
      expect(region.textContent).toBe('');
    } finally { sw.needRefresh = true; }
  });
});
