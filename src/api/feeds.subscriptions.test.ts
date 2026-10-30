import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import client from './client';
import { getSubscriptionList, getStreamContents, getStreamItemCount, getUnreadItemIds, itemIdsNewerThanEntry } from './feeds';

const get = vi.mocked(client.get);

beforeEach(() => vi.clearAllMocks());

describe('getSubscriptionList — visibilité FreshRSS', () => {
  it('traduit frss:priority en priority, et laisse le champ absent quand le serveur ne le donne pas', async () => {
    get.mockResolvedValue({ data: { subscriptions: [
      { id: 'feed/1', title: 'Un', 'frss:priority': 'category' },
      { id: 'feed/2', title: 'Deux' },
    ] } } as never);
    const subs = await getSubscriptionList();
    expect(subs[0].priority).toBe('category');
    expect(subs[0]).not.toHaveProperty('frss:priority');
    expect(subs[1].priority).toBeUndefined();
  });

  it('ignore une valeur de priorité inconnue plutôt que de la stocker', async () => {
    get.mockResolvedValue({ data: { subscriptions: [{ id: 'feed/1', title: 'Un', 'frss:priority': 'weird' }] } } as never);
    const subs = await getSubscriptionList();
    expect(subs[0].priority).toBeUndefined();
  });
});

// FreshRSS écrit « r／selfhosted » : le nom du flux s'affiche en ASCII.
describe('getSubscriptionList — formes pleine chasse de FreshRSS', () => {
  it('rend / et & aux noms de flux', async () => {
    get.mockResolvedValue({ data: { subscriptions: [{ id: 'feed/1', title: 'r／selfhosted ＆ co' }] } } as never);
    const subs = await getSubscriptionList();
    expect(subs[0].title).toBe('r/selfhosted & co');
  });
});

// Un proxy d'authentification répond 200 en HTML : `data.items || []` en faisait
// une liste vide, sans erreur, qui écrasait la copie hors ligne.
describe('getStreamContents — réponse qui n’est pas du JSON', () => {
  // Lue comme `[]`, la page faisait d'un « marquer au-dessus » un geste muet :
  // les lignes lues à l'écran, rien d'envoyé, rien de dit.
  it('les listes d’identifiants rejettent aussi', async () => {
    get.mockResolvedValue({ data: '<html>login</html>' } as never);
    await expect(getStreamItemCount('feed/1')).rejects.toThrow();
    await expect(getUnreadItemIds('feed/1')).rejects.toThrow();
    await expect(itemIdsNewerThanEntry('feed/1', 'tag:google.com,2005:reader/item/0000000000000001')).rejects.toThrow();
  });

  it('rejette, pour que le repli hors ligne joue', async () => {
    get.mockResolvedValue({ status: 200, data: '<html>Sign in</html>' } as never);
    await expect(getStreamContents('feed/1')).rejects.toThrow();
  });

  it('accepte une liste vide légitime', async () => {
    get.mockResolvedValue({ status: 200, data: { items: [] } } as never);
    await expect(getStreamContents('feed/1')).resolves.toEqual({ items: [], continuation: null });
  });
});
