// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import NewArticlesPill from './NewArticlesPill';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number }) => (o?.count !== undefined ? `${k}:${o.count}` : k),
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

afterEach(cleanup);

describe('NewArticlesPill', () => {
  it('shows nothing at zero, but keeps its live region mounted', () => {
    const { container } = render(<NewArticlesPill enabled count={0} onClick={() => {}} />);
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  it('shows the count and runs the action on click', () => {
    const onClick = vi.fn();
    render(<NewArticlesPill enabled count={3} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /refresh\.newArticles:3/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps the same button when the count changes, so the entrance does not replay', () => {
    const { rerender } = render(<NewArticlesPill enabled count={3} onClick={() => {}} />);
    const first = screen.getByRole('button');
    rerender(<NewArticlesPill enabled count={5} onClick={() => {}} />);
    expect(screen.getByRole('button')).toBe(first);
    expect(first.textContent).toContain('refresh.newArticles:5');
  });

  // M6 (revue finale) : le réglage éteint doit faire disparaître la pastille
  // ENTIÈREMENT, y compris sa région `aria-live` — sinon un lecteur d'écran
  // continuerait d'entendre un décompte que le réglage a désactivé.
  it('renders nothing at all when disabled, even with a count', () => {
    const { container } = render(<NewArticlesPill enabled={false} count={3} onClick={() => {}} />);
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('[aria-live="polite"]')).toBeNull();
    expect(container.innerHTML).toBe('');
  });
});
