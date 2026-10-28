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
    useUiStore.setState({ gridCardWidth: 240, gridImageRatio: '16:9', gridCardFill: true });
  });

  it('« Remplir la ligne » est activé par défaut et se désactive', () => {
    const { getByRole, getByText } = openSizes();
    expect(getByText('preferences.gridCards.fillHint')).toBeTruthy();
    const toggle = getByRole('switch', { name: 'preferences.gridCards.fill' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    expect(useUiStore.getState().gridCardFill).toBe(false);
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

  it('le curseur règle la largeur au pixel près', () => {
    const { getByText, container } = openSizes();
    const slider = container.querySelector('input[type="range"][min="160"]') as HTMLInputElement;
    expect(slider.max).toBe('480');
    expect(slider.step).toBe('1');
    fireEvent.change(slider, { target: { value: '357' } });
    expect(useUiStore.getState().gridCardWidth).toBe(357);
    expect(getByText('357px')).toBeTruthy();
  });

  it('un format choisi est coché et enregistré', () => {
    const { getByText } = openSizes();
    fireEvent.click(getByText('1:1'));
    expect(useUiStore.getState().gridImageRatio).toBe('1:1');
    expect(getByText('1:1').getAttribute('aria-checked')).toBe('true');
  });

  it('« Réinitialiser les tailles » remet aussi la grille d’origine', () => {
    useUiStore.setState({ gridCardWidth: 400, gridImageRatio: '4:3', gridCardFill: false });
    const { getByText } = openSizes();
    const reset = getByText('preferences.fonts.resetFonts');
    fireEvent.click(reset);
    fireEvent.click(getByText('preferences.confirm'));
    expect(useUiStore.getState().gridCardWidth).toBe(240);
    expect(useUiStore.getState().gridImageRatio).toBe('16:9');
    expect(useUiStore.getState().gridCardFill).toBe(true);
  });
});
