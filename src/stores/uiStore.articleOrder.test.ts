// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore, UI_SYNC_KEYS } from './uiStore';

describe('uiStore — ordre des articles', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ feedSettings: {} });
  });

  it("liste les plus récents d'abord par défaut", () => {
    expect(useUiStore.getState().articleOrder).toBe('newest');
  });

  it('setArticleOrder retient le choix global et le persiste', () => {
    useUiStore.getState().setArticleOrder('oldest');
    expect(useUiStore.getState().articleOrder).toBe('oldest');
    expect(JSON.parse(localStorage.getItem('frirss_articleOrder')!)).toBe('oldest');
  });

  it('articleOrder est synchronisé entre appareils', () => {
    expect(UI_SYNC_KEYS).toContain('articleOrder');
  });

  it('setFeedOrder pose la surcharge du flux sans toucher à ses autres réglages', () => {
    useUiStore.getState().setFeedLayout('feed/1', 'grid');
    useUiStore.getState().setFeedArticleOrder('feed/1', 'oldest');
    expect(useUiStore.getState().feedSettings['feed/1']).toEqual({ layout: 'grid', order: 'oldest' });
  });

  it("setFeedOrder avec '' retire la surcharge, et l'entrée vide avec elle", () => {
    useUiStore.getState().setFeedArticleOrder('feed/1', 'oldest');
    useUiStore.getState().setFeedArticleOrder('feed/1', '');
    expect(useUiStore.getState().feedSettings).toEqual({});
    expect(JSON.parse(localStorage.getItem('frirss_feedSettings')!)).toEqual({});
  });

  it('applyServerPrefs reprend un ordre global venu du serveur', () => {
    useUiStore.getState().applyServerPrefs({ articleOrder: 'oldest' });
    expect(useUiStore.getState().articleOrder).toBe('oldest');
    expect(JSON.parse(localStorage.getItem('frirss_articleOrder')!)).toBe('oldest');
  });

  it('applyServerPrefs ignore une valeur inconnue plutôt que de la stocker', () => {
    useUiStore.getState().setArticleOrder('newest');
    useUiStore.getState().applyServerPrefs({ articleOrder: 'random' });
    expect(useUiStore.getState().articleOrder).toBe('newest');
  });
});
