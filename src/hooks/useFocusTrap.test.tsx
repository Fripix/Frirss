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
});
