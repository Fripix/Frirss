// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { useRef } from 'react';
import { render } from '@testing-library/react';
import { useToolbarFold } from './useToolbarFold';

// jsdom ne mesure rien : on simule la barre en dictant `scrollWidth` selon
// l'étage de repli déjà posé sur l'élément (comme le ferait le CSS).
function Bar({ widths, deps = [] }: { widths: Record<string, number>; deps?: unknown[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const setRef = (el: HTMLDivElement | null) => {
    (ref as { current: HTMLDivElement | null }).current = el;
    if (el && !Object.getOwnPropertyDescriptor(el, 'scrollWidth')) {
      Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => 500 });
      Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => widths[el.dataset.fold ?? '0'] ?? 0 });
    }
  };
  useToolbarFold(ref, deps);
  return <div ref={setRef} data-testid="bar" />;
}

describe('useToolbarFold', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('laisse data-fold à 0 quand tout tient', () => {
    const { getByTestId } = render(<Bar widths={{ '0': 480 }} />);
    expect(getByTestId('bar').dataset.fold).toBe('0');
  });
  it('replie les libellés secondaires (1) quand cela suffit', () => {
    const { getByTestId } = render(<Bar widths={{ '0': 700, '1': 480 }} />);
    expect(getByTestId('bar').dataset.fold).toBe('1');
  });
  it('replie tous les libellés (2) quand le premier palier ne suffit pas', () => {
    const { getByTestId } = render(<Bar widths={{ '0': 900, '1': 700, '2': 400 }} />);
    expect(getByTestId('bar').dataset.fold).toBe('2');
  });
  it('mesure de nouveau quand les dépendances changent, en repartant de 0', () => {
    const widths: Record<string, number> = { '0': 900, '1': 700, '2': 400 };
    const { getByTestId, rerender } = render(<Bar widths={widths} deps={['a']} />);
    expect(getByTestId('bar').dataset.fold).toBe('2');
    widths['0'] = 450;
    rerender(<Bar widths={widths} deps={['b']} />);
    expect(getByTestId('bar').dataset.fold).toBe('0');
  });
  it('ne plante pas sans ResizeObserver (jsdom)', () => {
    expect(typeof ResizeObserver).toBe('undefined');
    expect(() => render(<Bar widths={{ '0': 100 }} />)).not.toThrow();
  });
  it('ne plante pas quand la ref est vide', () => {
    function Empty() {
      const ref = useRef<HTMLElement>(null);
      useToolbarFold(ref, []);
      return null;
    }
    expect(() => render(<Empty />)).not.toThrow();
  });
});
