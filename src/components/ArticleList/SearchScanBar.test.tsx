// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import SearchScanBar from './SearchScanBar';

// `@testing-library/user-event` n'est pas une dépendance du projet — les
// autres tests de composants de ce dossier (`ArticleContextMenu.test.tsx`,
// `NewArticlesBanner.test.tsx`) simulent déjà les clics avec `fireEvent`,
// synchrone ; on suit la même convention plutôt que d'ajouter une dépendance
// pour un seul fichier.
//
// Même convention pour `react-i18next` (voir `ArticleCard.test.tsx`,
// `NewArticlesBanner.test.tsx`) : `t` renvoie la clé, suffixée de `:count`
// quand un compteur est fourni — suffisant pour retrouver 3000 et 7 dans le
// texte rendu sans dépendre des traductions réelles.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number }) => (o?.count !== undefined ? `${k}:${o.count}` : k),
  }),
}));

const scan = (over = {}) => ({ running: false, scanned: 0, done: false, stopped: false, error: null, ...over });

afterEach(cleanup);

describe('SearchScanBar', () => {
  it('compte ce qui est parcouru et ce qui est trouvé pendant le balayage', () => {
    render(<SearchScanBar scan={scan({ running: true, scanned: 3000 })} results={7} onStop={vi.fn()} onRetry={vi.fn()} />);
    // `@testing-library/jest-dom` n'est pas une dépendance du projet (aucun
    // autre test ne l'utilise) : `getByText` lève déjà si rien ne correspond,
    // donc l'assertion se contente de confirmer un élément trouvé.
    expect(screen.getByText(/3000/)).toBeTruthy();
    expect(screen.getByText(/7/)).toBeTruthy();
  });

  // Le bandeau DISPARAISSAIT au bout du balayage. Il ne restait alors plus
  // rien à l'écran pour dire qu'on regardait des résultats — d'où
  // « la recherche ne se lance pas » : une liste de résultats sans marqueur
  // ressemble à la liste ordinaire, surtout quand elle ramène des articles
  // déjà lus sous une vue « Non lus ».
  it('annonce le nombre de résultats quand le balayage est allé au bout', () => {
    render(<SearchScanBar scan={scan({ done: true, scanned: 10 })} results={2} onStop={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText(/2/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('précise que les articles lus sont compris quand la vue ne montre que les non lus', () => {
    render(<SearchScanBar scan={scan({ done: true, scanned: 10 })} results={2} includesRead onStop={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText(/scanIncludesRead/)).toBeTruthy();
  });

  it('ne le précise pas dans une vue qui montre déjà les articles lus', () => {
    render(<SearchScanBar scan={scan({ done: true, scanned: 10 })} results={2} onStop={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.queryByText(/scanIncludesRead/)).toBeNull();
  });

  it('offre Arrêter pendant, et Réessayer après une panne', () => {
    const onStop = vi.fn();
    const { rerender } = render(<SearchScanBar scan={scan({ running: true, scanned: 10 })} results={0} onStop={onStop} onRetry={vi.fn()} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onStop).toHaveBeenCalled();

    const onRetry = vi.fn();
    rerender(<SearchScanBar scan={scan({ error: 'network', scanned: 10 })} results={0} onStop={vi.fn()} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onRetry).toHaveBeenCalled();
  });
});
