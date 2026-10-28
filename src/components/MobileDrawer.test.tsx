// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
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
