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

  // ⌘K → « Préférences » : la palette se ferme et les Préférences s'ouvrent
  // depuis son champ, qui disparaît avec elle. Fermer les Préférences laissait
  // le focus sur <body> au lieu du bouton qui avait ouvert la palette.
  it('remonte à l’élément qui avait ouvert la surface précédente', async () => {
    function Pal({ open, onRun }: { open: boolean; onRun: () => void }) {
      useReturnFocus(open);
      const ref = useRef<HTMLInputElement>(null);
      useEffect(() => { if (open) ref.current?.focus(); }, [open]);
      return open ? <><input ref={ref} aria-label="palette" /><button onClick={onRun}>lancer</button></> : null;
    }
    function H() {
      const [pal, setPal] = useState(false);
      const [pref, setPref] = useState(false);
      return (
        <>
          <button onClick={() => setPal(true)}>A</button>
          <button onClick={() => setPref(false)}>fermerPrefs</button>
          <Pal open={pal} onRun={() => { setPal(false); setPref(true); }} />
          {pref && <Surface open />}
        </>
      );
    }
    const c = render(<H />);
    const a = c.getByText('A');
    a.focus();
    act(() => { a.click(); });
    const run = c.getByText('lancer');
    run.focus();
    act(() => { run.click(); });
    await tick();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('dedans');
    act(() => { c.getByText('fermerPrefs').click(); });
    await tick();
    expect(document.activeElement).toBe(a);
  });

  // Une ligne de la feuille A ouvre la feuille B (qui ne prend pas le focus) :
  // A rendait le focus à son déclencheur pendant que B était ouverte.
  it('ne rend pas le focus tant qu’une surface ouverte après elle est là', async () => {
    function Sheet({ open, children }: { open: boolean; children?: React.ReactNode }) {
      useReturnFocus(open);
      return open ? <div>{children}</div> : null;
    }
    function H() {
      const [a, setA] = useState(false);
      const [b, setB] = useState(false);
      return (
        <>
          <button onClick={() => setA(true)}>ouvrirA</button>
          <Sheet open={a}><button onClick={() => { setA(false); setB(true); }}>ligne</button></Sheet>
          <Sheet open={b}><button onClick={() => setB(false)}>fermerB</button></Sheet>
        </>
      );
    }
    const c = render(<H />);
    const opener = c.getByText('ouvrirA');
    opener.focus();
    act(() => { opener.click(); });
    const row = c.getByText('ligne');
    row.focus();
    act(() => { row.click(); });
    await tick();
    expect(document.activeElement).not.toBe(opener);
    act(() => { c.getByText('fermerB').click(); });
    await tick();
    expect(document.activeElement).toBe(opener);
  });
});

function Surf({ open, label, children }: { open: boolean; label: string; children?: React.ReactNode }) {
  useReturnFocus(open);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  return open ? <div><input ref={ref} aria-label={label} />{children}</div> : null;
}

// ⌘K → « Raccourcis » → « Configurer » : trois surfaces, et les deux
// premiers déclencheurs disparaissent. Le repli ne remontait que d'un niveau.
// Et une feuille ouverte DANS les Préférences, dont le déclencheur a disparu,
// renvoyait le focus au bouton qui avait ouvert les Préférences — derrière
// elles, toujours ouvertes.
describe('useReturnFocus — chaînes de surfaces', () => {
  it('remonte sur plusieurs niveaux : palette → aide → Préférences', async () => {
    function H() {
      const [pal, setPal] = useState(false);
      const [help, setHelp] = useState(false);
      const [pref, setPref] = useState(false);
      return (
        <>
          <button onClick={() => setPal(true)}>A</button>
          <button onClick={() => setPref(false)}>fermerPrefs</button>
          <Surf open={pal} label="palette"><button onClick={() => { setPal(false); setHelp(true); }}>aide</button></Surf>
          <Surf open={help} label="help"><button onClick={() => { setHelp(false); setPref(true); }}>config</button></Surf>
          {pref && <Surf open label="prefs" />}
        </>
      );
    }
    const c = render(<H />);
    const a = c.getByText('A'); a.focus();
    act(() => { a.click(); });
    const b1 = c.getByText('aide'); b1.focus(); act(() => { b1.click(); });
    await tick();
    const b2 = c.getByText('config'); b2.focus(); act(() => { b2.click(); });
    await tick();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('prefs');
    // fermer les Préférences sans passer par le bouton (le bouton prendrait le focus) :
    act(() => { (document.activeElement as HTMLElement).blur(); });
    act(() => { c.getByText('fermerPrefs').click(); (document.activeElement as HTMLElement)?.blur?.(); });
    await tick();
    expect(document.activeElement).toBe(a);
  });

  it('ne prend pas pour repli le déclencheur d’une surface encore ouverte', async () => {
    function H() {
      const [prefs, setPrefs] = useState(false);
      const [sheet, setSheet] = useState(false);
      const [gone, setGone] = useState(false);
      return (
        <>
          <button onClick={() => setPrefs(true)}>engrenage</button>
          <Surf open={prefs} label="prefs">
            {!gone && <button onClick={() => setSheet(true)}>trois-points</button>}
          </Surf>
          {/* La ligne de la feuille retire son propre déclencheur (ligne supprimée). */}
          <Surf open={sheet} label="sheet"><button onClick={() => { setSheet(false); setGone(true); }}>supprimer</button></Surf>
        </>
      );
    }
    const c = render(<H />);
    const gear = c.getByText('engrenage'); gear.focus();
    act(() => { gear.click(); });
    const dots = c.getByText('trois-points'); dots.focus();
    act(() => { dots.click(); });
    const del = c.getByText('supprimer');
    act(() => { del.click(); (document.activeElement as HTMLElement)?.blur?.(); });
    await tick();
    expect(document.activeElement).not.toBe(gear);
  });
});
