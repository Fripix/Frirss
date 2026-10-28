// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREFS_POLL_MS, installPrefsRefreshTriggers } from './prefsRefreshTriggers';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

describe('installPrefsRefreshTriggers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility('visible');
  });
  afterEach(() => {
    vi.useRealTimers();
    setVisibility('visible');
  });

  it('relit les réglages à intervalle régulier tant que l’onglet reste affiché', () => {
    // Un onglet desktop laissé ouvert ne passe jamais en arrière-plan quand on
    // prend le téléphone : sans relecture périodique, il ne verrait rien.
    const refresh = vi.fn();
    const stop = installPrefsRefreshTriggers(refresh);
    vi.advanceTimersByTime(PREFS_POLL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(PREFS_POLL_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it('ne relit rien en arrière-plan : le retour au premier plan s’en charge', () => {
    const refresh = vi.fn();
    const stop = installPrefsRefreshTriggers(refresh);
    setVisibility('hidden');
    vi.advanceTimersByTime(PREFS_POLL_MS * 3);
    expect(refresh).not.toHaveBeenCalled();
    stop();
  });

  it('relit au retour au premier plan et quand la fenêtre reprend le focus', () => {
    const refresh = vi.fn();
    const stop = installPrefsRefreshTriggers(refresh);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3_000);
    window.dispatchEvent(new Event('focus'));
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it('une relecture récente rend la suivante inutile : focus et visibilité arrivent ensemble', () => {
    const refresh = vi.fn();
    const stop = installPrefsRefreshTriggers(refresh);
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    expect(refresh).toHaveBeenCalledTimes(1);
    // Le minuteur repart de la dernière relecture, pas de son propre départ.
    vi.advanceTimersByTime(PREFS_POLL_MS - 1);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it('se désinstalle entièrement', () => {
    const refresh = vi.fn();
    const stop = installPrefsRefreshTriggers(refresh);
    stop();
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    vi.advanceTimersByTime(PREFS_POLL_MS * 2);
    expect(refresh).not.toHaveBeenCalled();
  });
});
