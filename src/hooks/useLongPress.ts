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
 * - `touchmove`, `touchend`, `touchcancel` et un second doigt annulent : un
 *   défilement, un balayage de ligne, ou un geste à deux doigts (pincer)
 *   n'ouvrent rien ;
 * - le `touchend` d'un appui abouti est `preventDefault()` : le clic de
 *   compatibilité n'est pas émis (sur téléphone il refermerait la feuille du
 *   bas ouverte sous le doigt). Filet en plus : le clic qui arriverait quand
 *   même est avalé en phase de capture, mais seulement s'il arrive dans la
 *   fenêtre d'écho (`firedRecently()`) — passé ce délai, un clic qu'aucun
 *   nouveau contact n'a effacé (ex. celui d'un bouton de la ligne, dont le
 *   geste appartient au bouton et ne repasse jamais par `onTouchStart`) est
 *   laissé passer plutôt que perdu indéfiniment ;
 * - `reset()` efface cette consigne sans toucher `firedAt` : appelée par
 *   `useArticleMenuGestures` sur CHAQUE contact qui démarre dans la ligne,
 *   avant même ses propres filtres (bouton, menu absent) ;
 * - `firedRecently()` sert aussi au piège de Chrome Android, qui émet
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

  const reset = useCallback(() => {
    fired.current = false;
  }, []);

  const firedRecently = useCallback(
    () => firedAt.current !== null && Date.now() - firedAt.current < LONG_PRESS_ECHO_MS,
    [],
  );

  const onTouchStart = useCallback((e: ReactTouchEvent) => {
    reset();
    cancel();
    // Un second doigt (pincer, geste à deux doigts) annule l'appui en cours
    // sans en démarrer un nouveau.
    if (e.touches.length > 1) return;
    const touch = e.touches[0];
    const point = { x: touch?.clientX ?? 0, y: touch?.clientY ?? 0 };
    timer.current = setTimeout(() => {
      timer.current = null;
      fired.current = true;
      firedAt.current = Date.now();
      callback.current(point);
    }, LONG_PRESS_MS);
  }, [cancel, reset]);

  const onTouchCancel = useCallback(() => {
    cancel();
    reset();
  }, [cancel, reset]);

  const onClickCapture = useCallback((e: ReactMouseEvent) => {
    if (!fired.current) return;
    const recent = firedRecently();
    fired.current = false;
    if (!recent) return;
    e.preventDefault();
    e.stopPropagation();
  }, [firedRecently]);

  const onTouchEnd = useCallback((e: ReactTouchEvent) => {
    cancel();
    // Appui abouti : supprimer le clic de compatibilité à la source. Sur
    // téléphone, la feuille du bas vient de s'ouvrir SOUS le doigt, et ce clic
    // tomberait sur son fond — qui la refermerait aussitôt. La capture ci-dessus
    // ne le rattraperait pas : il ne viserait plus la ligne.
    if (fired.current && e.cancelable) e.preventDefault();
  }, [cancel]);

  return { onTouchStart, onTouchMove: cancel, onTouchEnd, onTouchCancel, onClickCapture, firedRecently, reset };
}
