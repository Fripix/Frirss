import { describe, it, expect } from 'vitest';
import { shouldLoadMore, emptyListIsFinal, listBodyState, canLoadMore, shouldReportInvisibleProgress } from './listPagination';

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

describe('listBodyState', () => {
  const base = { loading: false, articleCount: 0, hasContinuation: false, searching: false };

  it('montre les lignes dès qu’il y en a', () => {
    expect(listBodyState({ ...base, articleCount: 3 })).toBe('rows');
    expect(listBodyState({ ...base, articleCount: 3, hasContinuation: true })).toBe('rows');
  });

  it('montre l’état vide définitif quand le flux est épuisé', () => {
    expect(listBodyState(base)).toBe('empty');
  });

  // Le défaut corrigé : une liste vide avec une `continuation` non nulle
  // rendait le squelette de chargement, dans TOUTES les vues. Rien ne le
  // relançait jamais — la pagination ne repart que sur un `scroll`, et un
  // squelette plus court que la fenêtre n'en émet aucun. L'utilisateur devait
  // changer de vue pour s'en sortir. Un ★ sur un flux dont les 50 premiers
  // articles ne sont pas favoris suffisait à l'y enfermer.
  it('n’enferme jamais dans un squelette : une liste vide avec suite reste un état vide', () => {
    expect(listBodyState({ ...base, hasContinuation: true })).toBe('empty-more');
  });

  it('ne montre le squelette que pendant un vrai chargement', () => {
    expect(listBodyState({ ...base, loading: true })).toBe('skeleton');
    for (const articleCount of [0, 5]) {
      for (const hasContinuation of [false, true]) {
        for (const searching of [false, true]) {
          expect(listBodyState({ loading: false, articleCount, hasContinuation, searching }))
            .not.toBe('skeleton');
        }
      }
    }
  });

  // `loadMore` ne sait pas paginer une recherche : il redemande le flux nu et
  // y injecterait des articles étrangers à la requête (voir `listTopUp.ts`).
  // Un état vide de recherche n'offre donc pas « charger la suite » ; il garde
  // sa propre sortie (« chercher dans tous les flux »).
  it('ne propose pas la page suivante pendant une recherche', () => {
    expect(listBodyState({ ...base, hasContinuation: true, searching: true })).toBe('empty');
  });
});

describe('canLoadMore', () => {
  const base = { hasContinuation: true, loadingMore: false, revalidating: false };

  it('autorise le clic quand rien n’est en vol', () => {
    expect(canLoadMore(base)).toBe(true);
  });

  it('refuse sans continuation', () => {
    expect(canLoadMore({ ...base, hasContinuation: false })).toBe(false);
  });

  it('refuse pendant une page déjà en vol', () => {
    expect(canLoadMore({ ...base, loadingMore: true })).toBe(false);
  });

  // Le cache mémoire peint une vue instantanément (`loading` reste faux)
  // pendant que `loadArticles` revalide encore en tâche de fond. Un clic sur
  // « charger la suite » dans cette fenêtre lance `loadMore` en même temps que
  // cette revalidation ; elle gagne presque toujours la course et écrase la
  // page ajoutée en réinitialisant `continuation` — le travail du clic est
  // jeté sans un mot.
  it('refuse pendant la revalidation d’arrière-plan d’une vue déjà peinte par le cache', () => {
    expect(canLoadMore({ ...base, revalidating: true })).toBe(false);
  });
});

describe('shouldReportInvisibleProgress', () => {
  it('ne dit rien quand la page a ajouté des lignes visibles', () => {
    expect(shouldReportInvisibleProgress({ itemsAdded: 12, hasMore: true })).toBe(false);
  });

  // Les favoris d'un flux sont filtrés CÔTÉ CLIENT (voir `feedStore`) : une
  // page peut légitimement ne matcher aucun favori. Le clic a bien avancé —
  // une requête est partie, `continuation` a changé — mais l'écran ne bouge
  // pas d'un pixel. Sur un flux de 500 articles dont l'unique favori se
  // trouve vers la position 480, dix clics d'affilée repeignent le même écran
  // vide : sans un mot pour le dire, le bouton a l'air cassé.
  it('signale une page qui n’a rien ajouté de visible, tant qu’il en reste', () => {
    expect(shouldReportInvisibleProgress({ itemsAdded: 0, hasMore: true })).toBe(true);
  });

  it('se tait quand le flux est épuisé : l’état vide définitif le dit déjà', () => {
    expect(shouldReportInvisibleProgress({ itemsAdded: 0, hasMore: false })).toBe(false);
  });
});
