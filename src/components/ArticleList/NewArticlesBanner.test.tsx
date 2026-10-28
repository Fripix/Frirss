// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import NewArticlesBanner from './NewArticlesBanner';
import { DateSeparator } from './ArticleList';
import { newArticlesOffsetStyle } from '../../lib/newArticles';

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

// Le bandeau et le séparateur de date collent tous deux en haut du même
// conteneur défilant ; le bandeau (z-index 15, opaque) recouvrait donc le
// libellé du jour tant qu'il s'affichait. L'emplacement du bandeau garde sa
// hauteur nulle (choix délibéré) : c'est le séparateur qui descend sous lui,
// d'une hauteur lue dans la même variable CSS que celle du bandeau — 40 px à
// la souris, 44 px au doigt. jsdom ne calcule aucune mise en page : ces tests
// épinglent le câblage, la mesure se fait dans un vrai navigateur.
describe('the date separator sits below the banner while it shows', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'src/styles/index.css'), 'utf8');

  function renderList(count: number) {
    return render(
      <div data-testid="list" style={newArticlesOffsetStyle(count > 0)}>
        <NewArticlesBanner enabled count={count} onClick={() => {}} onDismiss={() => {}} />
        <DateSeparator label="Aujourd’hui" count={4} />
      </div>
    );
  }

  it('the date separator sits below the banner while it shows', () => {
    renderList(3);
    const list = screen.getByTestId('list');
    expect(list.style.getPropertyValue('--new-articles-offset')).toBe('var(--new-articles-banner-height)');
    const sep = screen.getByText('Aujourd’hui').parentElement as HTMLElement;
    expect(sep.className).toContain('sticky');
    expect(sep.className).not.toMatch(/(^|\s)top-0(\s|$)/);
    expect(sep.classList.contains('date-separator')).toBe(true);
    const rule = css.match(/\.date-separator \{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/top:\s*var\(--new-articles-offset, 0px\);/);
    // Sous le bandeau (z-index 15), jamais par-dessus.
    expect(sep.className).toMatch(/(^|\s)z-10(\s|$)/);
  });

  it('the separator returns to the top once the banner is gone', () => {
    renderList(0);
    expect(screen.getByTestId('list').style.getPropertyValue('--new-articles-offset')).toBe('0px');
  });

  it('the banner and the offset read one height, 40 px with a mouse and 44 px with a finger', () => {
    const banner = css.match(/\.new-articles-banner \{([^}]*)\}/)?.[1] ?? '';
    expect(banner).toMatch(/height:\s*var\(--new-articles-banner-height\);/);
    expect(css).toMatch(/:root \{\s*--new-articles-banner-height: 40px;\s*\}/);
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s*:root \{ --new-articles-banner-height: 44px; \}\s*\}/);
    // Plus aucune hauteur en dur ailleurs pour le bandeau.
    expect(css).not.toMatch(/\.new-articles-banner \{ height: 44px; \}/);
  });
});

