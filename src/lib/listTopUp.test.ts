import { describe, it, expect } from 'vitest';
import { shouldTopUpAfterRemoval, TOP_UP_MIN_ROWS } from './listTopUp';

const base = { remaining: 0, hasContinuation: true, loadingMore: false, searching: false };

describe('shouldTopUpAfterRemoval', () => {
  it('demande une page quand il ne reste presque plus rien', () => {
    expect(shouldTopUpAfterRemoval({ ...base, remaining: 1 })).toBe(true);
  });

  it('ne demande rien quand la liste est encore fournie', () => {
    expect(shouldTopUpAfterRemoval({ ...base, remaining: TOP_UP_MIN_ROWS })).toBe(false);
    expect(shouldTopUpAfterRemoval({ ...base, remaining: TOP_UP_MIN_ROWS + 40 })).toBe(false);
  });

  it('ne demande rien quand le flux est épuisé', () => {
    expect(shouldTopUpAfterRemoval({ ...base, hasContinuation: false })).toBe(false);
  });

  it('ne demande rien pendant qu’une page est déjà en vol', () => {
    expect(shouldTopUpAfterRemoval({ ...base, loadingMore: true })).toBe(false);
  });

  // Le seuil reste petit par construction : c'est une remise à niveau d'une
  // liste devenue plus courte que sa fenêtre, pas une préparation hors-ligne.
  // Un seuil proche de la taille de page ferait paginer à chaque ✓.
  it('garde un seuil petit', () => {
    expect(TOP_UP_MIN_ROWS).toBeGreaterThan(0);
    expect(TOP_UP_MIN_ROWS).toBeLessThan(20);
  });
});

describe('shouldTopUpAfterRemoval — pendant une recherche', () => {
  // `loadMore` appelle `fetchArticleStream(filter, selectedFeed, …)` sans
  // jamais passer `searchQuery` : la page qu'il rapporte est celle du flux nu.
  // Le rattrapage l'appendrait aux résultats affichés, donnant des articles
  // sans rapport avec la requête sous une boîte de recherche toujours remplie.
  // Le décalage `loadMore`/recherche est antérieur, mais il demandait de
  // descendre volontairement au bas des résultats ; le rattrapage le
  // déclenchait depuis un seul ✓ sur un résultat court, soit le cas courant.
  // Même raison que `markReadOnScroll`, déjà désactivé pendant une recherche.
  it('ne demande aucune page tant qu’une recherche est active', () => {
    expect(shouldTopUpAfterRemoval({ ...base, remaining: 1, searching: true })).toBe(false);
  });

  it('reste actif hors recherche', () => {
    expect(shouldTopUpAfterRemoval({ ...base, remaining: 1, searching: false })).toBe(true);
  });
});
