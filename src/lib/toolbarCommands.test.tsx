// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { probeToolbarCommands, runToolbarCommand, useToolbarCommands, type ToolbarOffer } from './toolbarCommands';

function Bar({ offers, run }: { offers: ToolbarOffer[]; run: (c: string) => void }) {
  useToolbarCommands(() => offers, run);
  return null;
}

afterEach(cleanup);

describe('bus de commandes des barres', () => {
  const a: ToolbarOffer = { command: 'a', item: 'random', label: 'A' };
  const b: ToolbarOffer = { command: 'b', item: 'star', label: 'B' };

  it('la sonde rassemble les offres de toutes les barres montées', () => {
    render(<><Bar offers={[a]} run={vi.fn()} /><Bar offers={[b]} run={vi.fn()} /></>);
    expect(probeToolbarCommands().map((o) => o.command).sort()).toEqual(['a', 'b']);
  });

  it('une commande va à la barre qui l’offre, et à elle seule', () => {
    const runA = vi.fn();
    const runB = vi.fn();
    render(<><Bar offers={[a]} run={runA} /><Bar offers={[b]} run={runB} /></>);
    runToolbarCommand('b');
    expect(runB).toHaveBeenCalledWith('b');
    expect(runA).not.toHaveBeenCalled();
  });

  it('une commande qui n’est plus offerte ne fait rien (palette restée ouverte sur un état périmé)', () => {
    const run = vi.fn();
    const { rerender } = render(<Bar offers={[a]} run={run} />);
    rerender(<Bar offers={[]} run={run} />);
    runToolbarCommand('a');
    expect(run).not.toHaveBeenCalled();
  });

  it('une barre démontée n’offre plus rien', () => {
    const { unmount } = render(<Bar offers={[a]} run={vi.fn()} />);
    unmount();
    expect(probeToolbarCommands()).toEqual([]);
  });
});
