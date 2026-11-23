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

describe('Préférences › Apparence › Tailles — vignettes de la liste (issue #34)', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ listThumbWidth: 80 });
  });

  it('un curseur nommé, à 80 px par défaut, dans le groupe Liste d’articles', () => {
    const { getByRole } = openSizes();
    const group = getByRole('group', { name: 'preferences.fontSections.articleList' });
    const slider = getByRole('slider', { name: 'preferences.listThumb.width' });
    expect(group.contains(slider)).toBe(true);
    expect(slider.getAttribute('aria-valuetext')).toBe('80px');
    expect((slider as HTMLInputElement).min).toBe('56');
    expect((slider as HTMLInputElement).max).toBe('160');
  });

  it('dit où la vignette se voit', () => {
    const { getByText } = openSizes();
    expect(getByText('preferences.listThumb.hint')).toBeTruthy();
  });

  it('le curseur règle la taille, que « Réinitialiser » ramène à 80 px', () => {
    const { getByRole } = openSizes();
    fireEvent.change(getByRole('slider', { name: 'preferences.listThumb.width' }), { target: { value: '128' } });
    expect(useUiStore.getState().listThumbWidth).toBe(128);
    useUiStore.getState().resetListThumb();
    expect(useUiStore.getState().listThumbWidth).toBe(80);
  });
});
