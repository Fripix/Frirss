// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { LabelSection } from './Sidebar';
import { useFeedStore } from '../../stores/feedStore';
import { useUiStore } from '../../stores/uiStore';
import type { Tag } from '../../types';

// `t` rend la clé et le nombre : on vérifie que le badge passe par le pluriel
// i18next et par la BONNE clé (`itemCount`, pas `unreadCount`).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number }) => (o?.count !== undefined ? `${k}:${o.count}` : k),
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

beforeEach(() => {
  useUiStore.setState({ showLabelCounts: true, labelsCollapsed: false });
});
afterEach(cleanup);

describe('compteur d\'une ligne d\'étiquette', () => {
  it('se lit « N articles », jamais « N non lus » : c\'est un total, lus compris', () => {
    // `getStreamItemCount` interroge /stream/items/ids sans filtre `xt` : le
    // chiffre d'une étiquette compte tous ses articles. L'annoncer « non lus »
    // serait faux, et sans libellé il se collait au nom (« Technologie12 »).
    const labels = [
      { id: 'user/-/label/Veille', type: 'tag' },
      { id: 'user/-/label/Tech/Rust', type: 'tag' },
    ] as Tag[];
    useFeedStore.setState({ labelCounts: { 'user/-/label/Veille': 12, 'user/-/label/Tech/Rust': 3 } });
    const c = render(
      <LabelSection labels={labels} selectedFeed={null} selectLabel={() => {}} onArticleDrop={() => {}} />,
    );
    // Le libellé est un texte masqué (`sr-only`), lu par tous les lecteurs
    // d'écran : un `aria-label` sur un simple <span> sans rôle est ignoré par
    // beaucoup d'entre eux, qui ne lisaient que « 12 ». Le chiffre visible est
    // caché aux lecteurs, pour ne pas être lu deux fois.
    const spoken = Array.from(c.container.querySelectorAll('.sr-only')).map((e) => e.textContent);
    expect(spoken).toContain('sidebar.itemCount:12');
    expect(spoken).toContain('sidebar.itemCount:3');
    expect(spoken.some((l) => l?.includes('unreadCount'))).toBe(false);
    const shown = Array.from(c.container.querySelectorAll('[aria-hidden="true"]')).map((e) => e.textContent);
    expect(shown).toContain('12');
    expect(c.container.querySelector('span[aria-label]')).toBeNull();
  });

  // `sr-only` est en position absolue : sans parent positionné, il se place
  // par rapport à la page, échappe au rognage de la barre latérale et allonge
  // le document (2 649 px mesurés pour 747 de haut) — toute l'app pouvait
  // alors défiler et remonter, laissant une bande blanche sous elle.
  it('garde son texte masqué dans un parent positionné, jamais rapporté à la page', () => {
    const labels = [{ id: 'user/-/label/Veille', type: 'tag' }] as Tag[];
    useFeedStore.setState({ labelCounts: { 'user/-/label/Veille': 12 } });
    const c = render(
      <LabelSection labels={labels} selectedFeed={null} selectLabel={() => {}} onArticleDrop={() => {}} />,
    );
    const hidden = Array.from(c.container.querySelectorAll('.sr-only'));
    expect(hidden.length).toBeGreaterThan(0);
    for (const e of hidden) expect(e.parentElement?.className).toMatch(/\brelative\b/);
  });
});
