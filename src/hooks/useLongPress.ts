import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from 'react';

/** Durée d'appui qui ouvre le menu d'un article au doigt — la même que pour un flux. */
export const LONG_PRESS_MS = 500;

/** Durée pendant laquelle un `contextmenu` qui suit un appui long est absorbé (Chrome Android). */
export const LONG_PRESS_ECHO_MS = 1000;

export interface PressPoint {
  x: number;
  y: number;
}

/**
 * Appui long au doigt.
 *
 * ⚠️ Troisième implémentation d'un appui long de 500 ms, assumée : celle d'une
 * ligne de flux (`FeedItem`, `Sidebar.tsx`) et `useFileGesture`
 * (`ArticleActions.tsx`) fonctionnent et viennent d'être validées sur appareil.
 * Les unifier est au backlog, pas dans ce changement.
 *
 * - `touchmove` et `touchend` annulent : un défilement ou un balayage de ligne
 *   n'ouvre rien ;
 * - le `touchend` d'un appui abouti est `preventDefault()` : le clic de
 *   compatibilité n'est pas émis (sur téléphone il refermerait la feuille du
 *   bas ouverte sous le doigt). Filet en plus : le clic qui arriverait quand
 *   même est avalé en phase de capture — sans cela, le menu s'ouvrirait ET
 *   l'article se sélectionnerait derrière. Un nouveau contact efface cette
 *   consigne si aucun clic ne l'a consommée ;
 * - `firedRecently()` sert au piège de Chrome Android, qui émet aussi
 *   `contextmenu` sur un appui long.
 */
export function useLongPress(onLongPress: (point: PressPoint) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const firedAt = useRef<number | null>(null);
  const callback = useRef(onLongPress);
  useEffect(() => {
    callback.current = onLongPress;
  });

  const cancel = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  useEffect(() => cancel, [cancel]);

  const onTouchStart = useCallback((e: ReactTouchEvent) => {
    const touch = e.touches[0];
    const point = { x: touch?.clientX ?? 0, y: touch?.clientY ?? 0 };
    fired.current = false;
    cancel();
    timer.current = setTimeout(() => {
      timer.current = null;
      fired.current = true;
      firedAt.current = Date.now();
      callback.current(point);
    }, LONG_PRESS_MS);
  }, [cancel]);

  const onClickCapture = useCallback((e: ReactMouseEvent) => {
    if (!fired.current) return;
    fired.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const firedRecently = useCallback(
    () => firedAt.current !== null && Date.now() - firedAt.current < LONG_PRESS_ECHO_MS,
    [],
  );

  const onTouchEnd = useCallback((e: ReactTouchEvent) => {
    cancel();
    // Appui abouti : supprimer le clic de compatibilité à la source. Sur
    // téléphone, la feuille du bas vient de s'ouvrir SOUS le doigt, et ce clic
    // tomberait sur son fond — qui la refermerait aussitôt. La capture ci-dessus
    // ne le rattraperait pas : il ne viserait plus la ligne.
    if (fired.current && e.cancelable) e.preventDefault();
  }, [cancel]);

  return { onTouchStart, onTouchMove: cancel, onTouchEnd, onClickCapture, firedRecently };
}
