// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen, act } from '@testing-library/react';
import { useState } from 'react';
import { useArticleFocusReturn } from './useArticleFocusReturn';

afterEach(cleanup);

/**
 * La disposition desktop en grille (ou à deux panneaux) : la liste est
 * DÉMONTÉE pendant la lecture et remontée à la fermeture, et le volet l'est à
 * l'inverse. `rowsLate` : les lignes n'arrivent qu'au rendu suivant.
 */
function Harness({ selected, enabled = true, rowsLate = false }: { selected: string | null; enabled?: boolean; rowsLate?: boolean }) {
  useArticleFocusReturn(selected, enabled);
  const [late, setLate] = useState(rowsLate);
  if (late) requestAnimationFrame(() => setLate(false));
  return (
    <div>
      <button>Ailleurs</button>
      {selected
        ? <div><button>Retour</button></div>
        : !late && (
          <div>
            <div data-article-id="a1" tabIndex={-1}>Carte 1</div>
            <div data-article-id="a2" tabIndex={-1}>Carte 2</div>
          </div>
        )}
    </div>
  );
}

const nextFrames = async (n = 3) => {
  for (let i = 0; i < n; i++) await act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
};

// A-4 (campagne 1.9.0) : sur ordinateur, fermer l'article (Échap en grille, ou
// le bouton Retour) démontait le volet sous le focus, qui retombait sur
// <body> — la tabulation repartait du haut de la page. Corrigé au téléphone
// par `MobileStack` (`focusKey`), pas ailleurs.
describe('useArticleFocusReturn', () => {
  it('article refermé : le focus revient sur la carte de l’article fermé', async () => {
    const { rerender } = render(<Harness selected="a2" />);
    screen.getByText('Retour').focus();
    rerender(<Harness selected={null} />);
    await nextFrames(1);
    expect(document.activeElement).toBe(screen.getByText('Carte 2'));
  });

  it('attend la carte quand la liste la rend un peu plus tard', async () => {
    const { rerender } = render(<Harness selected="a1" rowsLate />);
    screen.getByText('Retour').focus();
    rerender(<Harness selected={null} rowsLate />);
    await nextFrames();
    expect(document.activeElement).toBe(screen.getByText('Carte 1'));
  });

  it('le focus a été posé ailleurs : il n’est pas déplacé', async () => {
    const { rerender } = render(<Harness selected="a2" />);
    screen.getByText('Ailleurs').focus();
    rerender(<Harness selected={null} />);
    await nextFrames();
    expect(document.activeElement).toBe(screen.getByText('Ailleurs'));
  });

  it('passer d’un article à l’autre ne déplace rien', async () => {
    const { rerender } = render(<Harness selected="a1" />);
    screen.getByText('Retour').focus();
    rerender(<Harness selected="a2" />);
    await nextFrames();
    expect(document.activeElement).toBe(screen.getByText('Retour'));
  });

  // M-05 (second round) : la liste, démontée pendant la lecture, revient à la
  // position de l'ouverture ; l'article fermé, atteint au clavier depuis, est
  // plus bas — focalisé avec `preventScroll`, son anneau restait hors écran.
  it('carte hors de l’écran : la liste défile au plus juste pour la montrer, puis la focalise', async () => {
    function Scrolled({ selected }: { selected: string | null }) {
      useArticleFocusReturn(selected);
      return selected
        ? <button>Retour</button>
        : (
          <div data-article-scroll data-testid="list">
            <div data-article-id="a1" tabIndex={-1}>Carte 1</div>
            <div data-article-id="a9" tabIndex={-1}>Carte 9</div>
          </div>
        );
    }
    const { rerender } = render(<Scrolled selected="a9" />);
    screen.getByText('Retour').focus();
    const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    // La liste : 300 px de haut, en haut de l'écran ; la carte 9 à 900-1000 px
    // de son contenu.
    const proto = HTMLElement.prototype;
    const original = proto.getBoundingClientRect;
    const clientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')!;
    const listEl = () => document.querySelector<HTMLElement>('[data-testid="list"]');
    proto.getBoundingClientRect = function (this: HTMLElement) {
      if (this.dataset.testid === 'list') return rect(0, 300);
      const scrolled = listEl()?.scrollTop ?? 0;
      if (this.dataset.articleId === 'a9') return rect(900 - scrolled, 1000 - scrolled);
      return rect(-scrolled, 100 - scrolled);
    };
    Object.defineProperty(Element.prototype, 'clientHeight', {
      configurable: true,
      get(this: Element) { return (this as HTMLElement).dataset?.testid === 'list' ? 300 : 0; },
    });
    try {
      rerender(<Scrolled selected={null} />);
      await nextFrames(1);
      expect(document.activeElement).toBe(screen.getByText('Carte 9'));
      // Au plus juste : le bas de la carte au bas de la liste, pas plus.
      expect(screen.getByTestId('list').scrollTop).toBe(700);
    } finally {
      proto.getBoundingClientRect = original;
      Object.defineProperty(Element.prototype, 'clientHeight', clientHeight);
    }
  });

  it('désactivé (téléphone, où `MobileStack` s’en charge) : ne fait rien', async () => {
    const { rerender } = render(<Harness selected="a2" enabled={false} />);
    screen.getByText('Retour').focus();
    rerender(<Harness selected={null} enabled={false} />);
    await nextFrames();
    expect(document.activeElement).toBe(document.body);
  });
});
