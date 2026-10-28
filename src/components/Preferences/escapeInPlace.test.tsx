// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import LabelsTab from './LabelsTab';
import CategoryList from './CategoryList';
import { useFeedStore } from '../../stores/feedStore';
import type { Subscription, Tag } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

afterEach(cleanup);

// Le panneau des Préférences se ferme sur tout Échap qui remonte jusqu'à lui.
// Un champ édité en place doit garder Échap pour lui : il annule l'édition,
// il ne ferme pas tout le panneau (la ligne de serveur le faisait déjà).
function inPanel(node: ReactElement) {
  const closePanel = vi.fn();
  render(<div onKeyDown={(e) => { if (e.key === 'Escape') closePanel(); }}>{node}</div>);
  return closePanel;
}

describe('Échap dans un champ édité en place des Préférences', () => {
  beforeEach(() => {
    useFeedStore.setState({
      labels: [{ id: 'user/-/label/Veille', type: 'tag' }] as Tag[],
      subscriptions: [
        { id: 'feed/1', title: 'Un flux', categories: [{ id: 'user/-/label/Tech', label: 'Tech' }] },
      ] as Subscription[],
    });
  });

  it('renommer une étiquette : annule, sans fermer le panneau', () => {
    const closePanel = inPanel(<LabelsTab resetLabelColors={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'preferences.labels.rename' }));
    const field = screen.getByDisplayValue('Veille');
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.queryByDisplayValue('Veille')).toBeNull();
    expect(closePanel).not.toHaveBeenCalled();
  });

  it('renommer une catégorie : annule, sans fermer le panneau', () => {
    const closePanel = inPanel(<CategoryList />);
    fireEvent.click(screen.getByRole('button', { name: 'preferences.categories.rename : Tech' }));
    const field = screen.getByRole('textbox', { name: 'preferences.categories.rename' });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'preferences.categories.rename' })).toBeNull();
    expect(closePanel).not.toHaveBeenCalled();
  });

  it('nouvelle catégorie d’un flux : annule, sans fermer le panneau', () => {
    const closePanel = inPanel(<CategoryList />);
    fireEvent.click(screen.getByText('Tech'));
    fireEvent.change(screen.getByRole('combobox', { name: 'preferences.categories.moveTo : Un flux' }), { target: { value: '__new__' } });
    const field = screen.getByRole('textbox', { name: 'preferences.categories.newName' });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'preferences.categories.newName' })).toBeNull();
    expect(closePanel).not.toHaveBeenCalled();
  });
});
