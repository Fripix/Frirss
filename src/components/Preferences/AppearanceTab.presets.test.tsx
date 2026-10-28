// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import AppearanceTab from './AppearanceTab';
import { SHIPPED_THEMES } from '../../stores/themeStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: { n?: number }) => (o?.n !== undefined ? `${k}:${o.n}` : k) }),
}));

afterEach(cleanup);

describe('Préférences › Apparence › Thème — aide des préréglages', () => {
  // L'aide écrivait « 36 couleurs » en dur dans les dix langues, restée
  // fausse quand le panneau IA en a ajouté deux. Le nombre vient du thème.
  it('annonce le nombre réel de couleurs d’un thème', () => {
    render(<AppearanceTab onHighlight={() => {}} />);
    const n = Object.keys(SHIPPED_THEMES[0].colors).length;
    expect(n).toBe(38);
    expect(screen.getByText(`preferences.themes.presetsHint:${n}`)).toBeTruthy();
  });
});
