import { describe, it, expect } from 'vitest';
import { shouldLoadMore, emptyListIsFinal } from './listPagination';

const viewport = {
  hasContinuation: true,
  loading: false,
  loadingMore: false,
  scrollTop: 0,
  scrollHeight: 3000,
  clientHeight: 800,
};

describe('shouldLoadMore', () => {
  it('charge la page suivante à l’approche du bas', () => {
    expect(shouldLoadMore({ ...viewport, scrollTop: 2000 })).toBe(true);
  });

  it('ne charge rien tant que le bas est loin', () => {
    expect(shouldLoadMore(viewport)).toBe(false);
  });

  // Le cœur du problème : marquer des lignes lues depuis le HAUT vide la liste
  // sans jamais produire d'événement `scroll`, et quand ce qui reste tient dans
  // la fenêtre, la liste ne peut même plus être défilée. Le scroll infini se
  // taisait donc alors que `continuation` promettait d'autres articles.
  it('charge quand le contenu restant ne remplit plus la fenêtre', () => {
    expect(shouldLoadMore({ ...viewport, scrollHeight: 400, clientHeight: 800 })).toBe(true);
  });

  it('charge quand la liste est vide alors qu’il reste des pages', () => {
    expect(shouldLoadMore({ ...viewport, scrollHeight: 0, clientHeight: 800 })).toBe(true);
  });

  it('ne charge rien sans continuation', () => {
    expect(shouldLoadMore({ ...viewport, hasContinuation: false, scrollHeight: 0 })).toBe(false);
  });

  it('ne relance pas une page déjà en vol', () => {
    expect(shouldLoadMore({ ...viewport, loadingMore: true, scrollHeight: 0 })).toBe(false);
  });

  it('ne charge rien pendant le chargement initial de la vue', () => {
    expect(shouldLoadMore({ ...viewport, loading: true, scrollHeight: 0 })).toBe(false);
  });
});

describe('emptyListIsFinal', () => {
  // « Tout est lu » est une affirmation, et elle s'affiche en réussite. Tant
  // que `continuation` promet une page suivante, elle est fausse : des
  // articles non lus attendent encore sur le serveur.
  it('refuse de conclure tant qu’une page reste à charger', () => {
    expect(emptyListIsFinal({ articleCount: 0, hasContinuation: true })).toBe(false);
  });

  it('conclut quand la liste est vide et le flux épuisé', () => {
    expect(emptyListIsFinal({ articleCount: 0, hasContinuation: false })).toBe(true);
  });

  it('ne conclut rien quand la liste a du contenu', () => {
    expect(emptyListIsFinal({ articleCount: 3, hasContinuation: false })).toBe(false);
  });
});
