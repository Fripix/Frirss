// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { FeedItem } from './Sidebar';
import { LONG_PRESS_MS } from '../../hooks/useLongPress';
import type { Subscription } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

// La ligne lit deux choses dans le magasin : les erreurs de flux et le
// résultat de la dernière relève. Ni l'une ni l'autre ne concerne le geste.
vi.mock('../../stores/feedStore', () => ({
  useFeedStore: Object.assign(
    (sel: (s: unknown) => unknown) => sel({ feedErrors: {}, refreshResult: null }),
    { getState: () => ({ prefetchView: () => {} }) },
  ),
}));

const feed = { id: 'feed/1', title: 'The Register' } as Subscription;
const noop = () => {};

function renderRow(over: {
  organizeMode?: boolean;
  onSelect?: () => void;
  onOpenMenu?: (r: DOMRect) => void;
  onContextMenu?: (e: unknown) => void;
} = {}) {
  return render(
    <FeedItem
      feed={feed}
      isSelected={false}
      unreadCount={3}
      showFavicons={false}
      organizeMode={over.organizeMode ?? false}
      onSelect={over.onSelect ?? noop}
      onContextMenu={over.onContextMenu ?? noop}
      onOpenMenu={over.onOpenMenu ?? noop}
      onDragStart={noop}
      onDragOver={noop}
      onDrop={noop}
    />,
  );
}

const row = (c: ReturnType<typeof render>) => c.getByRole('button', { name: /The Register/ });

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); cleanup(); });

describe("appui long sur une ligne de flux", () => {
  it('ouvre le menu après le délai', () => {
    // Sur mobile et tablette, les quatre actions d'un flux — renommer, ouvrir
    // le site, extraction automatique, se désabonner — n'avaient AUCUN chemin :
    // le ⋯ ne paraît qu'au survol, et le clic droit n'existe pas au doigt.
    const onOpenMenu = vi.fn();
    const c = renderRow({ onOpenMenu });
    fireEvent.touchStart(row(c));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onOpenMenu).toHaveBeenCalledTimes(1);
  });

  it("n'ouvre rien avant le délai", () => {
    const onOpenMenu = vi.fn();
    const c = renderRow({ onOpenMenu });
    fireEvent.touchStart(row(c));
    vi.advanceTimersByTime(LONG_PRESS_MS - 50);
    expect(onOpenMenu).not.toHaveBeenCalled();
  });

  it('annule dès que le doigt dépasse la tolérance — sinon un défilement ouvrirait le menu', () => {
    const onOpenMenu = vi.fn();
    const c = renderRow({ onOpenMenu });
    fireEvent.touchStart(row(c), { touches: [{ clientX: 10, clientY: 10 }] });
    fireEvent.touchMove(row(c), { touches: [{ clientX: 10, clientY: 22 }] });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onOpenMenu).not.toHaveBeenCalled();
  });

  it('tolère un tremblement de quelques pixels', () => {
    const onOpenMenu = vi.fn();
    const c = renderRow({ onOpenMenu });
    fireEvent.touchStart(row(c), { touches: [{ clientX: 10, clientY: 10 }] });
    fireEvent.touchMove(row(c), { touches: [{ clientX: 13, clientY: 14 }] });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onOpenMenu).toHaveBeenCalledTimes(1);
  });

  it('annule sur touchcancel et sur un second doigt', () => {
    const onOpenMenu = vi.fn();
    const c = renderRow({ onOpenMenu });
    fireEvent.touchStart(row(c), { touches: [{ clientX: 10, clientY: 10 }] });
    fireEvent.touchCancel(row(c));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    fireEvent.touchStart(row(c), { touches: [{ clientX: 10, clientY: 10 }] });
    fireEvent.touchStart(row(c), { touches: [{ clientX: 10, clientY: 10 }, { clientX: 60, clientY: 10 }] });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onOpenMenu).not.toHaveBeenCalled();
  });

  it("absorbe le contextmenu d'écho de Chrome Android : le menu ne s'ouvre ni deux fois ni ailleurs", () => {
    // Chrome Android émet `contextmenu` sur l'appui long qui vient d'ouvrir le
    // menu ; transmis au gestionnaire du clic droit, il rouvrait le menu au
    // point du doigt — un menu qui saute sous le doigt.
    const onOpenMenu = vi.fn();
    const onContextMenu = vi.fn();
    const c = renderRow({ onOpenMenu, onContextMenu });
    fireEvent.touchStart(row(c), { touches: [{ clientX: 10, clientY: 10 }] });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    const notPrevented = fireEvent.contextMenu(row(c), { clientX: 11, clientY: 11 });
    expect(onOpenMenu).toHaveBeenCalledTimes(1);
    expect(onContextMenu).not.toHaveBeenCalled();
    expect(notPrevented).toBe(false);
  });

  it('laisse passer un vrai clic droit', () => {
    const onContextMenu = vi.fn();
    const c = renderRow({ onContextMenu });
    fireEvent.contextMenu(row(c), { clientX: 40, clientY: 50 });
    expect(onContextMenu).toHaveBeenCalledTimes(1);
  });

  it('annule si le doigt se lève avant le délai', () => {
    const onOpenMenu = vi.fn();
    const c = renderRow({ onOpenMenu });
    fireEvent.touchStart(row(c));
    vi.advanceTimersByTime(LONG_PRESS_MS - 50);
    fireEvent.touchEnd(row(c));
    vi.advanceTimersByTime(200);
    expect(onOpenMenu).not.toHaveBeenCalled();
  });

  it("ne sélectionne PAS le flux au relâchement d'un appui long", () => {
    // Sans cette garde, le menu s'ouvrirait ET le flux se chargerait derrière.
    const onSelect = vi.fn();
    const c = renderRow({ onSelect });
    fireEvent.touchStart(row(c));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    fireEvent.touchEnd(row(c));
    fireEvent.click(row(c));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('laisse un appui bref sélectionner le flux', () => {
    const onSelect = vi.fn();
    const c = renderRow({ onSelect });
    fireEvent.touchStart(row(c));
    fireEvent.touchEnd(row(c));
    fireEvent.click(row(c));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("ne fait rien en mode organisation, où la ligne se glisse", () => {
    const onOpenMenu = vi.fn();
    const c = renderRow({ organizeMode: true, onOpenMenu });
    fireEvent.touchStart(row(c));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onOpenMenu).not.toHaveBeenCalled();
  });
});
