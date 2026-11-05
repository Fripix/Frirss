// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import type { Article } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: { name?: string }) => (o?.name ? `${k}:${o.name}` : k), i18n: { language: 'fr' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => 'desktop' }));

import { LabelMenu } from './ReadingPane';
import { useFeedStore } from '../../stores/feedStore';

afterEach(cleanup);

const article = { id: 'a1', title: 'T', labels: [] } as unknown as Article;
const toggle = vi.fn(async () => {});

beforeEach(() => {
  toggle.mockClear();
  useFeedStore.setState({
    labels: [{ id: 'user/-/label/Veille' }],
    categoryIds: ['user/-/label/Tech'],
    folderIds: ['user/-/label/Sans catégorie'],
    loadLabels: vi.fn(),
    toggleArticleLabel: toggle,
  } as never);
  render(<LabelMenu article={article} />);
  fireEvent.click(screen.getByTitle('readingPane.labels'));
});

// Nouvelle étiquette au nom d'une catégorie : FreshRSS l'ignorait, la case se
// cochait, rien n'était enregistré, sans un mot (L-14).
describe('LabelMenu — nouvelle étiquette au nom d’une catégorie', () => {
  it('dit pourquoi, et n’envoie rien', () => {
    const field = screen.getByPlaceholderText('readingPane.newLabel');
    fireEvent.change(field, { target: { value: 'sans catégorie' } });
    expect(screen.getByText('preferences.labels.nameIsCategory:sans catégorie')).toBeTruthy();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect((screen.getByRole('button', { name: 'app.create' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(field.closest('form')!);
    expect(toggle).not.toHaveBeenCalled();
  });

  it('le nom d’une étiquette existante, autrement capitalisé, pose cette étiquette-là', () => {
    const field = screen.getByPlaceholderText('readingPane.newLabel');
    fireEvent.change(field, { target: { value: 'veille' } });
    fireEvent.submit(field.closest('form')!);
    expect(toggle).toHaveBeenCalledWith(article, 'user/-/label/Veille');
  });
});
