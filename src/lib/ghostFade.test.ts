import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  pickGhostImages,
  awaitGhostPaint,
  GHOST_FADE_TIMEOUT_MS,
  type GhostImage,
} from './ghostFade';

/** Une fausse image : le strict minimum dont `ghostFade` se sert. */
function img(opts: Partial<GhostImage> & { decodable?: boolean } = {}) {
  const listeners: Record<string, Array<() => void>> = {};
  let resolveDecode: (() => void) | undefined;
  let rejectDecode: ((e: unknown) => void) | undefined;
  const el = {
    complete: opts.complete ?? false,
    loading: opts.loading,
    /** Combien de fois `decode()` a été appelé — `immediate` ne doit pas. */
    decodeCalls: 0,
    decode:
      opts.decodable === false
        ? undefined
        : () => {
            el.decodeCalls++;
            return new Promise<void>((res, rej) => {
              resolveDecode = res;
              rejectDecode = rej;
            });
          },
    addEventListener(type: string, cb: () => void) {
      (listeners[type] ||= []).push(cb);
    },
    // Aides de test
    fire(type: string) {
      (listeners[type] || []).forEach((cb) => cb());
    },
    decoded() {
      resolveDecode?.();
    },
    broken() {
      rejectDecode?.(new Error('EncodingError'));
    },
    listenerCount(type: string) {
      return (listeners[type] || []).length;
    },
  };
  return el;
}

/** Laisse tourner les microtâches (les promesses de `decode()`). */
const flush = () => Promise.resolve().then(() => Promise.resolve());

describe('pickGhostImages', () => {
  // Le fantôme couvre le haut de l'article : au-delà des premières images,
  // rien de ce qui charge n'est visible au moment du fondu.
  it('ne retient que les trois premières images', () => {
    const imgs = [img(), img(), img(), img(), img()];
    expect(pickGhostImages(imgs)).toHaveLength(3);
  });

  // `buildArticleBody` marque `loading="lazy"` tout ce qui suit les deux
  // premières images : hors de l'écran, elles ne peignent rien et ne peuvent
  // donc pas clignoter. Les attendre ne ferait que retenir le fantôme.
  it('écarte les images différées', () => {
    const eager = img();
    const picked = pickGhostImages([eager, img({ loading: 'lazy' })]);
    expect(picked).toEqual([eager]);
  });

  // La façade YouTube porte `loading="lazy"` alors qu'elle est l'image de tête
  // de l'article : sans ce repli, ces articles-là fondraient sans rien
  // attendre — exactement le clignotement qu'on corrige.
  it('retient quand même la première image si tout est différé', () => {
    const head = img({ loading: 'lazy' });
    expect(pickGhostImages([head, img({ loading: 'lazy' })])).toEqual([head, expect.anything()]);
  });

  it('n’attend rien quand l’article n’a aucune image', () => {
    expect(pickGhostImages([])).toEqual([]);
  });
});

describe('awaitGhostPaint', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fond immédiatement quand on le lui demande', () => {
    const ready = vi.fn();
    const i = img({ complete: true });
    awaitGhostPaint([i], ready, { immediate: true });
    expect(ready).toHaveBeenCalledTimes(1);
    expect(i.decodeCalls).toBe(0);
  });

  it('fond immédiatement quand l’article n’a aucune image', () => {
    const ready = vi.fn();
    awaitGhostPaint([], ready);
    expect(ready).toHaveBeenCalledTimes(1);
  });

  // Le cœur du bug : le préchargement met les images en cache, donc elles sont
  // « complete » dès le rendu — mais pas encore décodées. Fondre là révèle une
  // image blanche le temps du décodage.
  it('attend encore une image chargée mais pas décodée', async () => {
    const ready = vi.fn();
    const i = img({ complete: true });
    awaitGhostPaint([i], ready);
    await flush();
    expect(ready).not.toHaveBeenCalled();
    i.decoded();
    await flush();
    expect(ready).toHaveBeenCalledTimes(1);
  });

  // `decode()` rejette sur une image cassée : c'est l'équivalent de l'ancien
  // écouteur `error`, il doit libérer le fantôme, pas le figer.
  it('ne fige pas le fondu quand decode() échoue', async () => {
    const ready = vi.fn();
    const i = img();
    awaitGhostPaint([i], ready);
    i.broken();
    await flush();
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it('libère le fantôme au bout du délai de garde', async () => {
    const ready = vi.fn();
    awaitGhostPaint([img()], ready);
    await flush();
    expect(ready).not.toHaveBeenCalled();
    vi.advanceTimersByTime(GHOST_FADE_TIMEOUT_MS);
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it('ne fond qu’une seule fois', async () => {
    const ready = vi.fn();
    const i = img();
    awaitGhostPaint([i], ready);
    i.decoded();
    await flush();
    expect(ready).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(GHOST_FADE_TIMEOUT_MS * 2);
    expect(ready).toHaveBeenCalledTimes(1);
  });

  // Un moteur sans `decode()` (jsdom, vieux WebKit) doit retrouver exactement
  // l'ancien comportement plutôt que de lever.
  it('sans decode(), fond dès que tout est chargé', () => {
    const ready = vi.fn();
    awaitGhostPaint([img({ complete: true, decodable: false })], ready);
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it('sans decode(), attend l’événement load', () => {
    const ready = vi.fn();
    const i = img({ decodable: false });
    awaitGhostPaint([i], ready);
    expect(ready).not.toHaveBeenCalled();
    i.fire('load');
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it('sans decode(), l’événement error libère aussi', () => {
    const ready = vi.fn();
    const i = img({ decodable: false });
    awaitGhostPaint([i], ready);
    i.fire('error');
    expect(ready).toHaveBeenCalledTimes(1);
  });
});
