import { describe, it, expect } from 'vitest';
import { normalizeStartupView, startupAction } from './startupView';
import type { Subscription } from '../types';

// Discussion #19 : FriRSS rouvrait toujours la dernière vue quittée ; un
// lecteur veut une vue de départ fixe (Non lus, Tous les flux) à chaque
// lancement et rechargement, quoi qu'il ait consulté avant.
const feed = { id: 'feed/1', title: 'Un' } as Subscription;

describe('normalizeStartupView', () => {
  it('ne connaît que trois valeurs et retombe sur « dernière vue »', () => {
    expect(normalizeStartupView('all')).toBe('all');
    expect(normalizeStartupView('unread')).toBe('unread');
    expect(normalizeStartupView('last')).toBe('last');
    expect(normalizeStartupView('starred')).toBe('last');
    expect(normalizeStartupView(undefined)).toBe('last');
  });
});

describe('startupAction', () => {
  it('« dernière vue » rouvre la vue enregistrée, comme avant', () => {
    expect(startupAction('last', { feed, filter: 'unread' })).toEqual({ kind: 'restore', view: { feed, filter: 'unread' } });
  });

  it('« dernière vue » sans enregistrement ouvre l’accueil tel quel', () => {
    expect(startupAction('last', null)).toEqual({ kind: 'default' });
  });

  it('« Tous les flux » et « Non lus » ignorent la vue enregistrée', () => {
    expect(startupAction('all', { feed, filter: 'unread' })).toEqual({ kind: 'home-all' });
    expect(startupAction('unread', { feed, filter: 'all' })).toEqual({ kind: 'home-unread' });
  });
});
