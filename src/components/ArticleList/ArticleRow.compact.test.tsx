// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { ArticleRow } from './ArticleList';
import { DEFAULT_ROW_ACTIONS } from '../../lib/rowActions';
import type { Article } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

afterEach(cleanup);

const base: Article = {
  id: 'a1', title: 'Hello World', summary: 'A short summary', source: 'The Verge',
  content: '<p>body</p>', url: 'https://example.com/1', published: Date.now(),
  read: false, starred: false, labels: [],
} as unknown as Article;

const noop = () => {};

function renderCompact(over: Partial<Article> = {}, opts: {
  rowActions?: typeof DEFAULT_ROW_ACTIONS;
  onSelect?: () => void;
  onOpenSource?: (e: { stopPropagation: () => void }) => void;
} = {}) {
  return render(
    <ArticleRow
      article={{ ...base, ...over }}
      viewMode="compact"
      showSource
      rowActions={opts.rowActions ?? DEFAULT_ROW_ACTIONS}
      active={false}
      onSelect={opts.onSelect ?? noop}
      onToggleStar={noop}
      onToggleRead={noop}
      onToggleReadLater={noop}
      onOpenSource={opts.onOpenSource ?? noop}
    />
  );
}

/**
 * La barre d'actions est le DERNIER enfant de la ligne compacte, après le
 * titre et l'heure. Elle n'a pas de classe propre, contrairement à la carte de
 * la vue grille (`.article-card__actions`) : on la retrouve par sa position.
 */
function actionsOf(container: HTMLElement) {
  const row = container.querySelector('[data-article-id]');
  return row?.lastElementChild ?? null;
}

/**
 * Le `title` de la commande portée par un emplacement, ou `null` s'il est
 * vide. Une commande est un bouton, sauf « ouvrir à la source » qui est un
 * lien (issue #21).
 */
function kindOf(el: Element | null | undefined) {
  const control = el?.matches('button, a') ? el : el?.querySelector('button, a');
  return control?.getAttribute('title')?.split(' — ')[0] ?? null;
}

describe('ArticleRow — mode compact', () => {
  it('affiche les quatre actions, dans l’ordre étoile → à lire plus tard → ouvrir à la source → ✓', () => {
    const { container } = renderCompact();
    const actions = actionsOf(container);
    expect(actions?.children.length).toBe(4);
    expect(Array.from(actions?.children ?? []).map(kindOf)).toEqual([
      'articleRow.addStar', 'articleRow.addReadLater', 'articleRow.openSource', 'articleRow.markRead',
    ]);
  });

  it('réserve un emplacement vide en 3ᵉ position quand l’article n’a pas d’URL', () => {
    const { container } = renderCompact({ url: '' });
    const actions = actionsOf(container);
    // Toujours quatre emplacements : sans quoi le ✓ ne serait pas à la même
    // abscisse d'une ligne à l'autre, et on ne pourrait plus enchaîner les
    // clics de marquage sans bouger la souris (issue #10).
    expect(actions?.children.length).toBe(4);
    const third = actions?.children[2];
    expect(third?.querySelector('button')).toBeNull();
    expect(third?.getAttribute('aria-hidden')).toBe('true');
    expect(kindOf(actions?.children[3])).toBe('articleRow.markRead');
  });

  it('masquer une icône par réglage RETIRE son emplacement, sans le réserver', () => {
    const { container } = renderCompact({}, {
      rowActions: { ...DEFAULT_ROW_ACTIONS, openSource: false },
    });
    const actions = actionsOf(container);
    expect(actions?.children.length).toBe(3);
    expect(actions?.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(Array.from(actions?.children ?? []).map(kindOf)).toEqual([
      'articleRow.addStar', 'articleRow.addReadLater', 'articleRow.markRead',
    ]);
  });

  // La sélection de l'article se fait désormais DANS `onOpenSource`, appelée
  // explicitement ; le clic, lui, ne doit toujours pas remonter jusqu'à la
  // ligne — c'est ce chemin-là que le test garde.
  it('le clic sur « ouvrir à la source » appelle onOpenSource, sans déclencher onSelect par propagation', () => {
    const onSelect = vi.fn();
    // Le gestionnaire réel d'`ArticleList` commence par `e.stopPropagation()` ;
    // le test reproduit ce point d'appel, sinon il ne prouverait rien de ce que
    // l'application fait vraiment.
    const onOpenSource = vi.fn((e: { stopPropagation: () => void }) => e.stopPropagation());
    const { container } = renderCompact({}, { onSelect, onOpenSource });
    const actions = actionsOf(container);
    const link = actions?.children[2] as HTMLElement;
    fireEvent.click(link);
    expect(onOpenSource).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  // Issue #21 : un lien, pas un bouton — les extensions de prévisualisation,
  // « copier l'adresse du lien » et le clic molette natif lisent le `href`.
  it('« ouvrir à la source » est un lien qui porte l’URL de l’article (issue #21)', () => {
    const { container } = renderCompact();
    const link = actionsOf(container)?.children[2] as HTMLAnchorElement;
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('https://example.com/1');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('le clic sur le lien neutralise la navigation native : l’ouverture reste celle d’onOpenSource, une seule fois', () => {
    const onOpenSource = vi.fn((e: { stopPropagation: () => void }) => e.stopPropagation());
    const { container } = renderCompact({}, { onOpenSource });
    const link = actionsOf(container)?.children[2] as HTMLAnchorElement;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(ev);
    expect(onOpenSource).toHaveBeenCalledOnce();
    expect(ev.defaultPrevented).toBe(true);
  });
});
