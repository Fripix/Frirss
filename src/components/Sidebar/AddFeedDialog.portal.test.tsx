// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import AddFeedDialog from './AddFeedDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

afterEach(cleanup);

describe('AddFeedDialog — une boîte hors du tiroir', () => {
  // Ouverte depuis la barre latérale, donc dans le tiroir mobile (`fixed`,
  // transformé, `overflow: hidden`) : rendue sur place, son fond « plein
  // écran » s'ancrait au tiroir et la boîte y était rognée.
  it('est rendue sous <body>, pas dans le composant qui l’ouvre', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(<AddFeedDialog onClose={() => {}} />, { container: host });
    const dialog = screen.getByRole('dialog');
    expect(host.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
    host.remove();
  });
});
