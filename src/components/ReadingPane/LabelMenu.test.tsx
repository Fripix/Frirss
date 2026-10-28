// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import type { Article } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'fr' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => 'desktop' }));

import { LabelMenu } from './ReadingPane';
import { useFeedStore } from '../../stores/feedStore';

afterEach(cleanup);

const article = { id: 'a1', title: 'T', labels: [] } as unknown as Article;

// La liste d'étiquettes est une surface flottante : elle coupe les raccourcis
// (`data-floating-surface`), donc Échap doit pouvoir la fermer — avant, rien
// ne l'écoutait, et Échap quittait seulement le mode lecture derrière elle.
describe("LabelMenu — liste d'étiquettes sur bureau", () => {
  it('se ferme à Échap', () => {
    useFeedStore.setState({ labels: [], loadLabels: vi.fn() } as never);
    render(<LabelMenu article={article} />);
    fireEvent.click(screen.getByTitle('readingPane.labels'));
    expect(document.querySelector('[data-floating-surface]')).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('[data-floating-surface]')).toBeNull();
  });
});
