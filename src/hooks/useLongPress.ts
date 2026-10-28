import {
  useCallback, useEffect, useRef,
  type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent,
} from 'react';

/** Durée d'appui qui ouvre un menu au doigt (article, flux, bouton). Une seule pour tous. */
export const LONG_PRESS_MS = 500;

/** Durée pendant laquelle un `contextmenu` ou un clic qui suit un appui long est absorbé (Chrome Android). */
export const LONG_PRESS_ECHO_MS = 1000;

/**
 * Distance (depuis le point de départ) au-delà de laquelle le doigt — ou la
 * souris — « bouge » et annule l'appui. C'est aussi le seuil auquel le
 * balayage d'une ligne décide sa direction (`SwipeableArticleRow`), qui
 * l'importe : les deux ne doivent jamais diverger.
 */
export const LONG_PRESS_MOVE_TOLERANCE_PX = 8;

export interface PressPoint {
  x: number;
  y: number;
}

export interface LongPressOptions {
  /** Arme aussi le bouton principal de la souris (étoile, À lire plus tard). */
  mouse?: boolean;
  /** Faux : aucun gestionnaire n'agit, un appui en cours est annulé. */
  enabled?: boolean;
}

/** Ce qu'un composant parent (le balayage d'une ligne) peut demander à l'appui long. */
export interface LongPressControl {
  cancel: () => void;
  firedThisContact: () => boolean;
}

function farFrom(origin: PressPoint, x: number, y: number): boolean {
  return Math.hypot(x - origin.x, y - origin.y) > LONG_PRESS_MOVE_TOLERANCE_PX;
}

/**
 * L'appui long de FriRSS — la SEULE implémentation : lignes et cartes
 * d'article (`useArticleMenuGestures`), lignes de flux (`FeedItem`), étoile et
 * « À lire plus tard » de la liste (`ArticleActions.tsx`) et du volet de
 * lecture (`ActionBtn`), bouton de traduction. 500 ms partout.
 *
 * - un mouvement de plus de `LONG_PRESS_MOVE_TOLERANCE_PX` depuis le point de
 *   départ annule (défilement, balayage) ; un tremblement en deçà, non — un
 *   pouce posé n'est jamais immobile. Un `touchmove` sans doigt mesurable
 *   annule, plutôt que de deviner ;
 * - `touchend`, `touchcancel` et un second doigt (au `touchstart` comme au
 *   `touchmove`) annulent : un geste à deux doigts (pincer) n'ouvre rien ;
 * - le minuteur ne survit pas au composant : une relève qui retire la ligne
 *   pendant l'appui ouvrirait un menu sur un élément qui n'est plus là ;
 * - le `touchend` d'un appui abouti est `preventDefault()` : le clic de
 *   compatibilité n'est pas émis (sur téléphone il refermerait la feuille du
 *   bas ouverte sous le doigt). Filet en plus : le clic qui arriverait quand
 *   même est avalé en phase de capture (`onClickCapture`), mais seulement dans
 *   la fenêtre d'écho, comptée depuis le déclenchement OU le relâchement —
 *   le clic d'une souris arrive au relâchement, qui peut venir bien après.
 *   Passé ce délai, un clic qu'aucun nouveau contact n'a effacé (ex. celui
 *   d'un bouton de la ligne, dont le geste appartient au bouton) passe ;
 * - `mouse: true` arme le bouton PRINCIPAL seulement ; relâcher, sortir ou
 *   bouger au-delà de la tolérance annule. Le clic droit reste le
 *   gestionnaire `onContextMenu` de l'appelant, qui doit absorber l'écho :
 *   `if (lp.firedRecently()) { e.preventDefault(); return; }` — Chrome
 *   Android émet `contextmenu` sur l'appui long qui vient d'aboutir ;
 * - `reset()` efface la consigne « clic avalé » sans toucher l'horodatage :
 *   `useArticleMenuGestures` l'appelle sur CHAQUE contact qui démarre dans la
 *   ligne, avant ses propres filtres (bouton, menu absent) ;
 * - `firedThisContact()` : l'appui a abouti pendant le contact en cours (vrai
 *   jusqu'au contact suivant). Le balayage s'en sert, pas de `firedRecently()` :
 *   un doigt resté posé deux secondes avant de glisser a dépassé la fenêtre
 *   d'écho, pas le contact.
 */
