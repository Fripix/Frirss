// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ArticleRow } from './ArticleList';
import ArticleCard from './ArticleCard';
import { DEFAULT_ROW_ACTIONS } from '../../lib/rowActions';
import type { Article } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

afterEach(cleanup);

/**
 * Une ligne de résultat doit dire pourquoi elle est là.
 *
 * La recherche fouille le corps entier : sur « docker », 30 lignes sur 50 ne
 * montraient le mot nulle part, ni dans le titre ni dans le résumé. La liste
 * passait pour une liste non filtrée — c'est le défaut signalé le 2026-09-26.
 */
const base: Article = {
  id: 'a1', title: 'Mon serveur maison', summary: 'Retour d’expérience après un an',
  source: 'r/selfhosted', content: '<p>Tout tourne sous docker compose depuis le début</p>',
  url: 'https://example.com/1', published: Date.now(), read: false, starred: false, labels: [],
} as unknown as Article;

const noop = () => {};

function renderRow(over: Partial<Article> = {}, searchTerms?: string[]) {
  return render(
    <ArticleRow
      article={{ ...base, ...over }}
      viewMode="preview"
      showSource
      rowActions={DEFAULT_ROW_ACTIONS}
      active={false}
      searchTerms={searchTerms}
      onSelect={noop}
      onToggleStar={noop}
      onToggleRead={noop}
      onToggleReadLater={noop}
      onOpenSource={noop}
    />
  );
}

describe('ArticleRow pendant une recherche', () => {
  it('surligne le terme dans le titre', () => {
    const { container } = renderRow({ title: 'Docker en production' }, ['docker']);
    const marks = [...container.querySelectorAll('mark')].map((m) => m.textContent);
    expect(marks).toContain('Docker');
  });

  it('remplace le résumé par l’extrait du corps quand le terme n’y figure pas', () => {
    const { container } = renderRow({}, ['docker']);
    expect(container.textContent).toContain('docker compose');
    expect(container.textContent).not.toContain('Retour d’expérience après un an');
  });

  it('garde le résumé et ne surligne rien hors recherche', () => {
    const { container } = renderRow();
    expect(container.querySelector('mark')).toBeNull();
    expect(container.textContent).toContain('Retour d’expérience après un an');
  });
});

describe('ArticleCard pendant une recherche', () => {
  it('surligne le terme et montre l’extrait qui l’a fait sortir', () => {
    const { container } = render(
      <ArticleCard article={base} showSource rowActions={DEFAULT_ROW_ACTIONS} active={false}
        searchTerms={['docker']}
        onSelect={noop} onToggleStar={noop} onToggleRead={noop} onToggleReadLater={noop} onOpenSource={noop} />
    );
    expect(container.textContent).toContain('docker compose');
    expect([...container.querySelectorAll('mark')].map((m) => m.textContent)).toContain('docker');
  });
});
