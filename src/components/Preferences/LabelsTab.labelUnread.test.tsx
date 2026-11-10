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

describe('Préférences › Étiquettes — total et non-lus des étiquettes, indépendants', () => {
  beforeEach(() => {
    useFeedStore.setState({ labels: [{ id: 'user/-/label/Veille', type: 'tag' }], labelUnreadServer: true } as never);
    useUiStore.setState({ showLabelCounts: true, showLabelUnread: false, showSpecialTotals: true, showSpecialUnread: false });
  });

  it('propose le total (allumé) et les non-lus (éteints) par défaut', () => {
    render(<LabelsTab resetLabelColors={() => {}} />);
    expect(screen.getByRole('switch', { name: 'preferences.labels.showCounts' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('switch', { name: 'preferences.labels.showLabelUnread' }).getAttribute('aria-checked')).toBe('false');
  });

  it('demande une mise à jour de FreshRSS quand le serveur ne fournit pas les non-lus des étiquettes', () => {
    useFeedStore.setState({ labelUnreadServer: false } as never);
    render(<LabelsTab resetLabelColors={() => {}} />);
    expect(screen.getByText('preferences.labels.unreadNeedsFreshRss')).toBeTruthy();
  });

  it('ne le demande pas quand le serveur les fournit, ni tant qu’on ne sait pas', () => {
    render(<LabelsTab resetLabelColors={() => {}} />);
    expect(screen.queryByText('preferences.labels.unreadNeedsFreshRss')).toBeNull();
    cleanup();
    useFeedStore.setState({ labelUnreadServer: null } as never);
    render(<LabelsTab resetLabelColors={() => {}} />);
    expect(screen.queryByText('preferences.labels.unreadNeedsFreshRss')).toBeNull();
  });

  it('chacun ne règle que le sien', () => {
    render(<LabelsTab resetLabelColors={() => {}} />);
    fireEvent.click(screen.getByRole('switch', { name: 'preferences.labels.showLabelUnread' }));
    expect(useUiStore.getState()).toMatchObject({ showLabelUnread: true, showLabelCounts: true, showSpecialUnread: false });
    fireEvent.click(screen.getByRole('switch', { name: 'preferences.labels.showCounts' }));
    expect(useUiStore.getState()).toMatchObject({ showLabelUnread: true, showLabelCounts: false });
  });
});
