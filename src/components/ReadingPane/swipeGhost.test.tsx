// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fillSwipeGhost, removeSwipeGhost, type GhostOptions } from './swipeGhost';
import { useUiStore } from '../../stores/uiStore';
import type { Article } from '../../types';
import type { AiProviderView } from '../../api/backend';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'fr' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => 'mobile' }));

// Le fantôme du balayage montrait autre chose que le rendu (iPhone, 2026-11-24) :
// texte arabe calé à gauche puis à droite à la fin du geste, boîte « Résumé IA »
// qui surgissait, article qui sautait dans la colonne limitée. Chaque test
// échouait sur le fantôme d'avant (`blockDir: false`, ni boîte ni colonne).

const adj = {
  id: 'a2', title: 'عنوان المقال', summary: '', source: 'عالم التقنية', author: '',
  content: '<p>هذا نص عربي طويل للاختبار.</p><p>Second paragraph.</p>',
  url: 'https://example.com/2', published: 1_700_000_000_000, read: false, starred: false, labels: [], tags: [],
} as unknown as Article;

const providers: AiProviderView[] = [
  { id: 1, name: 'Claude', type: 'anthropic', hasAdminKey: true, shared: true, hasUserKey: false, available: true },
];

const base: GhostOptions = {
  autoExtract: false, extractedHtml: null, columnWidth: null, ai: null,
  t: (k) => k, skeletonHtml: '<div class="reading-skeleton"></div>',
};

function ghost(o: Partial<GhostOptions> = {}): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'swipe-ghost';
  document.body.appendChild(el);
  fillSwipeGhost(el, adj, { ...base, ...o });
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
  useUiStore.setState({ aiPanelCollapsed: false });
});

describe('fantôme du balayage — même rendu que l’article', () => {
  it('donne à chaque bloc, au titre et au corps leur sens de lecture', () => {
    const el = ghost();
    expect(el.querySelector('h1')?.getAttribute('dir')).toBe('auto');
    expect(el.querySelector('.article-content')?.getAttribute('dir')).toBe('auto');
    const paragraphs = [...el.querySelectorAll('.article-content p')];
    expect(paragraphs.length).toBe(2);
    for (const p of paragraphs) expect(p.getAttribute('dir')).toBe('auto');
  });

  it('prend la colonne limitée de l’appareil, avec sa largeur', () => {
    const inner = ghost({ columnWidth: 480 }).firstElementChild as HTMLElement;
    expect(inner.classList.contains('reading-column-limited')).toBe(true);
    expect(inner.style.getPropertyValue('--reading-column-width')).toBe('480px');
  });

  it('reste en pleine largeur sans colonne limitée', () => {
    const inner = ghost().firstElementChild as HTMLElement;
    expect(inner.classList.contains('reading-column-limited')).toBe(false);
    expect(inner.style.getPropertyValue('--reading-column-width')).toBe('');
  });

  it('a les mêmes marges que l’article (tablette : md:px-8, et non px-4 seul)', () => {
    const inner = ghost().firstElementChild as HTMLElement;
    for (const c of ['px-4', 'py-4', 'md:px-8', 'md:py-6', 'lg:px-12', 'lg:py-8']) expect(inner.classList.contains(c)).toBe(true);
  });

  it('montre la boîte « Résumé IA » quand le rendu l’affichera, avant le corps', () => {
    const el = ghost({ ai: { providers, targetLang: 'fr', loading: false } });
    const box = el.querySelector('.ai-summary');
    expect(box).toBeTruthy();
    expect(box!.textContent).toContain('ai.summarize');
    const body = el.querySelector('.article-content')!;
    expect(box!.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('n’a pas de boîte quand le rendu n’en aura pas', () => {
    expect(ghost().querySelector('.ai-summary')).toBeNull();
    expect(ghost().querySelector('[data-ghost-ai]')).toBeNull();
  });

  it('est inerte : ses boutons ne prennent ni le focus ni les clics', () => {
    const el = ghost({ ai: { providers, targetLang: 'fr', loading: false } });
    expect(el.inert).toBe(true);
  });

  it('se retire en démontant la boîte, sans erreur, même deux fois', () => {
    const el = ghost({ ai: { providers, targetLang: 'fr', loading: true } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    removeSwipeGhost(el);
    removeSwipeGhost(el);
    removeSwipeGhost(null);
    expect(el.isConnected).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
