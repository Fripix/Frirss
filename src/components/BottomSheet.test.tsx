// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import BottomSheet from './BottomSheet';

afterEach(cleanup);

beforeEach(() => {
  vi.useFakeTimers();
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
