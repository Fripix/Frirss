// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import NewArticlesBanner from './NewArticlesBanner';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number }) => (o?.count !== undefined ? `${k}:${o.count}` : k),
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

afterEach(cleanup);

describe('NewArticlesBanner', () => {
  it('shows nothing at zero, but keeps its live region mounted', () => {
    const { container } = render(
      <NewArticlesBanner enabled count={0} onClick={() => {}} onDismiss={() => {}} />
    );
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  it('shows the count and runs the action on click', () => {
    const onClick = vi.fn();
    render(<NewArticlesBanner enabled count={3} onClick={onClick} onDismiss={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /refresh\.newArticles:3/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps the same load button when the count changes, so the entrance does not replay', () => {
    const { rerender } = render(
      <NewArticlesBanner enabled count={3} onClick={() => {}} onDismiss={() => {}} />
    );
    const first = screen.getByRole('button', { name: /refresh\.newArticles/ });
    rerender(<NewArticlesBanner enabled count={5} onClick={() => {}} onDismiss={() => {}} />);
    expect(screen.getByRole('button', { name: /refresh\.newArticles/ })).toBe(first);
    expect(first.textContent).toContain('refresh.newArticles:5');
  });

  // M6 (revue finale, hérité de la pastille) : le réglage éteint doit faire
  // disparaître le bandeau ENTIÈREMENT, y compris sa région `aria-live` —
  // sinon un lecteur d'écran continuerait d'entendre un décompte que le
  // réglage a désactivé.
  it('renders nothing at all when disabled, even with a count', () => {
    const { container } = render(
      <NewArticlesBanner enabled={false} count={3} onClick={() => {}} onDismiss={() => {}} />
    );
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('[aria-live="polite"]')).toBeNull();
    expect(container.innerHTML).toBe('');
  });

  // Toute la zone gauche (flèche + libellé) charge les nouveaux articles ;
  // la croix, à droite, ignore le bandeau — deux boutons distincts, deux
  // actions distinctes.
  it('the dismiss button calls onDismiss, not onClick', () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();
    render(<NewArticlesBanner enabled count={3} onClick={onClick} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'refresh.dismissNewArticles' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('the dismiss button has a translated accessible name', () => {
    render(<NewArticlesBanner enabled count={3} onClick={() => {}} onDismiss={() => {}} />);
    expect(screen.getByRole('button', { name: 'refresh.dismissNewArticles' })).toBeTruthy();
  });
});
