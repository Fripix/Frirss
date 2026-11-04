// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import LabelsTab from './LabelsTab';
import { useFeedStore } from '../../stores/feedStore';
import { useUiStore } from '../../stores/uiStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
afterEach(cleanup);

describe('Préférences › Étiquettes — compteurs de Favoris et d’À lire plus tard', () => {
  beforeEach(() => {
    useFeedStore.setState({ labels: [{ id: 'user/-/label/Veille', type: 'tag' }] } as never);
    useUiStore.setState({ showLabelCounts: true, showSpecialTotals: true, showSpecialUnread: false });
  });

  it('propose deux interrupteurs, total activé et non-lus désactivé par défaut', () => {
    render(<LabelsTab resetLabelColors={() => {}} />);
    expect(screen.getByRole('switch', { name: 'preferences.labels.showSpecialTotals' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('switch', { name: 'preferences.labels.showSpecialUnread' }).getAttribute('aria-checked')).toBe('false');
  });

  it('chacun ne règle que le sien, et celui des étiquettes ne bouge pas', () => {
    render(<LabelsTab resetLabelColors={() => {}} />);
    fireEvent.click(screen.getByRole('switch', { name: 'preferences.labels.showSpecialUnread' }));
    expect(useUiStore.getState()).toMatchObject({ showSpecialUnread: true, showSpecialTotals: true, showLabelCounts: true });
    fireEvent.click(screen.getByRole('switch', { name: 'preferences.labels.showSpecialTotals' }));
    expect(useUiStore.getState()).toMatchObject({ showSpecialUnread: true, showSpecialTotals: false, showLabelCounts: true });
  });
});

describe('Préférences › Étiquettes — sans aucune étiquette', () => {
  it('garde les réglages de Favoris et d’À lire plus tard atteignables', () => {
    useFeedStore.setState({ labels: [] } as never);
    render(<LabelsTab resetLabelColors={() => {}} />);
    expect(screen.getByRole('switch', { name: 'preferences.labels.showSpecialUnread' })).toBeTruthy();
    expect(screen.getByText(/preferences.labels.noLabels/)).toBeTruthy();
  });
});
