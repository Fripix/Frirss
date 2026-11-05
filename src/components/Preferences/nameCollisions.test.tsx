// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import LabelsTab from './LabelsTab';
import CategoryList from './CategoryList';
import { useFeedStore } from '../../stores/feedStore';
import { useThemeStore } from '../../stores/themeStore';
import { useUiStore } from '../../stores/uiStore';
import type { Subscription, Tag } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: { label?: string; value?: string; name?: string }) =>
      k === 'app.labelValue' ? `${o?.label} : ${o?.value}` : o?.name ? `${k}:${o.name}` : k,
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const L = (n: string) => `user/-/label/${n}`;
const renameLabel = vi.fn(async () => true);
const renameCategory = vi.fn(async () => true);
const moveFeedToCategory = vi.fn(async () => true);

beforeEach(() => {
  vi.clearAllMocks();
  useUiStore.setState({ toasts: [], labelSortAlpha: true });
  useThemeStore.setState({ labelColors: {} });
  useFeedStore.setState({
    labels: [{ id: L('Veille'), type: 'tag' }, { id: L('Tuto'), type: 'tag' }, { id: L('Tech/Tuto'), type: 'tag' }] as Tag[],
    subscriptions: [
      { id: 'feed/1', title: 'Un flux', categories: [{ id: L('Tech'), label: 'Tech' }] },
      { id: 'feed/2', title: 'Autre', categories: [{ id: L('Jeux'), label: 'Jeux' }] },
    ] as Subscription[],
    categoryIds: [L('Tech'), L('Jeux')],
    folderIds: [L('Tech'), L('Jeux'), L('Sans catégorie')],
    renameLabel, renameCategory, moveFeedToCategory,
  } as never);
});
afterEach(cleanup);

describe('Préférences › Étiquettes — nom déjà pris (L-14)', () => {
  it('renommer vers le nom d’une catégorie : le motif s’affiche, rien ne part', () => {
    render(<LabelsTab resetLabelColors={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'preferences.labels.rename : Veille' }));
    const field = screen.getByDisplayValue('Veille');
    fireEvent.change(field, { target: { value: 'Sans catégorie' } });
    expect(screen.getByText('preferences.labels.nameIsCategory:Sans catégorie')).toBeTruthy();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    fireEvent.submit(field.closest('form')!);
    expect(renameLabel).not.toHaveBeenCalled();
    // Le champ reste ouvert pour corriger.
    expect(screen.getByDisplayValue('Sans catégorie')).toBeTruthy();
  });

  it('renommer vers une autre étiquette : refusé avec son motif', () => {
    render(<LabelsTab resetLabelColors={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'preferences.labels.rename : Veille' }));
    const field = screen.getByDisplayValue('Veille');
    fireEvent.change(field, { target: { value: 'tuto' } });
    expect(screen.getByText('preferences.labels.nameIsLabel:tuto')).toBeTruthy();
    fireEvent.submit(field.closest('form')!);
    expect(renameLabel).not.toHaveBeenCalled();
  });

  it('sortir « Tech/Tuto » de son groupe alors que « Tuto » existe : message, rien ne part, la couleur ne bouge pas', () => {
    const renameLabelColor = vi.fn();
    useThemeStore.setState({ renameLabelColor } as never);
    render(<LabelsTab resetLabelColors={() => {}} />);
    // Deux lignes « Tuto » : la dernière est l'enfant de Tech (les groupes
    // viennent après les étiquettes simples).
    const moves = screen.getAllByRole('button', { name: 'preferences.labels.moveTooltip : Tuto' });
    fireEvent.click(moves[moves.length - 1]);
    fireEvent.change(screen.getByRole('combobox', { name: 'preferences.labels.moveTo' }), { target: { value: '' } });
    expect(renameLabel).not.toHaveBeenCalled();
    expect(renameLabelColor).not.toHaveBeenCalled();
    expect(useUiStore.getState().toasts.map((t) => t.message)).toContain('preferences.labels.nameIsLabel:Tuto');
  });
});

describe('Préférences › Flux › Catégories — nom refusé, et pourquoi (L-14, T2-6)', () => {
  const startRename = () => {
    fireEvent.click(screen.getByRole('button', { name: 'preferences.categories.rename : Tech' }));
    return screen.getByRole('textbox', { name: 'preferences.categories.rename' });
  };

  it('renommer vers le nom d’une étiquette : motif affiché, Enregistrer grisé, Entrée sans effet', () => {
    render(<CategoryList />);
    const field = startRename();
    fireEvent.change(field, { target: { value: 'veille' } });
    expect(screen.getByText('preferences.labels.nameIsLabel:veille')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'preferences.categories.save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(renameCategory).not.toHaveBeenCalled();
  });

  it('renommer vers une autre catégorie, même vide : motif affiché, rien ne part', () => {
    render(<CategoryList />);
    const field = startRename();
    fireEvent.change(field, { target: { value: 'Sans catégorie' } });
    expect(screen.getByText('preferences.labels.nameIsCategory:Sans catégorie')).toBeTruthy();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(renameCategory).not.toHaveBeenCalled();
  });

  it('une barre oblique : le bouton grisé dit pourquoi', () => {
    render(<CategoryList />);
    const field = startRename();
    fireEvent.change(field, { target: { value: 'Tech/IA' } });
    expect(screen.getByText('preferences.categories.noSlash')).toBeTruthy();
    expect(field.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(field.getAttribute('aria-describedby')!)?.textContent).toBe('preferences.categories.noSlash');
  });

  it('nouvelle catégorie au nom d’une étiquette : refusée avec son motif', () => {
    render(<CategoryList />);
    fireEvent.click(screen.getByText('Tech'));
    fireEvent.change(screen.getByRole('combobox', { name: 'preferences.categories.moveTo : Un flux' }), { target: { value: '__new__' } });
    const field = screen.getByRole('textbox', { name: 'preferences.categories.newName' });
    fireEvent.change(field, { target: { value: 'Veille' } });
    expect(screen.getByText('preferences.labels.nameIsLabel:Veille')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'preferences.categories.move' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(moveFeedToCategory).not.toHaveBeenCalled();
  });

  it('nouvelle catégorie au nom d’une catégorie existante, autrement capitalisé : déplacé dans celle-ci', () => {
    render(<CategoryList />);
    fireEvent.click(screen.getByText('Tech'));
    fireEvent.change(screen.getByRole('combobox', { name: 'preferences.categories.moveTo : Un flux' }), { target: { value: '__new__' } });
    const field = screen.getByRole('textbox', { name: 'preferences.categories.newName' });
    fireEvent.change(field, { target: { value: 'jeux' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(moveFeedToCategory).toHaveBeenCalledWith('feed/1', 'Jeux');
  });
});
