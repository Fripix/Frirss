import { describe, it, expect, beforeEach } from 'vitest';
import {
  listOverflows,
  OVERFLOW_SLACK_PX,
  publishListCanScroll,
  listCanScroll,
  resetListCanScroll,
} from './listOverflow';

describe('listOverflows', () => {
  it('dit non quand le contenu tient dans la fenêtre', () => {
    expect(listOverflows({ scrollHeight: 400, clientHeight: 900 })).toBe(false);
    expect(listOverflows({ scrollHeight: 900, clientHeight: 900 })).toBe(false);
  });

  it('dit oui quand le contenu déborde franchement', () => {
    expect(listOverflows({ scrollHeight: 3000, clientHeight: 900 })).toBe(true);
  });

  // Les hauteurs rendues sont fractionnaires (zoom du navigateur, bordures en
  // pixels logiques) : `scrollHeight` dépasse `clientHeight` d'un cheveu sur
  // une liste qui ne défile pas réellement. La marge évite de croire qu'il
  // reste quelque chose à faire défiler.
  it('ignore un dépassement inférieur à la marge', () => {
    expect(listOverflows({ scrollHeight: 900 + OVERFLOW_SLACK_PX, clientHeight: 900 })).toBe(false);
    expect(listOverflows({ scrollHeight: 900 + OVERFLOW_SLACK_PX + 1, clientHeight: 900 })).toBe(true);
  });
});

describe('canal de mesure listCanScroll', () => {
  beforeEach(() => resetListCanScroll());

  // Défaut prudent : tant que rien n'a été mesuré, on suppose que la liste
  // défile encore. Une mesure absente ne doit RIEN déclencher — au pire une
  // page de rattrapage manquée, jamais une page demandée à l'aveugle.
  it('suppose une liste défilable tant que rien n’a été mesuré', () => {
    expect(listCanScroll()).toBe(true);
  });

  it('rend la dernière mesure publiée', () => {
    publishListCanScroll(false);
    expect(listCanScroll()).toBe(false);
    publishListCanScroll(true);
    expect(listCanScroll()).toBe(true);
  });

  // Le démontage de la liste (onglet mobile, volet de lecture plein écran)
  // laisserait sinon une mesure figée : un ✓ depuis le volet de lecture
  // demanderait une page par geste, sans que personne ne la voie.
  it('revient au défaut prudent après réinitialisation', () => {
    publishListCanScroll(false);
    resetListCanScroll();
    expect(listCanScroll()).toBe(true);
  });
});
