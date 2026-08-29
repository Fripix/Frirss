import { describe, it, expect } from 'vitest';
import { markAllReadAction, canMarkAllRead } from './markAllRead';

describe('markAllReadAction', () => {
  it('marks immediately when confirmation is disabled', () => {
    expect(markAllReadAction(false, false)).toBe('mark');
    expect(markAllReadAction(false, true)).toBe('mark');
  });

  it('asks first, then marks, when confirmation is enabled', () => {
    expect(markAllReadAction(true, false)).toBe('ask');
    expect(markAllReadAction(true, true)).toBe('mark');
  });
});

describe('canMarkAllRead', () => {
  // Le bouton ne connaissait pas le filtre : depuis Favoris ou À lire plus
  // tard, il marquait TOUTE la liste de lecture, alors que son libellé se lit
  // « marquer ces articles comme lus ». Il n'y a pas de flux « favoris » à
  // vider, donc la seule réponse honnête est de ne pas proposer l'action.
  it('is offered on the article views', () => {
    expect(canMarkAllRead('all')).toBe(true);
    expect(canMarkAllRead('unread')).toBe(true);
  });

  it('is withheld where its scope would not match what is shown', () => {
    expect(canMarkAllRead('starred')).toBe(false);
    expect(canMarkAllRead('readlater')).toBe(false);
  });
});
