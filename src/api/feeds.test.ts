import { describe, it, expect, vi, beforeEach } from 'vitest';

// Le client axios est remplacé : ces tests portent sur la mécanique du jeton
// d'écriture, pas sur le transport.
vi.mock('./client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import client from './client';
import {
  clearWriteToken,
  markAsRead,
  markAsUnread,
  markAllAsRead,
  unsubscribeFeed,
  renameTag,
} from './feeds';

const get = vi.mocked(client.get);
const post = vi.mocked(client.post);

/** Le `T=` réellement envoyé lors de la n-ième écriture. */
const sentToken = (call: number): string | null => {
  const body = post.mock.calls[call][1] as URLSearchParams;
  return body.get('T');
};

const refused = (status: number) => ({ response: { status } });

beforeEach(() => {
  vi.clearAllMocks();
  clearWriteToken();
  // /token répond T1 puis T2 : on peut donc prouver que la seconde tentative
  // n'utilise pas le jeton périmé.
  let n = 0;
  get.mockImplementation(() => Promise.resolve({ data: `T${++n}\n` } as never));
  post.mockResolvedValue(undefined as never);
});

describe("api/feeds — jeton d'écriture périmé", () => {
  it('rafraîchit le jeton et réussit à la seconde tentative', async () => {
    post.mockRejectedValueOnce(refused(401));
    await markAsRead('a1');
    expect(post).toHaveBeenCalledTimes(2);
    expect(sentToken(0)).toBe('T1');
    expect(sentToken(1)).toBe('T2');
  });

  it('ne réessaie qu’UNE fois et propage l’erreur telle quelle', async () => {
    // Deux échecs consécutifs doivent ressortir inchangés : ce sont les
    // appelants (rollback, file d'attente) qui décident de la suite. Une
    // boucle de reprise ici les priverait de cette décision.
    const err = refused(403);
    post.mockRejectedValue(err);
    await expect(markAsUnread('a1')).rejects.toBe(err);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('ne rejoue pas une écriture restée sans réponse — c’est le hors-ligne', async () => {
    // Ce chemin doit continuer d'alimenter la file d'attente sans délai.
    const err = new Error('Network Error');
    post.mockRejectedValue(err);
    await expect(markAsRead('a1')).rejects.toBe(err);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('ne rejoue pas une panne serveur (5xx)', async () => {
    const err = refused(502);
    post.mockRejectedValue(err);
    await expect(markAsRead('a1')).rejects.toBe(err);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('couvre les autres écritures signées, pas seulement edit-tag', async () => {
    // `editTag` n'est pas la seule à envoyer le jeton : « tout marquer comme
    // lu » et les éditions d'abonnement/libellé le font aussi, et un jeton
    // périmé les condamnait tout autant.
    for (const write of [
      () => markAllAsRead('feed/1'),
      () => unsubscribeFeed('feed/1'),
      () => renameTag('user/-/label/a', 'user/-/label/b'),
    ]) {
      vi.clearAllMocks();
      clearWriteToken();
      let n = 0;
      get.mockImplementation(() => Promise.resolve({ data: `T${++n}` } as never));
      post.mockResolvedValue(undefined as never);
      post.mockRejectedValueOnce(refused(401));
      await write();
      expect(post).toHaveBeenCalledTimes(2);
      expect(sentToken(1)).toBe('T2');
    }
  });

  it('garde le jeton en cache tant qu’il est accepté', async () => {
    await markAsRead('a1');
    await markAsRead('a2');
    expect(get).toHaveBeenCalledTimes(1);
    expect(sentToken(1)).toBe('T1');
  });
});
