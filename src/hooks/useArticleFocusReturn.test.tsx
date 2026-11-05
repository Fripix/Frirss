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

  it('désactivé (téléphone, où `MobileStack` s’en charge) : ne fait rien', async () => {
    const { rerender } = render(<Harness selected="a2" enabled={false} />);
    screen.getByText('Retour').focus();
    rerender(<Harness selected={null} enabled={false} />);
    await nextFrames();
    expect(document.activeElement).toBe(document.body);
  });
});
