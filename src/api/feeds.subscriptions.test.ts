import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import client from './client';
import { getSubscriptionList } from './feeds';

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
