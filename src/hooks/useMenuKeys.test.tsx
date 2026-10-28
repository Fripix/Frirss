// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useMenuKeys, nextMenuIndex } from './useMenuKeys';

afterEach(cleanup);

describe('nextMenuIndex', () => {
  it('boucle aux deux bouts, Début et Fin vont aux extrémités', () => {
    expect(nextMenuIndex(0, 3, 'ArrowDown')).toBe(1);
    expect(nextMenuIndex(2, 3, 'ArrowDown')).toBe(0);
    expect(nextMenuIndex(0, 3, 'ArrowUp')).toBe(2);
    expect(nextMenuIndex(-1, 3, 'ArrowDown')).toBe(0);
    expect(nextMenuIndex(-1, 3, 'ArrowUp')).toBe(2);
    expect(nextMenuIndex(1, 3, 'Home')).toBe(0);
    expect(nextMenuIndex(1, 3, 'End')).toBe(2);
    expect(nextMenuIndex(1, 3, 'a')).toBeNull();
    expect(nextMenuIndex(0, 0, 'ArrowDown')).toBeNull();
  });
});

function Menu({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useMenuKeys(ref);
  return (
    <div ref={ref}>
      <button onClick={onClose}>Un</button>
      <button disabled>Grisé</button>
      <button onClick={onClose}>Deux</button>
      <button onClick={onClose}>Trois</button>
    </div>
  );
}

function Host() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Ouvrir</button>
      {open && <Menu onClose={() => setOpen(false)} />}
    </>
  );
}

// Les menus de l'application ne se parcouraient qu'à la tabulation, et à leur
// fermeture le focus tombait sur <body> : au clavier, on repartait du début
// de la page.
describe('useMenuKeys', () => {
  it('pose le focus sur le premier élément, puis les flèches parcourent les éléments actifs', () => {
    render(<Host />);
    fireEvent.click(screen.getByText('Ouvrir'));
    expect(document.activeElement?.textContent).toBe('Un');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('Deux');
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement?.textContent).toBe('Trois');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('Un');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement?.textContent).toBe('Trois');
  });

  it('rend le focus au déclencheur à la fermeture', () => {
    render(<Host />);
    const opener = screen.getByText('Ouvrir');
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByText('Deux'));
    expect(screen.queryByText('Deux')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('ne vole pas le focus que l’utilisateur a posé ailleurs entre-temps', () => {
    render(<><Host /><input aria-label="ailleurs" /></>);
    const opener = screen.getByText('Ouvrir');
    opener.focus();
    fireEvent.click(opener);
    const other = screen.getByLabelText('ailleurs');
    other.focus();
    fireEvent.click(screen.getByText('Un'));
    expect(document.activeElement).toBe(other);
  });
});

function Toggled() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useMenuKeys(ref, open);
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)}>Étiquettes</button>
      <div ref={ref}>{open && <button onClick={() => setOpen(false)}>Lu</button>}</div>
    </div>
  );
}

function SelfFocusing({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useMenuKeys(ref);
  return <div ref={ref}><button autoFocus onClick={onClose}>Choix</button></div>;
}

describe('useMenuKeys — menus qui restent montés ou se focalisent seuls', () => {
  it('un menu activé par interrupteur rend le focus à son déclencheur', () => {
    render(<Toggled />);
    const trigger = screen.getByText('Étiquettes');
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.activeElement?.textContent).toBe('Lu');
    fireEvent.click(screen.getByText('Lu'));
    expect(document.activeElement).toBe(trigger);
  });

  it('un menu qui a déjà pris le focus le rend quand même au déclencheur', () => {
    function Host2() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Ouvrir</button>{open && <SelfFocusing onClose={() => setOpen(false)} />}</>;
    }
    render(<Host2 />);
    const opener = screen.getByText('Ouvrir');
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement?.textContent).toBe('Choix');
    fireEvent.click(screen.getByText('Choix'));
    expect(document.activeElement).toBe(opener);
  });
});
