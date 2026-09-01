import { useEffect, type RefObject } from 'react';
import { shouldLoadMore } from '../lib/listPagination';

/**
 * Relance le scroll infini quand plus aucun défilement ne peut le faire.
 *
 * L'écouteur `scroll` de la liste ne suffit plus depuis que les lignes peuvent
 * en SORTIR (le ✓ sous le filtre « Non lus », issue #10) : on dépile depuis le
 * haut, `scrollTop` reste à 0, aucun événement n'est émis, et dès que ce qui
 * reste tient dans la fenêtre la liste n'est même plus défilable. La
 * pagination s'arrêtait là, avec une `continuation` pourtant non nulle.
 *
 * Le contrôle est donc refait à chaque changement du nombre de lignes, en plus
 * du défilement. Il n'y a pas de boucle : `loadingMore` bloque le temps de la
 * requête, et une page qui n'apporte rien de nouveau finit avec
 * `continuation: null`, ce qui arrête tout.
 */
export function useAutoLoadMore(opts: {
  ref: RefObject<HTMLElement | null>;
  articleCount: number;
  hasContinuation: boolean;
  loading: boolean;
  loadingMore: boolean;
  loadMore: () => void;
}): void {
  const { ref, articleCount, hasContinuation, loading, loadingMore, loadMore } = opts;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (
      shouldLoadMore({
        hasContinuation,
        loading,
        loadingMore,
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      })
    ) {
      loadMore();
    }
  }, [ref, articleCount, hasContinuation, loading, loadingMore, loadMore]);
}
