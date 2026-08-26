import { describe, it, expect } from 'vitest';
import {
  hostnameOf,
  displayServers,
  nextServerAfterDelete,
  canDeleteServer,
} from './serverList';
import type { ServerConnection } from '../types';

const srv = (over: Partial<ServerConnection> & { id: number }): ServerConnection => ({
  name: `server-${over.id}`,
  url: `https://rss${over.id}.example.com`,
  freshrss_user: 'alice',
  has_token: true,
  ...over,
});

describe('hostnameOf', () => {
  it('rend l\'hôte d\'une URL valide', () => {
    expect(hostnameOf('https://rss.example.com/api/')).toBe('rss.example.com');
  });

  it('retire le préfixe www.', () => {
    expect(hostnameOf('https://www.example.com')).toBe('example.com');
  });

  it('rend l\'entrée telle quelle si l\'URL est malformée', () => {
    expect(hostnameOf('pas une url')).toBe('pas une url');
  });
});

describe('displayServers', () => {
  it('rend la liste inchangée quand l\'actif a un enregistrement', () => {
    const servers = [srv({ id: 1 }), srv({ id: 2 })];
    const out = displayServers(servers, 1, 'https://rss1.example.com');
    expect(out).toHaveLength(2);
    expect(out.some((s) => s.synthetic)).toBe(false);
  });

  it('préfixe une entrée synthétique quand l\'actif n\'a pas d\'enregistrement', () => {
    const out = displayServers([srv({ id: 2 })], 99, 'https://www.legacy.example.com');
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      id: 99,
      name: 'legacy.example.com',
      url: 'https://www.legacy.example.com',
      synthetic: true,
    });
  });

  it('compare les identifiants sans tenir compte du type', () => {
    const out = displayServers([srv({ id: 1 })], '1', 'https://rss1.example.com');
    expect(out).toHaveLength(1);
  });

  it('n\'ajoute rien quand aucune URL de connexion n\'est active', () => {
    expect(displayServers([srv({ id: 1 })], null, '')).toHaveLength(1);
  });

  it('nomme l\'entrée synthétique __current__ quand l\'identifiant actif est absent', () => {
    const out = displayServers([], null, 'https://rss.example.com');
    expect(out[0].id).toBe('__current__');
  });
});

describe('nextServerAfterDelete', () => {
  it('ne bascule pas quand le serveur supprimé n\'était pas l\'actif', () => {
    expect(nextServerAfterDelete([srv({ id: 2 })], 1, 2)).toBeNull();
  });

  it('choisit le serveur par défaut quand l\'actif est supprimé', () => {
    const remaining = [srv({ id: 2 }), srv({ id: 3, is_default: 1 })];
    expect(nextServerAfterDelete(remaining, 1, 1)?.id).toBe(3);
  });

  it('choisit le premier restant faute de serveur par défaut', () => {
    const remaining = [srv({ id: 2 }), srv({ id: 3 })];
    expect(nextServerAfterDelete(remaining, 1, 1)?.id).toBe(2);
  });

  it('ne bascule pas vers un serveur sans jeton', () => {
    const remaining = [srv({ id: 2, has_token: false })];
    expect(nextServerAfterDelete(remaining, 1, 1)).toBeNull();
  });

  it('ne bascule pas quand il ne reste rien', () => {
    expect(nextServerAfterDelete([], 1, 1)).toBeNull();
  });
});

describe('canDeleteServer', () => {
  it('refuse la suppression du dernier serveur', () => {
    expect(canDeleteServer([srv({ id: 1 })])).toBe(false);
  });

  it('autorise la suppression dès qu\'il y en a deux', () => {
    expect(canDeleteServer([srv({ id: 1 }), srv({ id: 2 })])).toBe(true);
  });
});
