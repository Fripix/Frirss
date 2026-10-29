// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import MobileDrawer from './MobileDrawer';

afterEach(cleanup);

// Fermé, le tiroir n'est que poussé hors de l'écran : la tabulation entrait
// dedans et posait le focus sur des boutons invisibles, qu'un lecteur d'écran
// annonçait comme s'ils étaient là.
describe('MobileDrawer', () => {
  it('fermé, il sort de la tabulation et de l’arbre d’accessibilité', () => {
    render(<MobileDrawer open={false} onClose={() => {}}><button>Flux</button></MobileDrawer>);
    const drawer = screen.getByText('Flux').parentElement as HTMLElement;
    expect(drawer.hasAttribute('inert')).toBe(true);
  });

  it('ouvert, il est atteignable', () => {
    render(<MobileDrawer open onClose={() => {}}><button>Flux</button></MobileDrawer>);
    const drawer = screen.getByText('Flux').parentElement as HTMLElement;
    expect(drawer.hasAttribute('inert')).toBe(false);
  });
});

describe('MobileDrawer — Échap et balayage interrompu', () => {
  // Les Préférences s'ouvrent depuis le tiroir sans le fermer : une seule
  // pression d'Échap fermait les deux.
  it('ignore un Échap déjà traité par une surface au-dessus', () => {
    const onClose = vi.fn();
    render(<MobileDrawer open onClose={onClose}><button>Flux</button></MobileDrawer>);
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    ev.preventDefault();
    document.dispatchEvent(ev);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignore Échap tant qu’une boîte modale est ouverte au-dessus', () => {
    const onClose = vi.fn();
    render(<><MobileDrawer open onClose={onClose}><button>Flux</button></MobileDrawer><div role="dialog" aria-modal="true" /></>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  // DOMPurify garde `role` et `aria-*` : un article qui embarque sa boîte de
  // newsletter (`aria-modal`) rendait le tiroir sourd à Échap.
  it('ne compte pas une « boîte » venue du corps d’un article', () => {
    const onClose = vi.fn();
    render(<><MobileDrawer open onClose={onClose}><button>Flux</button></MobileDrawer><div className="article-content"><div role="dialog" aria-modal="true" /></div></>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // iOS reprend le contact (`touchcancel`) : le tiroir restait à moitié tiré,
  // et la tape suivante dedans le refermait.
  it('revient en place après un balayage interrompu, sans se fermer à la tape suivante', () => {
    const onClose = vi.fn();
    render(<MobileDrawer open onClose={onClose}><button>Flux</button></MobileDrawer>);
    const drawer = screen.getByText('Flux').parentElement as HTMLElement;
    const at = (x: number) => ({ touches: [{ clientX: x, clientY: 100 }] });
    fireEvent.touchStart(drawer, at(250));
    for (let i = 1; i <= 10; i++) fireEvent.touchMove(drawer, at(250 - 20 * i));
    fireEvent.touchCancel(drawer, { touches: [] });
    expect(drawer.style.transform).toBe('translateX(0px)');
    fireEvent.touchStart(drawer, at(100));
    fireEvent.touchEnd(drawer, { touches: [] });
    expect(onClose).not.toHaveBeenCalled();
  });
});

