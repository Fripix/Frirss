// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react';
import AddFeedDialog from './AddFeedDialog';
import { useFeedStore } from '../../stores/feedStore';
import type { Subscription, Tag } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: { name?: string }) => (o?.name !== undefined ? `${k}:${o.name}` : k) }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const L = (n: string) => `user/-/label/${n}`;
const addFeed = vi.fn(async () => true);
const real = useFeedStore.getState().addFeed;

beforeEach(() => {
  addFeed.mockClear();
  useFeedStore.setState({
    subscriptions: [{ id: 'feed/1', title: 'Le Blog', url: 'https://example.com/feed', categories: [{ id: L('Tech'), label: 'Tech' }] } as Subscription],
    categoryIds: [L('Tech')],
    folderIds: [L('Tech')],
    labels: [{ id: L('Veille'), type: 'tag' } as Tag],
    addFeed: addFeed as never,
  });
});
afterEach(() => { cleanup(); useFeedStore.setState({ addFeed: real }); });

function open() {
  render(<AddFeedDialog onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText(/addFeed.urlLabel/), { target: { value: 'https://example.org/rss' } });
}
function newCategory(name: string) {
  fireEvent.change(screen.getByLabelText('addFeed.categoryLabel'), { target: { value: '__new__' } });
  const field = screen.getByRole('textbox', { name: 'addFeed.newCategory' });
  fireEvent.change(field, { target: { value: name } });
  return field;
}
const addButton = () => screen.getByRole('button', { name: 'addFeed.add' }) as HTMLButtonElement;

// La boîte acceptait « / », renvoyait l'erreur générique sur le nom d'une
// étiquette et créait « tech » à côté de « Tech » (R3T1-3).
describe('AddFeedDialog — nom d’une nouvelle catégorie', () => {
  it('« / » : le motif s’affiche sous le champ et « Ajouter » est grisé', () => {
    open();
    const field = newCategory('Tech/Web');
    expect(screen.getByText('preferences.categories.noSlash')).toBeTruthy();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(field.getAttribute('aria-describedby')!)?.textContent).toBe('preferences.categories.noSlash');
    expect(addButton().disabled).toBe(true);
  });
  it('le nom d’une étiquette, casse comprise : motif dédié, « Ajouter » grisé', () => {
    open();
    newCategory('veille');
    expect(screen.getByText('preferences.labels.nameIsLabel:veille')).toBeTruthy();
    expect(addButton().disabled).toBe(true);
  });
  it('le nom d’une catégorie existante à une casse près : pas de refus, le flux y va sous son nom exact', async () => {
    open();
    const field = newCategory('tech');
    expect(field.getAttribute('aria-invalid')).toBeNull();
    await act(async () => { fireEvent.click(addButton()); });
    expect(addFeed).toHaveBeenCalledWith('https://example.org/rss', '', L('Tech'), 'Tech');
  });
  it('« Nouvelle catégorie » choisie sans nom : « Ajouter » grisé (le flux partait sans catégorie)', () => {
    open();
    newCategory('  ');
    expect(addButton().disabled).toBe(true);
  });
});

// Un abonnement en double ne se disait que par l'erreur générique, après
// l'aller-retour au serveur (idée du troisième round).
describe('AddFeedDialog — flux déjà abonné', () => {
  it('est reconnu sur place, avec le nom de l’abonnement, et « Ajouter » est grisé', () => {
    render(<AddFeedDialog onClose={() => {}} />);
    const url = screen.getByLabelText(/addFeed.urlLabel/);
    fireEvent.change(url, { target: { value: 'http://EXAMPLE.com/feed/' } });
    expect(screen.getByText('addFeed.alreadySubscribed:Le Blog')).toBeTruthy();
    expect(url.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(url.getAttribute('aria-describedby')!)?.textContent).toBe('addFeed.alreadySubscribed:Le Blog');
    expect(addButton().disabled).toBe(true);
    fireEvent.submit(url.closest('form')!);
    expect(addFeed).not.toHaveBeenCalled();
  });
});
