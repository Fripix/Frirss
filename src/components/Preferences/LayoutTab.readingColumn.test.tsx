// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import LayoutTab from './LayoutTab';
import AppearanceTab from './AppearanceTab';
import { useUiStore } from '../../stores/uiStore';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => 'desktop' }));

afterEach(cleanup);

// La colonne de lecture (PR #32) est un réglage de disposition, propre à
// l'appareil : rangée dans Mise en page, avec la disposition (2026-11-24).
describe('Préférences › Mise en page — colonne de lecture (PR #32)', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ limitReadingColumn: false, readingColumnWidth: 768 });
  });

  it('une zone nommée, désactivée par défaut, sans curseur tant que l’interrupteur est éteint', () => {
    const { getByRole, queryByRole, getByText } = render(<LayoutTab />);
    expect(getByRole('region', { name: 'preferences.readingColumn.title' })).toBeTruthy();
    expect(getByText('preferences.readingColumn.limitHint')).toBeTruthy();
    const toggle = getByRole('switch', { name: 'preferences.readingColumn.limit' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(queryByRole('slider', { name: 'preferences.readingColumn.width' })).toBeNull();
  });

  it('l’interrupteur fait paraître le curseur, qui règle la largeur', () => {
    const { getByRole } = render(<LayoutTab />);
    fireEvent.click(getByRole('switch', { name: 'preferences.readingColumn.limit' }));
    expect(useUiStore.getState().limitReadingColumn).toBe(true);
    const slider = getByRole('slider', { name: 'preferences.readingColumn.width' }) as HTMLInputElement;
    expect([slider.min, slider.max, slider.value]).toEqual(['480', '1200', '768']);
    fireEvent.change(slider, { target: { value: '896' } });
    expect(useUiStore.getState().readingColumnWidth).toBe(896);
  });

  it('n’est plus dans Apparence › Tailles, dont la réinitialisation ne la touche plus', () => {
    useUiStore.setState({ limitReadingColumn: true, readingColumnWidth: 600 });
    const view = render(<AppearanceTab onHighlight={() => {}} />);
    fireEvent.click(view.getByText('preferences.appearance.sizes'));
    expect(view.queryByRole('switch', { name: 'preferences.readingColumn.limit' })).toBeNull();
    expect(view.queryByText('preferences.readingColumn.title')).toBeNull();
  });
});
