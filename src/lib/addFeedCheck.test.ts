import { describe, it, expect } from 'vitest';
import { newCategoryChoice, subscribedFeed } from './addFeedCheck';
import type { Subscription } from '../types';

const owners = {
  labels: ['user/-/label/Lire'],
  categories: ['user/-/label/Tech', 'user/-/label/Vide'],
};

// « Ajouter un flux » laissait passer « / », le nom d'une étiquette (erreur
// générique) et créait une catégorie « tech » à côté de « Tech » (R3T1-3).
describe('newCategoryChoice — nom d’une nouvelle catégorie dans « Ajouter un flux »', () => {
  it('refuse la barre oblique, comme Préférences', () => {
    expect(newCategoryChoice('Tech/Web', owners)).toEqual({ issue: 'slash', id: null, label: '' });
  });
  it('refuse le nom d’une étiquette, casse comprise', () => {
    expect(newCategoryChoice('lire', owners)).toEqual({ issue: 'label', id: null, label: '' });
  });
  it('réutilise une catégorie existante du même nom à la casse près, vide comprise', () => {
    expect(newCategoryChoice(' tech ', owners)).toEqual({ issue: null, id: 'user/-/label/Tech', label: 'Tech' });
    expect(newCategoryChoice('VIDE', owners)).toEqual({ issue: null, id: 'user/-/label/Vide', label: 'Vide' });
  });
  it('un nom libre devient une nouvelle catégorie, sans les blancs autour', () => {
    expect(newCategoryChoice('  Science ', owners)).toEqual({ issue: null, id: 'user/-/label/Science', label: 'Science' });
  });
  it('vide : ni motif ni catégorie', () => {
    expect(newCategoryChoice('   ', owners)).toEqual({ issue: null, id: null, label: '' });
  });
});

const subs: Subscription[] = [
  { id: 'feed/1', title: 'Le Blog', url: 'https://Example.com/feed/' },
  { id: 'feed/2', title: 'Sans URL' },
  { id: 'feed/3', title: 'Avec requête', url: 'https://example.org/rss?lang=fr' },
];

// Un abonnement en double ne se disait que par l'erreur générique du serveur.
describe('subscribedFeed — flux déjà abonné', () => {
  it('reconnaît la même adresse malgré la casse de l’hôte, la barre finale, le fragment et le schéma', () => {
    expect(subscribedFeed('https://example.com/feed', subs)?.id).toBe('feed/1');
    expect(subscribedFeed('  http://EXAMPLE.com/feed/#top ', subs)?.id).toBe('feed/1');
    expect(subscribedFeed('https://example.com:443/feed', subs)?.id).toBe('feed/1');
  });
  it('ne confond pas deux adresses différentes', () => {
    expect(subscribedFeed('https://example.com/feed/atom', subs)).toBeUndefined();
    expect(subscribedFeed('https://example.org/rss?lang=en', subs)).toBeUndefined();
    expect(subscribedFeed('https://example.com/Feed', subs)).toBeUndefined();
  });
  it('garde la requête dans la comparaison', () => {
    expect(subscribedFeed('https://example.org/rss?lang=fr', subs)?.id).toBe('feed/3');
  });
  it('une saisie qui n’est pas une adresse ne correspond à rien', () => {
    expect(subscribedFeed('', subs)).toBeUndefined();
    expect(subscribedFeed('pas une url', subs)).toBeUndefined();
  });
});
