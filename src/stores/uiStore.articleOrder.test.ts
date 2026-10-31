// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useUiStore, UI_SYNC_KEYS } from './uiStore';
import { useAuthStore } from './authStore';

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

describe('uiStore — ordre et disposition par serveur', () => {
  const server = (id: string | null) => useAuthStore.setState({ activeServerId: id } as never);
  beforeEach(() => { localStorage.clear(); useUiStore.setState({ feedSettings: {} }); server('1'); });
  afterEach(() => { server(null); });

  it('range le choix sous le serveur actif', () => {
    useUiStore.getState().setFeedArticleOrder('feed/1', 'oldest');
    useUiStore.getState().setFeedLayout('feed/1', 'grid');
    expect(useUiStore.getState().feedSettings).toEqual({ '1|feed/1': { order: 'oldest', layout: 'grid' } });
  });

  it('écrire retire l’ancien réglage, pour qu’un « Défaut » tienne', () => {
    useUiStore.setState({ feedSettings: { 'feed/1': { order: 'oldest', autoExtract: true } } });
    useUiStore.getState().setFeedArticleOrder('feed/1', '');
    expect(useUiStore.getState().feedSettings).toEqual({ 'feed/1': { autoExtract: true } });
  });

  it('deux serveurs gardent chacun leur choix', () => {
    useUiStore.getState().setFeedArticleOrder('feed/1', 'oldest');
    server('2');
    useUiStore.getState().setFeedArticleOrder('feed/1', 'newest');
    expect(useUiStore.getState().feedSettings).toEqual({ '1|feed/1': { order: 'oldest' }, '2|feed/1': { order: 'newest' } });
  });

  describe('adoption des réglages de la version publiée', () => {
    const adopt = () => useUiStore.getState().adoptFeedOverrides('1');

    it('rattache ordre et disposition au serveur actif, sans rien perdre', () => {
      useUiStore.setState({ feedSettings: { 'feed/1': { order: 'oldest', layout: 'grid', autoExtract: true }, 'feed/2': { layout: '2' } } });
      adopt();
      expect(useUiStore.getState().feedSettings).toEqual({
        'feed/1': { autoExtract: true }, '1|feed/1': { order: 'oldest', layout: 'grid' }, '1|feed/2': { layout: '2' },
      });
    });

    it('persiste', () => {
      useUiStore.setState({ feedSettings: { 'feed/2': { layout: '2' } } });
      adopt();
      expect(JSON.parse(localStorage.getItem('frirss_feedSettings')!)).toEqual({ '1|feed/2': { layout: '2' } });
    });

    it('ne remplace pas un choix déjà fait sur ce serveur', () => {
      useUiStore.setState({ feedSettings: { 'feed/1': { order: 'oldest' }, '1|feed/1': { order: 'newest' } } });
      adopt();
      expect(useUiStore.getState().feedSettings).toEqual({ '1|feed/1': { order: 'newest' } });
    });

    it('rejouée, elle ne change rien et n’écrit pas', () => {
      useUiStore.setState({ feedSettings: { 'feed/1': { order: 'oldest' } } });
      adopt();
      const before = useUiStore.getState().feedSettings;
      adopt();
      expect(useUiStore.getState().feedSettings).toBe(before);
    });

    it('laisse tranquilles les autres réglages et les autres serveurs', () => {
      const settings = { 'feed/1': { autoExtract: true }, '2|feed/1': { order: 'oldest' as const } };
      useUiStore.setState({ feedSettings: settings });
      adopt();
      expect(useUiStore.getState().feedSettings).toBe(settings);
    });
  });
});
