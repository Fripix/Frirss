// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { ArticleRow } from './ArticleList';
import ArticleCard from './ArticleCard';
import { DEFAULT_ROW_ACTIONS } from '../../lib/rowActions';
import { nestedInteractive } from '../../lib/nestedInteractive';
import type { Article } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

afterEach(cleanup);

/*
 * L-26 : une ligne et une carte d'article étaient des `role="button"` qui
 * contenaient de vrais boutons (étoile, à lire plus tard, ✓) et deux liens
 * (« ouvrir à la source », le titre). Un bouton a des enfants présentationnels :
 * un lecteur d'écran n'annonce pas ce qu'il contient, et axe le classe
 * critique (`nested-interactive`). Le conteneur devient un `article`
 * focalisable, nommé par le titre ; ses gestes ne bougent pas.
 */

const base: Article = {
  id: 'a1', title: 'Hello World', summary: 'A short summary', source: 'The Verge',
  content: '<p>body</p>', url: 'https://example.com/1', published: Date.now(),
  read: false, starred: false, labels: [],
} as unknown as Article;

const noop = () => {};

const cases = [
  ['ligne compacte', 'compact'],
  ['ligne normale', 'normal'],
  ['ligne aperçu', 'preview'],
  ['carte de la grille', 'card'],
] as const;

function renderOne(kind: (typeof cases)[number][1], onSelect = noop) {
  const common = {
    article: base, showSource: true, rowActions: DEFAULT_ROW_ACTIONS, active: false,
    onSelect, onToggleStar: noop, onToggleRead: noop, onToggleReadLater: noop, onOpenSource: noop,
  };
  const c = kind === 'card'
    ? render(<ArticleCard {...common} />)
    : render(<ArticleRow {...common} viewMode={kind} />);
  return { ...c, row: c.container.querySelector('[data-article-id="a1"]') as HTMLElement };
}

describe.each(cases)('%s — aucun contrôle imbriqué (L-26)', (_name, kind) => {
  it('aucun bouton ni lien dans un élément à enfants présentationnels', () => {
    const { container } = renderOne(kind);
    expect(nestedInteractive(container)).toEqual([]);
  });

  it("le conteneur reste un arrêt de tabulation, annoncé comme un article nommé par son titre", () => {
    const { getByRole, row } = renderOne(kind);
    expect(getByRole('article', { name: 'Hello World' })).toBe(row);
    expect(row.tabIndex).toBe(0);
  });

  it('clic et Entrée sélectionnent toujours', () => {
    const onSelect = vi.fn();
    const { row } = renderOne(kind, onSelect);
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(2);
  });
});
