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

  describe('par vue et par serveur', () => {
    beforeEach(() => { useUiStore.setState({ randomViews: {}, feedSettings: {} }); });

    it('retient le choix sous son serveur, et le synchronise', () => {
      useUiStore.getState().setViewRandom('1', 'feed/1', true);
      expect(useUiStore.getState().randomViews).toEqual({ '1|feed/1': true });
      expect(JSON.parse(localStorage.getItem('frirss_randomViews')!)).toEqual({ '1|feed/1': true });
      expect(UI_SYNC_KEYS).toContain('randomViews');
    });

    it('le même numéro de flux sur un autre serveur est un autre choix', () => {
      useUiStore.getState().setViewRandom('1', 'feed/1', true);
      useUiStore.getState().setViewRandom('2', 'feed/1', true);
      useUiStore.getState().setViewRandom('1', 'feed/1', false);
      expect(useUiStore.getState().randomViews).toEqual({ '2|feed/1': true });
    });

    it('suit un renommage, sous le même serveur seulement', () => {
      useUiStore.getState().setViewRandom('1', 'user/-/label/Old', true);
      useUiStore.getState().setViewRandom('2', 'user/-/label/Old', true);
      useUiStore.getState().moveViewRandom('1', 'user/-/label/Old', 'user/-/label/New');
      expect(useUiStore.getState().randomViews).toEqual({ '1|user/-/label/New': true, '2|user/-/label/Old': true });
    });

    it('ne laisse pas passer une valeur illisible venue d’un autre appareil', () => {
      useUiStore.getState().applyServerPrefs({ randomViews: { '1|feed/1': true, '1|feed/2': 'oui' } } as never);
      expect(useUiStore.getState().randomViews).toEqual({ '1|feed/1': true });
      useUiStore.getState().applyServerPrefs({ randomViews: 'x' } as never);
      expect(useUiStore.getState().randomViews).toEqual({});
    });

    it('l’ordre d’un flux n’en dépend plus', () => {
      useUiStore.getState().setViewRandom('1', 'feed/1', true);
      useUiStore.getState().setFeedArticleOrder('feed/1', 'oldest');
      expect(useUiStore.getState().feedSettings['feed/1']).toEqual({ order: 'oldest' });
    });
  });
});
