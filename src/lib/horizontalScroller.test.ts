// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { scrollsHorizontallyWithin } from './horizontalScroller';

/*
 * M-11 (second round) : le balayage du volet (article précédent / suivant)
 * prenait tout geste horizontal, même né dans un tableau ou un bloc de code
 * qui défile de côté — au doigt, un `<pre>` défilant ne défilait pas.
 */

afterEach(() => { document.body.innerHTML = ''; });

/** Un volet, un bloc défilant de `content` px dans `view` px, une cellule dedans. */
function setup({ content = 600, view = 300, scrollLeft = 0, overflowX = 'auto', dir = 'ltr' } = {}) {
  document.body.innerHTML = `<div id="pane"><div id="scroller" dir="${dir}" style="overflow-x: ${overflowX}; direction: ${dir}"><table><tr><td id="cell">x</td></tr></table></div></div>`;
  const scroller = document.getElementById('scroller')!;
  Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: content });
  Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: view });
  scroller.scrollLeft = scrollLeft;
  return { pane: document.getElementById('pane')!, cell: document.getElementById('cell')!, scroller };
}

describe('scrollsHorizontallyWithin (M-11)', () => {
  it('un tableau qui déborde, au début : le doigt vers la gauche le fait défiler, pas le volet', () => {
    const { pane, cell } = setup();
    expect(scrollsHorizontallyWithin(cell, pane, -40)).toBe(true);
    // Vers la droite : il est déjà au début, le geste revient au volet.
    expect(scrollsHorizontallyWithin(cell, pane, 40)).toBe(false);
  });

  it('arrivé au bout, le geste qui va plus loin revient au volet', () => {
    const { pane, cell } = setup({ scrollLeft: 300 });
    expect(scrollsHorizontallyWithin(cell, pane, -40)).toBe(false);
    expect(scrollsHorizontallyWithin(cell, pane, 40)).toBe(true);
  });

  it('un bloc qui ne déborde pas, ou qui ne défile pas, laisse le geste au volet', () => {
    const fits = setup({ content: 300 });
    expect(scrollsHorizontallyWithin(fits.cell, fits.pane, -40)).toBe(false);
    const hidden = setup({ overflowX: 'hidden' });
    expect(scrollsHorizontallyWithin(hidden.cell, hidden.pane, -40)).toBe(false);
  });

  it('de droite à gauche, le sens s’inverse', () => {
    // scrollLeft négatif en RTL : 0 au début (à droite), −300 au bout.
    const { pane, cell } = setup({ dir: 'rtl' });
    expect(scrollsHorizontallyWithin(cell, pane, 40)).toBe(true);
    expect(scrollsHorizontallyWithin(cell, pane, -40)).toBe(false);
  });

  it('ne regarde pas le volet lui-même ni au-delà', () => {
    const { pane, scroller } = setup();
    expect(scrollsHorizontallyWithin(pane, pane, -40)).toBe(false);
    expect(scrollsHorizontallyWithin(null, pane, -40)).toBe(false);
    // Le bloc défilant lui-même compte.
    expect(scrollsHorizontallyWithin(scroller, pane, -40)).toBe(true);
  });
});
