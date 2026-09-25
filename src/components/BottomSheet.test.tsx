// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import BottomSheet from './BottomSheet';

afterEach(cleanup);

beforeEach(() => {
  vi.useFakeTimers();
  // Le compteur de contacts actifs vit au niveau du module (un seul jeu
  // d'écouteurs pour toutes les feuilles) : le remettre à zéro entre les
  // tests pour qu'aucun ne dépende de l'ordre d'exécution des autres.
  document.dispatchEvent(touchEvent('touchcancel', []));
});
afterEach(() => {
  vi.useRealTimers();
});

/**
 * Sur iPhone, lever le doigt après l'appui long qui ouvre la feuille émet un
 * clic de compatibilité aux coordonnées du doigt — donc sur le fond de la
 * feuille qui vient de s'ouvrir sous lui. Sans fenêtre de grâce, ce clic la
 * refermait aussitôt : la feuille apparaissait puis disparaissait dès que le
 * doigt se levait.
 */
/**
 * Construit un évènement tactile minimal exploitable en jsdom : `TouchEvent`
 * n'y est pas toujours constructible, donc on part d'un `Event` générique et
 * on lui greffe la propriété `touches` lue par le module.
 */
function touchEvent(type: string, touches: unknown[]): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: touches, configurable: true });
  return event;
}

describe('BottomSheet — fenêtre de grâce du fond', () => {
  it('un clic sur le fond juste après l’ouverture ne ferme pas la feuille', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose} title="Menu">
        <button type="button">Action</button>
      </BottomSheet>,
    );

    fireEvent.click(document.querySelector('.bottom-sheet-root')!);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('le même clic sur le fond, passé le délai de grâce, ferme la feuille', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose} title="Menu">
        <button type="button">Action</button>
      </BottomSheet>,
    );

    vi.advanceTimersByTime(300);
    fireEvent.click(document.querySelector('.bottom-sheet-root')!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Échap ferme la feuille même pendant la fenêtre de grâce', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose} title="Menu">
        <button type="button">Action</button>
      </BottomSheet>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('un clic sur le contenu de la feuille ne la ferme jamais, grâce ou pas', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose} title="Menu">
        <button type="button">Action</button>
      </BottomSheet>,
    );

    vi.advanceTimersByTime(300);
    fireEvent.click(document.querySelector('.bottom-sheet')!);

    expect(onClose).not.toHaveBeenCalled();
  });
});

/**
 * Sur iPhone, le clic de compatibilité arrive au LEVER du doigt, pas à
 * l'ouverture de la feuille : si l'appui long dure une seconde de plus une
 * fois la feuille ouverte, compter la grâce depuis l'ouverture ne protège
 * plus rien. Quand un doigt est encore posé à l'ouverture, la feuille ne
 * doit s'armer qu'après le lever de CE doigt (`touchend`/`touchcancel`),
 * puis compter la grâce à partir de là.
 */
describe('BottomSheet — armement retardé au lever du doigt (appui long)', () => {
  it("un clic sur le fond juste après l'ouverture, doigt encore posé, ne ferme pas la feuille", () => {
    const onClose = vi.fn();
    document.dispatchEvent(touchEvent('touchstart', [{}]));

    render(
      <BottomSheet open onClose={onClose} title="Menu">
        <button type="button">Action</button>
      </BottomSheet>,
    );

    fireEvent.click(document.querySelector('.bottom-sheet-root')!);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('un clic sur le fond après le lever du doigt, dans la fenêtre de grâce, ne ferme toujours pas', () => {
    const onClose = vi.fn();
    document.dispatchEvent(touchEvent('touchstart', [{}]));

    render(
      <BottomSheet open onClose={onClose} title="Menu">
        <button type="button">Action</button>
      </BottomSheet>,
    );

    document.dispatchEvent(touchEvent('touchend', []));
    vi.advanceTimersByTime(299);
    fireEvent.click(document.querySelector('.bottom-sheet-root')!);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('un clic sur le fond après le lever du doigt et la fenêtre de grâce écoulée ferme la feuille', () => {
    const onClose = vi.fn();
    document.dispatchEvent(touchEvent('touchstart', [{}]));

    render(
      <BottomSheet open onClose={onClose} title="Menu">
        <button type="button">Action</button>
      </BottomSheet>,
    );

    document.dispatchEvent(touchEvent('touchend', []));
    vi.advanceTimersByTime(300);
    fireEvent.click(document.querySelector('.bottom-sheet-root')!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cas réel : appui tenu deux secondes après l'ouverture, puis lever du doigt, puis clic d'écho immédiat — la feuille reste ouverte", () => {
    const onClose = vi.fn();
    document.dispatchEvent(touchEvent('touchstart', [{}]));

    render(
      <BottomSheet open onClose={onClose} title="Menu">
        <button type="button">Action</button>
      </BottomSheet>,
    );

    // Le doigt reste posé longtemps après que la feuille est apparue : le cas
    // qui met en défaut une grâce comptée depuis l'ouverture.
    vi.advanceTimersByTime(2000);
    document.dispatchEvent(touchEvent('touchend', []));
    // Clic de compatibilité émis par iOS au moment même du lever du doigt.
    fireEvent.click(document.querySelector('.bottom-sheet-root')!);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('ouverture sans contact actif (tape/clavier) : comportement inchangé, grâce comptée depuis l’ouverture', () => {
    const onClose = vi.fn();
    // Aucun touchstart : ni souris, ni clavier ne posent de doigt sur l'écran.
    render(
      <BottomSheet open onClose={onClose} title="Menu">
        <button type="button">Action</button>
      </BottomSheet>,
    );

    fireEvent.click(document.querySelector('.bottom-sheet-root')!);
    expect(onClose).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    fireEvent.click(document.querySelector('.bottom-sheet-root')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
