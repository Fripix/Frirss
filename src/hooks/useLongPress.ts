import {
  useCallback, useEffect, useMemo, useRef,
  type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent,
} from 'react';

/** Durée d'appui qui ouvre un menu au doigt (article, flux, bouton). Une seule pour tous. */
export const LONG_PRESS_MS = 500;

/** Durée, après le relâchement d'un appui abouti, pendant laquelle un `contextmenu` ou un clic d'écho est absorbé. */
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

/** Ce qu'un composant parent (le balayage, le drag d'une ligne) peut demander à l'appui long. */
export interface LongPressControl {
  cancel: () => void;
  firedThisContact: () => boolean;
  claimTouchDrag: () => boolean;
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
 * - ⚠️ **Chrome Android** (mesuré sur émulateur, délai système 400 ms) :
 *   sur un élément non déplaçable, `contextmenu` arrive à ~491 ms, AVANT le
 *   minuteur ; sur une ligne `draggable`, c'est un `dragstart` natif à
 *   ~495 ms suivi d'un `touchcancel`. L'écho est donc lié au CONTACT, pas à
 *   une horloge : `claimContextMenu(e)` (à appeler en tête du `onContextMenu`
 *   de l'appelant) déclenche tout de suite un appui tactile armé — même
 *   point, une seule ouverture — et absorbe le `contextmenu` d'un appui qui a
 *   abouti pendant ce contact, si tard qu'il arrive (délai d'accessibilité
 *   ≥ 1 s) ; `claimTouchDrag()` fait de même pour le drag natif, que
 *   l'appelant annule. Un `touchcancel` qui suit un appui abouti ne le défait
 *   pas. `firedRecently()` : pendant le contact d'un appui abouti, puis une
 *   seconde après son relâchement ;
 * - `mouse: true` arme le bouton PRINCIPAL seulement ; relâcher, sortir ou
 *   bouger au-delà de la tolérance annule. Le clic droit reste le
 *   gestionnaire `onContextMenu` de l'appelant, qui commence par
 *   `if (lp.claimContextMenu(e)) return;` (voir Chrome Android ci-dessus) ;
 * - `reset()` efface la consigne « clic avalé » sans toucher l'horodatage :
 *   `useArticleMenuGestures` l'appelle sur CHAQUE contact qui démarre dans la
 *   ligne, avant ses propres filtres (bouton, menu absent) ;
 * - `firedThisContact()` : l'appui a abouti pendant le contact EN COURS (faux
 *   dès le relâchement). Le balayage s'en sert : relâchée, l'étoile d'une
 *   ligne ne bloque pas le balayage du contact suivant.
 * - `control` : `{ cancel, firedThisContact, claimTouchDrag }`, stable, pour
 *   le registre des appuis d'une ligne (`rowPress.ts`).
 */
