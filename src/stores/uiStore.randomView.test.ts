// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore, UI_SYNC_KEYS } from './uiStore';

describe('uiStore — affichage aléatoire', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ randomCount: 20, randomWindowAmount: 0, randomWindowUnit: 'hours' });
  });

  it('retient le nombre et l’ancienneté, et les synchronise', () => {
    useUiStore.getState().setRandomCount(35);
    useUiStore.getState().setRandomWindow(3, 'days');
    expect(useUiStore.getState()).toMatchObject({ randomCount: 35, randomWindowAmount: 3, randomWindowUnit: 'days' });
    expect(JSON.parse(localStorage.getItem('frirss_randomCount')!)).toBe(35);
    expect(JSON.parse(localStorage.getItem('frirss_randomWindowUnit')!)).toBe('days');
    expect(UI_SYNC_KEYS).toEqual(expect.arrayContaining(['randomCount', 'randomWindowAmount', 'randomWindowUnit']));
  });

  it('borne ce qu’on lui donne', () => {
    useUiStore.getState().setRandomCount(9999);
    expect(useUiStore.getState().randomCount).toBe(20);
  });

  it('une valeur illisible venue d’un autre appareil revient au défaut', () => {
    useUiStore.getState().applyServerPrefs({ randomCount: 'x', randomWindowAmount: -4, randomWindowUnit: 'weeks' } as never);
    expect(useUiStore.getState()).toMatchObject({ randomCount: 20, randomWindowAmount: 0, randomWindowUnit: 'hours' });
  });

  it('une valeur lisible passe', () => {
    useUiStore.getState().applyServerPrefs({ randomCount: 100, randomWindowAmount: 6, randomWindowUnit: 'days' } as never);
    expect(useUiStore.getState()).toMatchObject({ randomCount: 100, randomWindowAmount: 6, randomWindowUnit: 'days' });
  });
});
