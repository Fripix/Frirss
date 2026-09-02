import { describe, it, expect } from 'vitest';
import { planRowRestore } from './rollbackRow';

const row = (id: string, published?: number) => ({ id, published });

describe('planRowRestore — gardes', () => {
  it('refuse de réinsérer quand la vue affichée n’est plus celle du retrait', () => {
    // Le ✓ part depuis le flux A, l'utilisateur ouvre le flux B pendant que
    // l'écriture est en vol, le serveur refuse : réinsérer poserait un article
    // du flux A au milieu de la liste du flux B — et `persistCurrentView`
    // l'écrirait dans le cache de B.
    expect(
      planRowRestore({
        row: row('a1', 4),
        articles: [row('b0', 9), row('b1', 8)],
        viewAtRemoval: 'feed/1:unread:',
        viewNow: 'feed/2:unread:',
        previousId: 'a0',
      }),
    ).toEqual({ insert: false, reason: 'view-changed' });
  });

  it('refuse de réinsérer quand la ligne est déjà revenue dans la liste', () => {
    // Un tiré-pour-rafraîchir ou un `silentRefresh` remplace la liste par une
    // page serveur qui contient toujours l'article — le marquage ayant échoué,
    // il y est encore non lu. Réinsérer en ferait une seconde copie, deux
    // enfants React sous la même clé.
    expect(
      planRowRestore({
        row: row('a1', 4),
        articles: [row('a0', 5), row('a1', 4), row('a2', 3)],
        viewAtRemoval: 'feed/1:unread:',
        viewNow: 'feed/1:unread:',
        previousId: 'a0',
      }),
    ).toEqual({ insert: false, reason: 'already-present' });
  });

  it('refuse aussi quand la vue a changé ET que la ligne est présente', () => {
    expect(
      planRowRestore({
        row: row('a1', 4),
        articles: [row('a1', 4)],
        viewAtRemoval: 'feed/1:unread:',
        viewNow: '' + ':all:',
        previousId: null,
      }).insert,
    ).toBe(false);
  });

  it('distingue deux vues qui ne diffèrent que par la recherche en cours', () => {
    expect(
      planRowRestore({
        row: row('a1', 4),
        articles: [row('c0', 9)],
        viewAtRemoval: 'feed/1:unread:',
        viewNow: 'feed/1:unread:swift',
        previousId: null,
      }),
    ).toEqual({ insert: false, reason: 'view-changed' });
  });
});

describe('planRowRestore — position', () => {
  const same = { viewAtRemoval: 'v', viewNow: 'v' };

  it('replace la ligne selon sa date, pas selon l’index retenu au retrait', () => {
    // Le cas prouvé par la revue : ✓ sur a3, puis ✓ sur a0 qui, lui, est
    // confirmé. L'index retenu pour a3 (3) désigne désormais la fin de la
    // liste. La date, elle, désigne toujours la place entre a2 et a4.
    expect(
      planRowRestore({
        ...same,
        row: row('a3', 3),
        articles: [row('a1', 5), row('a2', 4), row('a4', 1)],
        previousId: 'a2',
      }),
    ).toEqual({ insert: true, index: 2 });
  });

  it('remet en tête une ligne plus récente que tout ce qui reste', () => {
    expect(
      planRowRestore({ ...same, row: row('a0', 9), articles: [row('a1', 5), row('a2', 4)], previousId: null }),
    ).toEqual({ insert: true, index: 0 });
  });

  it('remet en fin une ligne plus ancienne que tout ce qui reste', () => {
    expect(
      planRowRestore({ ...same, row: row('a9', 1), articles: [row('a1', 5), row('a2', 4)], previousId: 'a2' }),
    ).toEqual({ insert: true, index: 2 });
  });

  it('rend l’index 0 sur une liste vide', () => {
    expect(
      planRowRestore({ ...same, row: row('a1', 4), articles: [], previousId: 'a0' }),
    ).toEqual({ insert: true, index: 0 });
  });
});

describe('planRowRestore — dates égales', () => {
  const same = { viewAtRemoval: 'v', viewNow: 'v' };

  it('replace la ligne derrière le voisin qu’elle avait, à date égale', () => {
    // La date seule ne sait pas ordonner un bloc d'articles publiés à la même
    // seconde (fréquent : flux datés au jour, imports en masse). Le voisin du
    // dessus, lui, tranche — et il est vérifié PRÉSENT, jamais supposé.
    expect(
      planRowRestore({
        ...same,
        row: row('a1', 4),
        articles: [row('a0', 4), row('a2', 4)],
        previousId: 'a0',
      }),
    ).toEqual({ insert: true, index: 1 });
  });

  it('remet en tête du bloc la ligne qui n’avait pas de voisin au-dessus', () => {
    expect(
      planRowRestore({ ...same, row: row('a0', 4), articles: [row('a1', 4), row('a2', 4)], previousId: null }),
    ).toEqual({ insert: true, index: 0 });
  });

  it('se rabat sur la fin du bloc quand le voisin retenu a lui aussi disparu', () => {
    // a1 et a2 partent coup sur coup ; a2 est confirmé, a1 refusé. Son voisin
    // a2 n'est plus là : la place se décide alors par la seule date, après le
    // bloc de même horodatage. Déterministe, jamais dépendant de l'ordre des
    // réponses serveur.
    expect(
      planRowRestore({ ...same, row: row('a1', 4), articles: [row('a0', 4), row('a3', 4)], previousId: 'a2' }),
    ).toEqual({ insert: true, index: 2 });
  });

  it('ignore un voisin retrouvé loin du bloc de même date', () => {
    // Le voisin ne tranche qu'À L'INTÉRIEUR du bloc, ou juste au-dessus.
    // Retrouvé ailleurs — liste rechargée, page plus récente intercalée — il
    // ne doit pas sortir la ligne de sa date : la date reprend la main.
    expect(
      planRowRestore({
        ...same,
        row: row('a1', 4),
        articles: [row('x', 9), row('w', 7), row('a0', 4), row('y', 1)],
        previousId: 'x',
      }),
    ).toEqual({ insert: true, index: 3 });
  });

  it('honore un voisin qui borde le bloc par le dessus', () => {
    // La ligne était juste sous `x` : elle y retourne, en tête du bloc.
    expect(
      planRowRestore({
        ...same,
        row: row('a1', 4),
        articles: [row('x', 9), row('a0', 4), row('y', 1)],
        previousId: 'x',
      }),
    ).toEqual({ insert: true, index: 1 });
  });

  it('traite une date manquante comme la plus ancienne, sans perdre le voisin', () => {
    expect(
      planRowRestore({ ...same, row: row('a1'), articles: [row('a0'), row('a2')], previousId: 'a0' }),
    ).toEqual({ insert: true, index: 1 });
  });
});
