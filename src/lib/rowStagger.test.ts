import { describe, it, expect } from 'vitest';
import { staggerIndexes, rememberStagger, STAGGER_ROWS } from './rowStagger';

const ids = (n: number, prefix = 'a') =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}`);

/** Un rendu complet : ce qu'on anime, puis ce qu'on retient. */
function render(memo: Map<string, number | null>, list: string[]) {
  const assigned = staggerIndexes(list, memo);
  rememberStagger(memo, list, assigned);
  return assigned;
}

describe('staggerIndexes — première apparition seulement', () => {
  it('échelonne les dix premières lignes d’une vue vierge', () => {
    const map = staggerIndexes(ids(12), new Map());
    expect(map.get('a0')).toBe(0);
    expect(map.get('a9')).toBe(9);
    expect(map.size).toBe(STAGGER_ROWS);
  });

  it('n’échelonne pas au-delà du seuil', () => {
    const map = staggerIndexes(ids(12), new Map());
    expect(map.has('a10')).toBe(false);
    expect(map.has('a11')).toBe(false);
  });

  it('n’échelonne AUCUNE ligne nouvellement remontée dans la liste', () => {
    // Le bug : le ✓ retire une ligne, tout ce qui suit remonte d'un cran, et
    // la onzième ligne devient la dixième. Sur la seule position, elle
    // franchissait le seuil et rejouait l'animation d'entrée — elle
    // s'effaçait puis réapparaissait alors qu'elle n'avait jamais quitté
    // l'écran. Un article clignotait à chaque clic.
    const memo = new Map<string, number | null>();
    render(memo, ids(12));
    const after = ids(12).filter((id) => id !== 'a3');
    expect(staggerIndexes(after, memo).has('a10')).toBe(false);
    expect(staggerIndexes(after, memo).has('a11')).toBe(false);
  });

  it('garde à chaque ligne le retard qu’elle a reçu, quoi qu’il arrive à sa position', () => {
    // Le résultat doit être STABLE : un rendu de plus (revalidation,
    // compteurs) qui retirerait `data-stagger` d'une ligne en pleine
    // animation la ferait sauter à son état final.
    const memo = new Map<string, number | null>();
    render(memo, ids(12));
    const after = staggerIndexes(ids(12).filter((id) => id !== 'a3'), memo);
    expect(after.get('a9')).toBe(9); // sa position vaut 8, son retard reste 9
    expect(after.size).toBe(STAGGER_ROWS - 1); // a3 est parti, pas de nouvelle venue
  });

  it('échelonne la ligne inédite qui arrive au milieu de lignes connues', () => {
    const memo = new Map<string, number | null>();
    render(memo, ids(3));
    const map = staggerIndexes(['a0', 'neuf', 'a1', 'a2'], memo);
    expect(map.get('neuf')).toBe(1);
  });

  it('reste muet quand le scroll infini ajoute une page après le seuil', () => {
    const memo = new Map<string, number | null>();
    render(memo, ids(12));
    const map = staggerIndexes([...ids(12), ...ids(5, 'b')], memo);
    expect(ids(5, 'b').some((id) => map.has(id))).toBe(false);
  });

  it('échelonne à nouveau les lignes quand la vue change (mémoire vidée)', () => {
    // Entrer dans une vue doit continuer d'animer ses lignes : l'appelant
    // repart d'une mémoire vide à chaque changement de flux ou de filtre,
    // y compris pour un article déjà croisé ailleurs.
    const memo = new Map<string, number | null>();
    render(memo, ids(3));
    expect(staggerIndexes(ids(3), new Map()).size).toBe(3);
  });

  it('ne rend rien pour une liste vide', () => {
    expect(staggerIndexes([], new Map()).size).toBe(0);
  });
});

describe('rememberStagger', () => {
  it('retient les lignes animées avec leur retard et les autres à `null`', () => {
    const memo = new Map<string, number | null>();
    render(memo, ids(12));
    expect(memo.get('a0')).toBe(0);
    expect(memo.get('a10')).toBeNull();
    expect(memo.get('a11')).toBeNull();
  });

  it('n’écrase jamais un retard déjà attribué', () => {
    const memo = new Map<string, number | null>();
    render(memo, ids(12));
    render(memo, ids(12).filter((id) => id !== 'a0'));
    expect(memo.get('a9')).toBe(9);
  });
});
