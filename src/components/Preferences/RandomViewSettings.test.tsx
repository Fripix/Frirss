// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import RandomViewSettings from './RandomViewSettings';
import { useUiStore } from '../../stores/uiStore';

const count = () => screen.getByLabelText('preferences.general.randomCount') as HTMLInputElement;
const age = () => screen.getByLabelText('preferences.general.randomWindow') as HTMLInputElement;

beforeEach(() => {
  localStorage.clear();
  useUiStore.setState({ randomCount: 20, randomWindowAmount: 0, randomWindowUnit: 'hours' });
  render(<RandomViewSettings />);
});
afterEach(cleanup);

describe('réglages de l’affichage aléatoire', () => {
  it('montre 20 articles et tous les articles par défaut', () => {
    expect(count().value).toBe('20');
    expect(age().value).toBe('');
    expect(age().placeholder).toBe('preferences.general.randomWindowAll');
  });

  it('un nombre libre est retenu', () => {
    fireEvent.change(count(), { target: { value: '37' } });
    expect(useUiStore.getState().randomCount).toBe(37);
  });

  // Vider le champ pour retaper une valeur ne doit pas la remplacer sous les doigts.
  it('le champ vidé reste vide le temps de la saisie, puis revient à la valeur retenue', () => {
    fireEvent.change(count(), { target: { value: '37' } });
    fireEvent.change(count(), { target: { value: '' } });
    expect(count().value).toBe('');
    fireEvent.blur(count());
    expect(count().value).toBe('37');
  });

  it('un nombre hors bornes n’est pas retenu', () => {
    fireEvent.change(count(), { target: { value: '9000' } });
    expect(useUiStore.getState().randomCount).toBe(20);
    fireEvent.blur(count());
    expect(count().value).toBe('20');
  });

  it('l’ancienneté se saisit en heures ou en jours, sans effacer le nombre', () => {
    fireEvent.change(age(), { target: { value: '6' } });
    expect(useUiStore.getState()).toMatchObject({ randomWindowAmount: 6, randomWindowUnit: 'hours' });
    fireEvent.click(screen.getByRole('radio', { name: 'preferences.general.randomDays' }));
    expect(useUiStore.getState()).toMatchObject({ randomWindowAmount: 6, randomWindowUnit: 'days' });
  });

  it('vider l’ancienneté revient à tous les articles, et garde l’unité', () => {
    fireEvent.click(screen.getByRole('radio', { name: 'preferences.general.randomDays' }));
    fireEvent.change(age(), { target: { value: '3' } });
    fireEvent.change(age(), { target: { value: '' } });
    expect(useUiStore.getState()).toMatchObject({ randomWindowAmount: 0, randomWindowUnit: 'days' });
  });
});
