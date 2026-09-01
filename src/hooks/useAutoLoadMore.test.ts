// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useAutoLoadMore } from './useAutoLoadMore';

afterEach(cleanup);

// Un faux élément défilant : jsdom rapporte 0 partout, on pose donc les
// dimensions à la main pour décrire une fenêtre remplie ou non.
function box(scrollHeight: number, clientHeight = 800, scrollTop = 0) {
  const el = { scrollTop, scrollHeight, clientHeight };
  return { el, ref: { current: el as unknown as HTMLElement } };
}

type Args = Parameters<typeof useAutoLoadMore>[0];

describe('useAutoLoadMore', () => {
  it('charge la page suivante quand la liste ne remplit pas la fenêtre', () => {
    const loadMore = vi.fn();
    renderHook(() =>
      useAutoLoadMore({
        ref: box(300).ref,
        articleCount: 2,
        hasContinuation: true,
        loading: false,
        loadingMore: false,
        loadMore,
      })
    );
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  // Le vrai scénario de l'issue : on marque lu depuis le HAUT, `scrollTop`
  // reste à 0, aucun événement `scroll` n'est jamais émis, et ce qui reste
  // finit par tenir dans la fenêtre. Sans re-vérification après le retrait des
  // lignes, `loadMore` ne partait plus jamais malgré une continuation.
  it('re-vérifie après le retrait de lignes, sans aucun défilement', () => {
    const loadMore = vi.fn();
    const { el, ref } = box(3000);
    const props: Args = {
      ref,
      articleCount: 20,
      hasContinuation: true,
      loading: false,
      loadingMore: false,
      loadMore,
    };
    const { rerender } = renderHook((p: Args) => useAutoLoadMore(p), { initialProps: props });
    expect(loadMore).not.toHaveBeenCalled();

    // Les lignes marquées lues quittent la liste : le contenu rétrécit.
    el.scrollHeight = 400;
    rerender({ ...props, articleCount: 3 });
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it('ne charge rien sans continuation', () => {
    const loadMore = vi.fn();
    renderHook(() =>
      useAutoLoadMore({
        ref: box(0).ref,
        articleCount: 0,
        hasContinuation: false,
        loading: false,
        loadingMore: false,
        loadMore,
      })
    );
    expect(loadMore).not.toHaveBeenCalled();
  });

  it('ne relance rien pendant qu’une page est déjà en vol', () => {
    const loadMore = vi.fn();
    renderHook(() =>
      useAutoLoadMore({
        ref: box(0).ref,
        articleCount: 0,
        hasContinuation: true,
        loading: false,
        loadingMore: true,
        loadMore,
      })
    );
    expect(loadMore).not.toHaveBeenCalled();
  });
});