export function useLongPress(onLongPress: (point: PressPoint) => void, opts: LongPressOptions = {}) {
  const { mouse = false, enabled = true } = opts;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<PressPoint | null>(null);
  const fired = useRef(false);
  /** Le contact en cours sur l'élément : doigt, bouton de souris, ou aucun. */
  const contact = useRef<'touch' | 'mouse' | null>(null);
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
    if (fired.current && contact.current !== null) return true;
    return releasedAt.current !== null && now - releasedAt.current < LONG_PRESS_ECHO_MS;
  }, []);

  const firedThisContact = useCallback(() => fired.current && contact.current !== null, []);

  /** Aboutissement — par le minuteur, ou plus tôt par `fireNow()`. */
  const fire = useCallback((point: PressPoint) => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    fired.current = true;
    releasedAt.current = null;
    callback.current(point);
  }, []);

  const arm = useCallback((point: PressPoint) => {
    origin.current = point;
    timer.current = setTimeout(() => fire(point), LONG_PRESS_MS);
  }, [fire]);

  /** Un appui TACTILE armé aboutit tout de suite, au même point. */
  const fireNow = useCallback(() => {
    const from = origin.current;
    if (contact.current !== 'touch' || !timer.current || !from) return false;
    fire(from);
    return true;
  }, [fire]);

  /**
   * Fin d'un contact : si l'appui avait abouti, la fenêtre d'écho repart d'ici
   * — une fois. Un `mouseleave` de compatibilité émis plus tard (iOS, en
   * touchant ailleurs), hors de tout contact, ne la rallonge pas.
   */
  const release = useCallback(() => {
    cancel();
    if (contact.current !== null && fired.current) releasedAt.current = Date.now();
    contact.current = null;
  }, [cancel]);

  const onTouchStart = useCallback((e: ReactTouchEvent) => {
    reset();
    cancel();
    contact.current = null;
    if (!enabled) return;
    const touches = e.touches;
    // Un second doigt (pincer, geste à deux doigts) annule l'appui en cours
    // sans en démarrer un nouveau.
    if (touches && touches.length > 1) return;
    const touch = touches?.[0];
    contact.current = 'touch';
    arm({ x: touch?.clientX ?? 0, y: touch?.clientY ?? 0 });
  }, [enabled, cancel, reset, arm]);

  /**
   * En tête du `onContextMenu` de l'appelant : vrai = l'événement appartient
   * à l'appui long (déjà `preventDefault()`), l'appelant n'en fait rien.
   */
  const claimContextMenu = useCallback((e: ReactMouseEvent) => {
    if (fireNow() || firedRecently()) {
      e.preventDefault();
      return true;
    }
    return false;
  }, [fireNow, firedRecently]);

  /**
   * Le drag natif qui démarre pendant un contact TACTILE appartient à
   * l'appui : vrai = l'appelant doit l'annuler (`preventDefault()`). Un drag
   * à la souris n'est jamais réclamé.
   */
  const claimTouchDrag = useCallback(() => {
    if (contact.current !== 'touch') return false;
    return fireNow() || fired.current;
  }, [fireNow]);

  const onTouchMove = useCallback((e: ReactTouchEvent) => {
    const from = origin.current;
    if (!timer.current || !from) return;
    const touches = e.touches;
    const touch = touches?.[0];
    if (!touch || touches.length > 1 || farFrom(from, touch.clientX, touch.clientY)) cancel();
  }, [cancel]);

  // Pas de `reset()` : un `touchcancel` qui suit un appui abouti (le drag
  // natif de Chrome Android) ne le défait pas, son écho reste absorbé.
  const onTouchCancel = useCallback(() => {
    release();
  }, [release]);

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
    if (e.button !== 0 || contact.current === 'touch') return;
    reset();
    cancel();
    contact.current = null;
    if (!enabled) return;
    contact.current = 'mouse';
    arm({ x: e.clientX, y: e.clientY });
  }, [enabled, cancel, reset, arm]);

  // Les événements souris n'agissent que sur un contact SOURIS : ceux de
  // compatibilité émis pendant un contact au doigt ne le terminent pas.
  const onMouseMove = useCallback((e: ReactMouseEvent) => {
    const from = origin.current;
    if (contact.current === 'mouse' && timer.current && from && farFrom(from, e.clientX, e.clientY)) cancel();
  }, [cancel]);

  const onMouseRelease = useCallback(() => {
    if (contact.current === 'touch') return;
    release();
  }, [release]);

  const mouseHandlers = mouse
    ? { onMouseDown, onMouseMove, onMouseUp: onMouseRelease, onMouseLeave: onMouseRelease }
    : { onMouseDown: undefined, onMouseMove: undefined, onMouseUp: undefined, onMouseLeave: undefined };

  const control = useMemo<LongPressControl>(
    () => ({ cancel, firedThisContact, claimTouchDrag }),
    [cancel, firedThisContact, claimTouchDrag],
  );

  return {
    onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onClickCapture,
    ...mouseHandlers,
    claimContextMenu, claimTouchDrag, firedRecently, firedThisContact, reset, cancel, control,
  };
}
