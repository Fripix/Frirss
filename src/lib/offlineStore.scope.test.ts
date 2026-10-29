import { describe, it, expect } from 'vitest';
import { ownedByAccount, withoutSource } from './offlineStore';
import type { Article } from '../types';

/*
 * La base hors ligne est commune à tous les onglets et à tous les comptes du
 * navigateur : la déconnexion n'efface que les vues du compte qui part, et un
 * désabonnement retire le flux des listes de SA portée.
 */
describe('ownedByAccount', () => {
  it('reconnaît les vues du compte, tous serveurs confondus', () => {
    expect(ownedByAccount('7@1|feed/1:all', '7@')).toBe(true);
    expect(ownedByAccount('7@2|subscriptions', '7@')).toBe(true);
  });
  it('laisse celles des autres comptes, y compris un identifiant qui finit pareil', () => {
    expect(ownedByAccount('9@1|feed/1:all', '7@')).toBe(false);
    expect(ownedByAccount('17@1|feed/1:all', '7@')).toBe(false);
  });
  it('emporte les clés sans portée (avant 1.8.0), qui ne sont plus à personne', () => {
    expect(ownedByAccount('subscriptions', '7@')).toBe(true);
    expect(ownedByAccount('feed/1:all', '7@')).toBe(true);
  });
});

describe('withoutSource', () => {
  const a = (id: string, sourceId: string) => ({ id, sourceId }) as Article;
  const list = (key: string, ...articles: Article[]) => ({ key, articles });

  it('supprime les listes du flux retiré', () => {
    expect(withoutSource(list('7@1|feed/12:all'), '7@1|', 'feed/12')).toBe('delete');
    expect(withoutSource(list('7@1|feed/12:unread:oldest'), '7@1|', 'feed/12')).toBe('delete');
  });
  it('retire ses articles des autres listes de la portée', () => {
    expect(withoutSource(list('7@1|:all', a('x', 'feed/12'), a('y', 'feed/3')), '7@1|', 'feed/12')).toEqual([a('y', 'feed/3')]);
  });
  it('ne touche ni une liste sans ses articles, ni un flux au nom voisin, ni une autre portée', () => {
    expect(withoutSource(list('7@1|:all', a('y', 'feed/3')), '7@1|', 'feed/12')).toBeNull();
    expect(withoutSource(list('7@1|feed/123:all', a('z', 'feed/123')), '7@1|', 'feed/12')).toBeNull();
    expect(withoutSource(list('7@2|feed/12:all', a('x', 'feed/12')), '7@1|', 'feed/12')).toBeNull();
  });
});
