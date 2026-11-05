import { describe, it, expect, vi, beforeEach } from 'vitest';

// Le client axios est remplacé : ces tests portent sur ce que le navigateur
// envoie pour une écriture, pas sur le transport.
vi.mock('./client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import client from './client';
import {
  markAsRead,
  markAsUnread,
  markAllAsRead,
  unsubscribeFeed,
  renameTag,
} from './feeds';

const get = vi.mocked(client.get);
const post = vi.mocked(client.post);

const refused = (status: number) => ({ response: { status } });

beforeEach(() => {
  vi.clearAllMocks();
  post.mockResolvedValue(undefined as never);
});

// Le jeton d'écriture (`T`) vaut le jeton FreshRSS complet : c'est le serveur
// qui l'obtient et signe chaque écriture (`server/writeToken.ts`), relance sur
// jeton périmé comprise. Le navigateur ne le demande ni ne l'envoie plus.
describe("api/feeds — écritures signées par le serveur", () => {
  it('ne demande jamais /token et n’envoie aucun T', async () => {
    for (const write of [
      () => markAsRead('a1'),
      () => markAllAsRead('feed/1'),
      () => unsubscribeFeed('feed/1'),
      () => renameTag('user/-/label/a', 'user/-/label/b'),
    ]) {
      vi.clearAllMocks();
      post.mockResolvedValue(undefined as never);
      await write();
      expect(get).not.toHaveBeenCalled();
      expect(post).toHaveBeenCalledTimes(1);
      expect((post.mock.calls[0][1] as URLSearchParams).has('T')).toBe(false);
    }
  });

  it('un refus ressort tel quel, sans seconde tentative côté navigateur', async () => {
    // La reprise unique vit au serveur : la refaire ici doublerait l'écriture.
    // Ce sont les appelants (rollback, file d'attente) qui décident de la suite.
    const err = refused(401);
    post.mockRejectedValue(err);
    await expect(markAsUnread('a1')).rejects.toBe(err);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('une écriture restée sans réponse ressort telle quelle — c’est le hors-ligne', async () => {
    const err = new Error('Network Error');
    post.mockRejectedValue(err);
    await expect(markAsRead('a1')).rejects.toBe(err);
    expect(post).toHaveBeenCalledTimes(1);
  });
});
