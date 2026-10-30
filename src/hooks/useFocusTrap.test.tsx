// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { useRef, useState } from 'react';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { useFocusTrap } from './useFocusTrap';

afterEach(cleanup);

function Box({ label, open = true, children }: { label: string; open?: boolean; children?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open);
  return open ? (
    <div ref={ref} role="dialog" aria-modal="true" aria-label={label}>
      <button>{label}-1</button>
      <button disabled>{label}-off</button>
      <button>{label}-2</button>
      {children}
    </div>
  ) : null;
}

const tab = (shift = false) => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', shiftKey: shift });

/*
 * Préférences, palette, aide, feuilles, confirmations : `aria-modal` sans
 * piège, la tabulation sortait vers la page restée derrière.
 */
describe('useFocusTrap', () => {
  it('fait boucler Tab et Maj+Tab dans la boîte', () => {
    const c = render(<><button>dehors</button><Box label="a" /></>);
    const last = c.getByText('a-2');
    act(() => { last.focus(); });
    tab();
    expect(document.activeElement).toBe(c.getByText('a-1'));
    tab(true);
    expect(document.activeElement).toBe(last);
  });

  it('ramène dans la boîte un focus resté dehors', () => {
    const c = render(<><button>dehors</button><Box label="a" /></>);
    act(() => { c.getByText('dehors').focus(); });
    tab();
    expect(document.activeElement).toBe(c.getByText('a-1'));
  });

  it('seule la dernière boîte ouverte retient la tabulation', () => {
    function H() {
      const [top, setTop] = useState(false);
      return (
        <>
          <Box label="prefs"><button onClick={() => setTop(true)}>ouvrir</button></Box>
          <Box label="confirm" open={top} />
        </>
      );
    }
    const c = render(<H />);
    act(() => { c.getByText('ouvrir').click(); });
    act(() => { c.getByText('confirm-2').focus(); });
    tab();
    expect(document.activeElement).toBe(c.getByText('confirm-1'));
  });

  it('ne fait rien hors de Tab', () => {
    const c = render(<Box label="a" />);
    act(() => { c.getByText('a-2').focus(); });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(c.getByText('a-2'));
  });

  // Les Préférences gardent montées les sections visitées, cachées par
  // `hidden` sur leur ENVELOPPE : leurs boutons comptaient comme « dernier »,
  // et Tab sortait de la boîte depuis le dernier contrôle visible.
  it('ignore les éléments d’une partie cachée', () => {
    const c = render(
      <Box label="a">
        <div hidden><button>caché</button></div>
      </Box>,
    );
    act(() => { c.getByText('a-2').focus(); });
    tab();
    expect(document.activeElement).toBe(c.getByText('a-1'));
  });

  // L'exemption des menus en portail visait les menus HORS de la boîte : la
  // liste de la palette, elle, est dedans, et Tab quittait la palette.
  it('retient aussi la tabulation dans une liste qui fait partie de la boîte', () => {
    const c = render(
      <Box label="a">
        <ul role="listbox"><li><button>option</button></li></ul>
      </Box>,
    );
    act(() => { c.getByText('option').focus(); });
    tab();
    expect(document.activeElement).toBe(c.getByText('a-1'));
  });

  // Les Préférences et l'aide se donnent le focus à l'ouverture (le
  // conteneur, `tabIndex={-1}`) : Maj+Tab depuis lui sortait de la boîte.
  it('Maj+Tab depuis le conteneur lui-même va au dernier élément', () => {
    function Panel() {
      const ref = useRef<HTMLDivElement>(null);
      useFocusTrap(ref, true);
      return <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true"><button>p-1</button><button>p-2</button></div>;
    }
    const c = render(<><button>avant</button><Panel /></>);
    act(() => { (c.getByRole('dialog') as HTMLElement).focus(); });
    tab(true);
    expect(document.activeElement).toBe(c.getByText('p-2'));
  });
});
