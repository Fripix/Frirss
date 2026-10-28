// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import AppearanceTab from './AppearanceTab';
import { useUiStore } from '../../stores/uiStore';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

afterEach(cleanup);

function openSizes() {
  const view = render(<AppearanceTab onHighlight={() => {}} />);
  fireEvent.click(view.getByText('preferences.appearance.sizes'));
  return view;
}

describe('Préférences › Apparence › Tailles — section Grille (#26)', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ gridCardWidth: 240, gridImageRatio: '16:9' });
  });

  it('montre le curseur de largeur et les trois formats, 16:9 coché par défaut', () => {
    const { getByText, getByRole } = openSizes();
    expect(getByText('preferences.fontSections.grid')).toBeTruthy();
    expect(getByText('240px')).toBeTruthy();
    const group = getByRole('radiogroup');
    const radios = group.querySelectorAll('[role="radio"]');
    expect([...radios].map((r) => r.textContent)).toEqual(['16:9', '4:3', '1:1']);
    expect(radios[0].getAttribute('aria-checked')).toBe('true');
  });

  it('le curseur règle la largeur par pas de 20 px', () => {
    const { getByText, container } = openSizes();
    const slider = container.querySelector('input[type="range"][step="20"]') as HTMLInputElement;
    expect(slider.min).toBe('160');
    expect(slider.max).toBe('480');
    fireEvent.change(slider, { target: { value: '360' } });
    expect(useUiStore.getState().gridCardWidth).toBe(360);
    expect(getByText('360px')).toBeTruthy();
  });

  it('un format choisi est coché et enregistré', () => {
    const { getByText } = openSizes();
    fireEvent.click(getByText('1:1'));
    expect(useUiStore.getState().gridImageRatio).toBe('1:1');
    expect(getByText('1:1').getAttribute('aria-checked')).toBe('true');
  });

  it('« Réinitialiser les tailles » remet aussi la grille d’origine', () => {
    useUiStore.setState({ gridCardWidth: 400, gridImageRatio: '4:3' });
    const { getByText } = openSizes();
    const reset = getByText('preferences.fonts.resetFonts');
    fireEvent.click(reset);
    fireEvent.click(getByText('preferences.confirm'));
    expect(useUiStore.getState().gridCardWidth).toBe(240);
    expect(useUiStore.getState().gridImageRatio).toBe('16:9');
  });
});
