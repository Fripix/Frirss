// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import TopProgressBar from './TopProgressBar';
import { useFeedStore } from '../stores/feedStore';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

beforeEach(() => { useFeedStore.setState({ syncing: false, bulkWork: null }); });
afterEach(cleanup);

const barre = (c: HTMLElement) => c.querySelector('[role="progressbar"]');

/**
 * La barre ne disait qu'une chose : « la relève tourne ». Or un « tout
 * marquer comme lu » et son annulation prennent plusieurs secondes sur un gros
 * flux — le relevé des non-lus, puis les écritures par lots — et rien ne le
 * montrait. Signalé le 2026-09-30 : « j'ai l'impression qu'il ne se passe
 * parfois rien », « je n'ai pas de vision sur les tâches en cours ».
 */
describe('TopProgressBar', () => {
  it('ne montre rien quand rien ne tourne', () => {
    const { container } = render(<TopProgressBar />);
    expect(barre(container)).toBeNull();
  });

  it('montre une barre indéterminée pendant la relève', () => {
    useFeedStore.setState({ syncing: true });
    const { container } = render(<TopProgressBar />);
    expect(barre(container)).toBeTruthy();
    expect(barre(container)!.getAttribute('aria-valuenow')).toBeNull();
  });

  it('montre l’avancement chiffré d’une écriture de masse', () => {
    useFeedStore.setState({ bulkWork: { done: 500, total: 2000 } });
    const { container } = render(<TopProgressBar />);
    const b = barre(container)!;
    expect(b.getAttribute('aria-valuenow')).toBe('500');
    expect(b.getAttribute('aria-valuemax')).toBe('2000');
    expect((b as HTMLElement).style.width).toBe('25%');
  });

  /** Le relevé qui précède l'écriture n'a pas de total connu : on montre
   *  quand même que ça travaille, sans mentir sur l'avancement. */
  it('reste indéterminée quand le total n’est pas connu', () => {
    useFeedStore.setState({ bulkWork: { done: 0, total: null } });
    const { container } = render(<TopProgressBar />);
    expect(barre(container)).toBeTruthy();
    expect(barre(container)!.getAttribute('aria-valuenow')).toBeNull();
  });
});
