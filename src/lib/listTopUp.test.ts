import { describe, it, expect } from 'vitest';
import { shouldTopUpAfterRemoval } from './listTopUp';

const base = { listCanScroll: false, hasContinuation: true, loadingMore: false, searching: false };

describe('shouldTopUpAfterRemoval', () => {
  // Le critère n'est pas un nombre de lignes mais un fait d'écran : la liste
  // a-t-elle encore quelque chose à faire défiler ? Sinon plus aucun `scroll`
  // ne sera émis et la pagination s'arrête là.
  it('demande une page quand la liste ne défile plus', () => {
    expect(shouldTopUpAfterRemoval({ ...base, listCanScroll: false })).toBe(true);
  });

  // Vingt-cinq lignes restantes ne disent rien : c'est court sur un grand
  // écran, long sur un téléphone. Tant que la liste déborde de sa fenêtre,
  // l'écouteur `scroll` fera le travail.
  it('ne demande rien tant que la liste déborde encore', () => {
    expect(shouldTopUpAfterRemoval({ ...base, listCanScroll: true })).toBe(false);
  });

  it('ne demande rien quand le flux est épuisé', () => {
    expect(shouldTopUpAfterRemoval({ ...base, hasContinuation: false })).toBe(false);
  });

  it('ne demande rien pendant qu’une page est déjà en vol', () => {
    expect(shouldTopUpAfterRemoval({ ...base, loadingMore: true })).toBe(false);
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
    expect(shouldTopUpAfterRemoval({ ...base, searching: true })).toBe(false);
  });

  it('reste actif hors recherche', () => {
    expect(shouldTopUpAfterRemoval({ ...base, searching: false })).toBe(true);
  });
});
