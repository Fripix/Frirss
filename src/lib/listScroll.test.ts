import { describe, it, expect } from 'vitest';
import { revealScrollTop, listAnchor, anchoredScrollTop } from './listScroll';

describe('revealScrollTop — la ligne choisie au clavier devient visible (L-15)', () => {
  const view = { scrollTop: 1000, viewTop: 0, viewBottom: 800 };

  it('déjà entièrement visible : on ne bouge pas', () => {
    expect(revealScrollTop({ ...view, rowTop: 100, rowBottom: 200 })).toBeNull();
  });

  it('sous le bas de la fenêtre : défile juste assez pour l’amener en bas', () => {
    expect(revealScrollTop({ ...view, rowTop: 750, rowBottom: 850 })).toBe(1050);
  });

  it('au-dessus du haut : défile juste assez pour l’amener en haut', () => {
    expect(revealScrollTop({ ...view, rowTop: -60, rowBottom: 40 })).toBe(940);
  });

  it('le haut tient compte de ce qui y colle (bande de date)', () => {
    expect(revealScrollTop({ ...view, topInset: 30, rowTop: 10, rowBottom: 110 })).toBe(980);
  });

  it('plus haute que la fenêtre : son début reste visible', () => {
    expect(revealScrollTop({ ...view, rowTop: 500, rowBottom: 1700 })).toBe(1500);
  });

  it('loin sous la fenêtre (au-delà de ce qui était à l’écran) : elle arrive en bas', () => {
    expect(revealScrollTop({ ...view, rowTop: 11000, rowBottom: 11100 })).toBe(11300);
  });
});

describe('listAnchor / anchoredScrollTop — la liste garde l’article, pas le décalage en pixels', () => {
  const rows = [
    { id: 'a', top: -250, bottom: -150 },
    { id: 'b', top: -150, bottom: -50 },
    { id: 'c', top: -50, bottom: 50 },
    { id: 'd', top: 50, bottom: 150 },
  ];

  it('l’ancre est le premier article encore visible en haut, avec son décalage', () => {
    expect(listAnchor(rows, 0)).toEqual({ id: 'c', offset: -50 });
  });

  it('aucun article visible : pas d’ancre', () => {
    expect(listAnchor([], 0)).toBeNull();
    expect(listAnchor(rows.slice(0, 2), 0)).toBeNull();
  });

  it('après le changement de disposition, l’article revient au même endroit', () => {
    // L'article « c » est désormais 3 250 px plus bas que le haut de la fenêtre.
    expect(anchoredScrollTop({ scrollTop: 4750, viewTop: 0, rowTop: 3200, offset: -50 })).toBe(8000);
    expect(anchoredScrollTop({ scrollTop: 4750, viewTop: 0, rowTop: -3200, offset: -50 })).toBe(1600);
  });
});
