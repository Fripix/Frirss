// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import AppearanceTab from './AppearanceTab';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

afterEach(cleanup);

// À 320 px, « Enregistrer » sortait de sa ligne dans sept langues : le champ
// en `flex-1` gardait sa largeur intrinsèque (`size=20`, ~200 px) faute de
// `min-w-0`, et le bouton, qui rétrécissait, débordait (R3T1-1). La mesure
// se fait contre la feuille construite ; ce test garde les deux conditions.
describe('Préférences › Apparence › Thème — ligne « Enregistrer » à 320 px', () => {
  it('le champ du nom peut rétrécir sous sa largeur intrinsèque, le bouton ne rétrécit ni ne passe à la ligne', () => {
    render(<AppearanceTab onHighlight={() => {}} />);
    const input = screen.getByRole('textbox', { name: 'preferences.themes.themeName' });
    const classes = (el: Element) => el.className.split(/\s+/);
    expect(classes(input)).toEqual(expect.arrayContaining(['flex-1', 'min-w-0']));
    const save = screen.getByRole('button', { name: 'preferences.themes.save' });
    expect(save.parentElement).toBe(input.parentElement);
    expect(classes(save)).toEqual(expect.arrayContaining(['flex-shrink-0', 'whitespace-nowrap']));
  });
});

// Même défaut sur le logo par adresse : « Appliquer » finissait à 345 px en
// français, 365 en ukrainien (campagne 1.10.1, M11).
describe('Préférences › Apparence › Identité — ligne « Appliquer » à 320 px', () => {
  it('le champ de l’adresse du logo peut rétrécir, le bouton garde sa place', () => {
    render(<AppearanceTab onHighlight={() => {}} />);
    const input = screen.getByRole('textbox', { name: 'preferences.branding.logo' });
    const classes = (el: Element) => el.className.split(/\s+/);
    expect(classes(input)).toEqual(expect.arrayContaining(['flex-1', 'min-w-0']));
    const apply = screen.getByRole('button', { name: 'preferences.branding.applyLogoUrl' });
    expect(apply.parentElement).toBe(input.parentElement);
    expect(classes(apply)).toEqual(expect.arrayContaining(['flex-shrink-0', 'whitespace-nowrap']));
  });
});
