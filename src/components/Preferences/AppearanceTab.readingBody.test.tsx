// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { CONFIRM_GRACE_MS } from '../ConfirmDialog';
import AppearanceTab from './AppearanceTab';
import { useUiStore } from '../../stores/uiStore';
import { useThemeStore } from '../../stores/themeStore';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
const bp = { value: 'desktop' as 'desktop' | 'tablet' | 'mobile' };
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => bp.value }));

afterEach(cleanup);

function bodySlider() {
  const view = render(<AppearanceTab onHighlight={() => {}} />);
  fireEvent.click(view.getByText('preferences.appearance.sizes'));
  return { view, slider: view.getByLabelText('preferences.fontKeys.reading-body') as HTMLInputElement };
}

// Le curseur « Corps » s'arrêtait à 12-20 quand A− / A+ allaient de 10 à 24,
// et sur téléphone ou tablette il ne faisait rien : la taille y vient d'un
// réglage propre à l'appareil, que seuls les boutons changeaient.
describe('Préférences › Apparence › Tailles — corps du panneau de lecture', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ mobileReadingFontSize: 17 });
    useThemeStore.getState().setFontSize('reading-body', '14');
  });

  it('sur ordinateur, règle la taille du thème avec les bornes des boutons', () => {
    bp.value = 'desktop';
    const { slider, view } = bodySlider();
    expect([slider.min, slider.max, slider.value]).toEqual(['10', '24', '14']);
    fireEvent.change(slider, { target: { value: '22' } });
    expect(useThemeStore.getState().theme.fontSizes['reading-body']).toBe('22');
    expect(useUiStore.getState().mobileReadingFontSize).toBe(17);
    expect(view.queryByText('preferences.fonts.readingBodyDevice')).toBeNull();
  });

  it.each(['mobile', 'tablet'] as const)('sur %s, règle la taille de cet appareil, et le dit', (value) => {
    bp.value = value;
    const { slider, view } = bodySlider();
    expect([slider.min, slider.max, slider.value]).toEqual(['13', '26', '17']);
    fireEvent.change(slider, { target: { value: '21' } });
    expect(useUiStore.getState().mobileReadingFontSize).toBe(21);
    expect(useThemeStore.getState().theme.fontSizes['reading-body']).toBe('14');
    expect(view.getByText('preferences.fonts.readingBodyDevice')).toBeTruthy();
  });

  it('« Réinitialiser » remet aussi la taille de cet appareil', async () => {
    bp.value = 'mobile';
    useUiStore.setState({ mobileReadingFontSize: 23 });
    const { view } = bodySlider();
    fireEvent.click(view.getByText('preferences.fonts.resetFonts'));
    await act(async () => { await new Promise((r) => setTimeout(r, CONFIRM_GRACE_MS + 30)); });
    fireEvent.click(view.getByRole('button', { name: 'preferences.resetThemeConfirm' }));
    expect(useUiStore.getState().mobileReadingFontSize).toBe(17);
  });
});
