import { describe, it, expect } from 'vitest';
import { pinnedFor, unpinnedFor, type ExtractRecord } from './extractStore';

/*
 * Le magasin d'extraits est commun à tous les comptes et serveurs du
 * navigateur, indexé par identifiant d'article. Le réchauffage d'un serveur
 * désépinglait les favoris de tous les autres : leurs extraits repassaient
 * sous la rétention de 30 jours et disparaissaient au démarrage suivant.
 */
const rec = (extra: Partial<ExtractRecord> = {}): ExtractRecord => ({
  id: 'a', title: '', content: 'c', excerpt: '', byline: '', siteName: '', length: 1,
  cachedAt: 1, pinned: false, ...extra,
});

describe('pinnedFor', () => {
  it('épingle pour la portée qui le demande', () => {
    expect(pinnedFor(rec(), '7@1')).toMatchObject({ pinned: true, pinScopes: ['7@1'] });
  });
  it('ajoute une portée sans retirer les autres', () => {
    expect(pinnedFor(rec({ pinned: true, pinScopes: ['7@1'] }), '7@2')?.pinScopes).toEqual(['7@1', '7@2']);
  });
  it('ne réécrit rien quand la portée l’épingle déjà', () => {
    expect(pinnedFor(rec({ pinned: true, pinScopes: ['7@1'] }), '7@1')).toBeNull();
  });
  it('un ancien épinglage sans portée est repris par la portée qui le réépingle', () => {
    expect(pinnedFor(rec({ pinned: true }), '7@1')).toMatchObject({ pinned: true, pinScopes: ['7@1'] });
  });
});

describe('unpinnedFor', () => {
  it('ne désépingle pas le favori d’une autre portée', () => {
    expect(unpinnedFor(rec({ pinned: true, pinScopes: ['7@2'] }), new Set(), '7@1')).toBeNull();
  });
  it('désépingle quand la seule portée qui le gardait ne le veut plus', () => {
    expect(unpinnedFor(rec({ pinned: true, pinScopes: ['7@1'] }), new Set(), '7@1')).toMatchObject({ pinned: false, pinScopes: [] });
  });
  it('reste épinglé tant qu’une autre portée le garde', () => {
    expect(unpinnedFor(rec({ pinned: true, pinScopes: ['7@1', '9@1'] }), new Set(), '7@1')).toMatchObject({ pinned: true, pinScopes: ['9@1'] });
  });
  it('ne touche pas un extrait gardé par la liste', () => {
    expect(unpinnedFor(rec({ pinned: true, pinScopes: ['7@1'] }), new Set(['a']), '7@1')).toBeNull();
  });
  it('un ancien épinglage sans portée n’est pas désépinglé', () => {
    expect(unpinnedFor(rec({ pinned: true }), new Set(), '7@1')).toBeNull();
  });
});