export function useLongPress(onLongPress: (point: PressPoint) => void, opts: LongPressOptions = {}) {
  const { mouse = false, enabled = true } = opts;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<PressPoint | null>(null);
  const fired = useRef(false);
  const firedAt = useRef<number | null>(null);
  const releasedAt = useRef<number | null>(null);
  const callback = useRef(onLongPress);
  useEffect(() => {
    callback.current = onLongPress;
  });

  const cancel = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);
  useEffect(() => {
    if (!enabled) cancel();
  }, [enabled, cancel]);

  const reset = useCallback(() => {
    fired.current = false;
  }, []);

  const firedRecently = useCallback(() => {
    const now = Date.now();
    const recent = (t: number | null) => t !== null && now - t < LONG_PRESS_ECHO_MS;
    return recent(firedAt.current) || recent(releasedAt.current);
  }, []);

  const firedThisContact = useCallback(() => fired.current, []);

  const arm = useCallback((point: PressPoint) => {
    origin.current = point;
    timer.current = setTimeout(() => {
      timer.current = null;
      fired.current = true;
      firedAt.current = Date.now();
      releasedAt.current = null;
      callback.current(point);
    }, LONG_PRESS_MS);
  }, []);

  /** Fin d'un contact : si l'appui avait abouti, la fenêtre d'écho repart d'ici. */
  const release = useCallback(() => {
    cancel();
    if (fired.current) releasedAt.current = Date.now();
  }, [cancel]);

  const onTouchStart = useCallback((e: ReactTouchEvent) => {
    reset();
    cancel();
    if (!enabled) return;
    const touches = e.touches;
    // Un second doigt (pincer, geste à deux doigts) annule l'appui en cours
    // sans en démarrer un nouveau.
    if (touches && touches.length > 1) return;
    const touch = touches?.[0];
    arm({ x: touch?.clientX ?? 0, y: touch?.clientY ?? 0 });
  }, [enabled, cancel, reset, arm]);

  const onTouchMove = useCallback((e: ReactTouchEvent) => {
    const from = origin.current;
    if (!timer.current || !from) return;
    const touches = e.touches;
    const touch = touches?.[0];
    if (!touch || touches.length > 1 || farFrom(from, touch.clientX, touch.clientY)) cancel();
  }, [cancel]);

  const onTouchCancel = useCallback(() => {
    release();
    reset();
  }, [release, reset]);

  const onTouchEnd = useCallback((e: ReactTouchEvent) => {
    release();
    // Appui abouti : supprimer le clic de compatibilité à la source. Sur
    // téléphone, la feuille du bas vient de s'ouvrir SOUS le doigt, et ce clic
    // tomberait sur son fond — qui la refermerait aussitôt. La capture
    // ci-dessous ne le rattraperait pas : il ne viserait plus la ligne.
    if (fired.current && e.cancelable) e.preventDefault();
  }, [release]);

  const onClickCapture = useCallback((e: ReactMouseEvent) => {
    if (!fired.current) return;
    const recent = firedRecently();
    fired.current = false;
    if (!recent) return;
    e.preventDefault();
    e.stopPropagation();
  }, [firedRecently]);

  const onMouseDown = useCallback((e: ReactMouseEvent) => {
    // Le bouton principal seulement : le clic droit appartient au
    // `onContextMenu` de l'appelant, la molette à l'ouverture à la source.
    if (e.button !== 0) return;
    reset();
    cancel();
    if (!enabled) return;
    arm({ x: e.clientX, y: e.clientY });
  }, [enabled, cancel, reset, arm]);

  const onMouseMove = useCallback((e: ReactMouseEvent) => {
    const from = origin.current;
    if (timer.current && from && farFrom(from, e.clientX, e.clientY)) cancel();
  }, [cancel]);

  const mouseHandlers = mouse
    ? { onMouseDown, onMouseMove, onMouseUp: release, onMouseLeave: release }
    : { onMouseDown: undefined, onMouseMove: undefined, onMouseUp: undefined, onMouseLeave: undefined };

  return {
    onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onClickCapture,
    ...mouseHandlers,
    firedRecently, firedThisContact, reset, cancel,
  };
}
