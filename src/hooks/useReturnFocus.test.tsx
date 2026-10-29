// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { useEffect, useRef, useState } from 'react';
import { render, cleanup, act } from '@testing-library/react';
import { useReturnFocus } from './useReturnFocus';

afterEach(cleanup);
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

/*
 * Préférences, palette, aide des raccourcis, feuille du bas : à la fermeture
 * (Échap, croix), le focus tombait sur <body> et la tabulation repartait du
 * haut de la page. `ConfirmDialog` et `AddFeedDialog` le rendaient déjà.
 */
function Surface({ open }: { open: boolean }) {
  useReturnFocus(open);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  return open ? <input ref={input} aria-label="dedans" /> : null;
}

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>ouvrir</button>
      <button onClick={() => setOpen(false)}>fermer</button>
      <Surface open={open} />
    </>
  );
}

describe('useReturnFocus', () => {
  it('rend le focus à l’élément qui avait le focus à l’ouverture', async () => {
    const c = render(<Harness />);
    const opener = c.getByText('ouvrir');
    opener.focus();
    act(() => { opener.click(); });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('dedans');
    act(() => { c.getByText('fermer').click(); });
    await tick();
    expect(document.activeElement).toBe(opener);
  });

  it('le rend aussi quand la surface est démontée ouverte', async () => {
    const c = render(<button>ouvrir</button>);
    const opener = c.getByText('ouvrir');
    opener.focus();
    const s = render(<Surface open />);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('dedans');
    s.unmount();
    await tick();
    expect(document.activeElement).toBe(opener);
  });

  it('ne vole pas le focus à une surface qui l’a pris entre-temps', async () => {
    const c = render(<Harness />);
    const opener = c.getByText('ouvrir');
    opener.focus();
    act(() => { opener.click(); });
    act(() => { c.getByText('fermer').click(); });
    c.getByText('fermer').focus(); // une autre surface a pris le focus
    await tick();
    expect(document.activeElement).toBe(c.getByText('fermer'));
  });
});
