// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import RoutingKey from './RoutingKey';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

afterEach(cleanup);

// En allemand à 320 px, « Zusammenfassungsfeld », insécable, élargissait la
// colonne des noms (`w-28`) au-delà du cadre (`overflow-hidden`) : 53 px de
// légende coupés, 5 px en néerlandais (R3T1-2). Un nom de colonne se coupe
// désormais : par césure dans la langue du document, sinon n'importe où.
describe('Préférences › IA › clé de la matrice — noms de colonnes à 320 px', () => {
  it('un nom de colonne long se coupe au lieu d’élargir le tableau hors du cadre', () => {
    render(<RoutingKey id="k" />);
    const names = Array.from(document.querySelectorAll('[data-routing-key] th > span'));
    expect(names).toHaveLength(5);
    for (const name of names) {
      const classes = name.className.split(/\s+/);
      expect(classes).toEqual(expect.arrayContaining(['hyphens-auto', '[overflow-wrap:anywhere]']));
    }
  });
});
