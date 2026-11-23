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

describe('Préférences › Apparence › Tailles — colonne de lecture (PR #32)', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ limitReadingColumn: false, readingColumnWidth: 768 });
  });

  it('désactivée par défaut, sans curseur tant que l’interrupteur est éteint', () => {
    const { getByRole, queryByRole } = openSizes();
    const toggle = getByRole('switch', { name: 'preferences.readingColumn.limit' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(queryByRole('slider', { name: 'preferences.readingColumn.width' })).toBeNull();
  });

  it('l’interrupteur fait paraître le curseur, qui règle la largeur', () => {
    const { getByRole } = openSizes();
    fireEvent.click(getByRole('switch', { name: 'preferences.readingColumn.limit' }));
    expect(useUiStore.getState().limitReadingColumn).toBe(true);
    const slider = getByRole('slider', { name: 'preferences.readingColumn.width' }) as HTMLInputElement;
    expect([slider.min, slider.max, slider.value]).toEqual(['480', '1200', '768']);
    fireEvent.change(slider, { target: { value: '896' } });
    expect(useUiStore.getState().readingColumnWidth).toBe(896);
  });
});
