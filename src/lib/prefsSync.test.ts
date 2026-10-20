// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../api/backend', () => ({
  getPreferences: vi.fn(),
  savePreferences: vi.fn(),
}));

import { getPreferences, savePreferences } from '../api/backend';
import { hydratePrefs, stopSync } from './prefsSync';
import { useUiStore } from '../stores/uiStore';

const get = vi.mocked(getPreferences);
const save = vi.mocked(savePreferences);

const http = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

/**
 * Un échec de lecture n'est PAS un compte sans préférences. Le confondre
 * réécrivait toutes les préférences synchronisées du compte avec l'état local
 * de ce navigateur — par exemple le résumé IA automatique, remis à faux par la
 * déconnexion, écrasait le vrai enregistré, sur tous les appareils.
 */
describe('hydratePrefs — lecture en échec', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    get.mockReset();
    save.mockReset().mockResolvedValue(undefined);
    useUiStore.setState({ showFavicons: true });
  });

  afterEach(() => {
    stopSync();
    vi.useRealTimers();
  });

  it.each([
    ['une erreur 500', http(500)],
    ['une erreur réseau', new Error('Network Error')],
  ])('%s : rien n’est écrit sur le serveur', async (_label, err) => {
    get.mockRejectedValue(err);
    await hydratePrefs();
    expect(save).not.toHaveBeenCalled();

    // Pas d'écriture différée non plus : la synchronisation pousse l'instantané
    // COMPLET, donc le moindre changement local écraserait le serveur pareil.
    useUiStore.setState({ showFavicons: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
  });

  it('une erreur ne touche pas aux préférences locales', async () => {
    get.mockRejectedValue(http(503));
    await hydratePrefs();
    expect(useUiStore.getState().showFavicons).toBe(true);
  });

  it('réessaie plus tard, et la lecture réussie décide', async () => {
    get.mockRejectedValueOnce(http(502)).mockResolvedValue({ showFavicons: false });
    await hydratePrefs();
    expect(get).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(get).toHaveBeenCalledTimes(2);
    expect(useUiStore.getState().showFavicons).toBe(false);
    expect(save).not.toHaveBeenCalled();

    // La synchronisation tourne enfin : un changement est poussé.
    useUiStore.setState({ showFavicons: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('ne réessaie pas après un 401 : la session est terminée', async () => {
    get.mockRejectedValue(http(401));
    await hydratePrefs();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(get).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it('la déconnexion annule le nouvel essai en attente', async () => {
    get.mockRejectedValue(new Error('Network Error'));
    await hydratePrefs();
    stopSync();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('hydratePrefs — compte réellement neuf', () => {
  beforeEach(() => {
    get.mockReset();
    save.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => stopSync());

  it('un 200 avec {} amorce le serveur depuis l’état local', async () => {
    get.mockResolvedValue({});
    useUiStore.setState({ showFavicons: false });
    await hydratePrefs();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({ showFavicons: false });
  });

  it('un compte qui a déjà des préférences n’est pas réamorcé', async () => {
    get.mockResolvedValue({ showFavicons: true });
    await hydratePrefs();
    expect(save).not.toHaveBeenCalled();
  });
});
