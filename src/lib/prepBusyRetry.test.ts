import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PREP_BUSY_RETRY_DELAYS_MS, waitUnless } from './prepBusyRetry';

describe('préparation hors ligne — reprise des articles refusés pour occupation', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('deux reprises au plus, après une attente courte et croissante', () => {
    expect(PREP_BUSY_RETRY_DELAYS_MS).toHaveLength(2);
    expect(PREP_BUSY_RETRY_DELAYS_MS[0]).toBeGreaterThan(0);
    expect(PREP_BUSY_RETRY_DELAYS_MS[1]).toBeGreaterThan(PREP_BUSY_RETRY_DELAYS_MS[0]);
    // Courte : la file du serveur se libère en 10 s au plus (délai du worker).
    expect(PREP_BUSY_RETRY_DELAYS_MS[1]).toBeLessThanOrEqual(15_000);
  });

  it('attend toute la durée quand rien ne l’arrête', async () => {
    let settled: boolean | undefined;
    void waitUnless(1_000, () => false).then((v) => { settled = v; });
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });

  it('rend la main dans le quart de seconde quand l’arrêt est demandé', async () => {
    let stop = false;
    let settled: boolean | undefined;
    void waitUnless(10_000, () => stop).then((v) => { settled = v; });
    await vi.advanceTimersByTimeAsync(1_000);
    stop = true;
    await vi.advanceTimersByTimeAsync(250);
    expect(settled).toBe(false);
  });

  it('ne part pas du tout si l’arrêt est déjà demandé', async () => {
    await expect(waitUnless(10_000, () => true)).resolves.toBe(false);
  });
});
