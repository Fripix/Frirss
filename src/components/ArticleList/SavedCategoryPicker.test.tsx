// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import type { Article } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

import SavedCategoryPicker from './SavedCategoryPicker';

afterEach(cleanup);

const article = { id: 'a1', title: 'T', labels: [] } as unknown as Article;

describe('SavedCategoryPicker — clavier', () => {
  it('se ferme à Échap, sans laisser l\'événement continuer', () => {
    // La garde de `useKeyboardNav` se tait tant que le sélecteur est ouvert :
    // sans son propre Échap, le clavier restait mort jusqu'à un clic.
    const onClose = vi.fn();
    const outside = vi.fn();
    document.addEventListener('keydown', outside);
    render(<SavedCategoryPicker prefix="saved/" article={article} anchor={{ x: 10, y: 10 }} onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    document.removeEventListener('keydown', outside);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(outside).not.toHaveBeenCalled();
  });
});
