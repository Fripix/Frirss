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

const type = (el: HTMLInputElement, value: string) => {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
};

describe('réglages de l’affichage aléatoire', () => {
  it('montre 20 articles et tous les articles par défaut', () => {
    expect(count().value).toBe('20');
    expect(age().value).toBe('');
    expect(age().placeholder).toBe('preferences.general.randomWindowAll');
  });

  it('un nombre libre est retenu en sortant du champ', () => {
    type(count(), '37');
    expect(useUiStore.getState().randomCount).toBe(37);
  });

  // Enregistrer à chaque frappe gardait 50 pour « 501 », étape de la saisie.
  it('une étape de la saisie n’est pas retenue', () => {
    fireEvent.change(count(), { target: { value: '50' } });
    fireEvent.change(count(), { target: { value: '501' } });
    fireEvent.blur(count());
    expect(useUiStore.getState().randomCount).toBe(20);
    expect(count().value).toBe('20');
  });

  it.each(['', '9000', '12.5', '0', '-4'])('« %s » n’est pas un nombre d’articles', (value) => {
    type(count(), value);
    expect(useUiStore.getState().randomCount).toBe(20);
    expect(count().value).toBe('20');
  });

  it('le champ vidé reste vide le temps de la saisie', () => {
    fireEvent.change(count(), { target: { value: '' } });
    expect(count().value).toBe('');
  });

  it('une saisie en cours n’est pas perdue si le panneau se ferme', () => {
    fireEvent.change(count(), { target: { value: '37' } });
    cleanup();
    expect(useUiStore.getState().randomCount).toBe(37);
  });

  it('l’ancienneté se saisit en heures ou en jours, sans effacer le nombre', () => {
    type(age(), '6');
    expect(useUiStore.getState()).toMatchObject({ randomWindowAmount: 6, randomWindowUnit: 'hours' });
    fireEvent.click(screen.getByRole('radio', { name: 'preferences.general.randomDays' }));
    expect(useUiStore.getState()).toMatchObject({ randomWindowAmount: 6, randomWindowUnit: 'days' });
  });

  it.each(['', '0'])('« %s » revient à tous les articles, et garde l’unité', (value) => {
    fireEvent.click(screen.getByRole('radio', { name: 'preferences.general.randomDays' }));
    type(age(), '3');
    type(age(), value);
    expect(useUiStore.getState()).toMatchObject({ randomWindowAmount: 0, randomWindowUnit: 'days' });
  });

  it.each(['-5', '1.5'])('« %s » ne change pas l’ancienneté', (value) => {
    type(age(), '24');
    type(age(), value);
    expect(useUiStore.getState().randomWindowAmount).toBe(24);
    expect(age().value).toBe('24');
  });

  // React compare à `node.value`, déjà vide pour « e » : il n'écrivait rien, et le
  // texte restait affiché alors que le tirage prend tous les articles.
  // Et React n'émet pas `onChange` ici : la valeur était vide, elle le reste.
  it('une saisie illisible s’efface quand rien n’est retenu', () => {
    Object.defineProperty(age(), 'validity', { configurable: true, value: { badInput: true } });
    const write = vi.spyOn(age(), 'value', 'set');
    fireEvent.blur(age());
    expect(write.mock.calls).toEqual([['0'], ['']]);
    expect(useUiStore.getState().randomWindowAmount).toBe(0);
  });

  // `type="number"` rend une valeur vide pour « e » ou « - » : ni une ancienneté,
  // ni un champ vidé, et elle élargissait le tirage à tous les articles sans le dire.
  it('une saisie illisible ne repasse pas à tous les articles', () => {
    type(age(), '24');
    Object.defineProperty(age(), 'validity', { configurable: true, value: { badInput: true } });
    fireEvent.change(age(), { target: { value: '1' } });
    fireEvent.change(age(), { target: { value: '' } });
    fireEvent.blur(age());
    expect(useUiStore.getState().randomWindowAmount).toBe(24);
  });
});
