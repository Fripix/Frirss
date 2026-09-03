// @vitest-environment jsdom
//
// Garde-fou du clignotement du corps d'article.
//
// Le symptôme (PWA iOS, flux à extraction automatique) : en faisant défiler un
// article, les images disparaissaient et revenaient une trentaine de fois par
// seconde. La cause n'était ni un état qui oscille ni une chaîne qui dérive :
// `dangerouslySetInnerHTML={{ __html: … }}` écrivait un objet NEUF à chaque
// rendu, et React 19 réaffecte `innerHTML` sur simple changement d'identité de
// la prop, sans comparer `__html`. Chaque événement de défilement posait
// `readProgress`, donc un rendu, donc un corps entièrement reconstruit — et
// chaque <img> recréée redevient blanche le temps de recharger.
//
// Ce test surveille le DOM, pas l'implémentation : il exige qu'un défilement
// ne remplace ni le nœud <img> du corps ni son contenu.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import type { Article } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'fr' } }),
}));
vi.mock('../../api/feeds', () => ({
  getSubscriptionList: vi.fn(), getUnreadCounts: vi.fn(), getStreamContents: vi.fn(),
  getStarredItems: vi.fn(), markAsRead: vi.fn(() => Promise.resolve()),
  markAsUnread: vi.fn(() => Promise.resolve()), markAsStarred: vi.fn(() => Promise.resolve()),
  removeStarred: vi.fn(() => Promise.resolve()), markAllAsRead: vi.fn(() => Promise.resolve()),
  searchItems: vi.fn(), subscribeFeed: vi.fn(), editFeed: vi.fn(), unsubscribeFeed: vi.fn(),
  getTagList: vi.fn(), getStreamItemCount: vi.fn(), setArticleLabel: vi.fn(),
  renameTag: vi.fn(), deleteTag: vi.fn(), clearWriteToken: vi.fn(),
}));
vi.mock('../../api/backend', () => ({ startActualize: vi.fn(), getActualizeStatus: vi.fn() }));
vi.mock('../../lib/offlineStore', () => ({
  listGet: vi.fn(() => Promise.resolve(undefined)), listPut: vi.fn(() => Promise.resolve()),
  listEvictOlderThan: vi.fn(() => Promise.resolve()), subsGet: vi.fn(() => Promise.resolve(undefined)),
  subsPut: vi.fn(() => Promise.resolve()), queueGet: vi.fn(() => Promise.resolve([])),
  queuePut: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../lib/extractStore', () => ({
  dbGet: vi.fn(() => Promise.resolve(undefined)), dbPut: vi.fn(() => Promise.resolve()),
  dbRecent: vi.fn(() => Promise.resolve([])), dbEvictOlderThan: vi.fn(() => Promise.resolve()),
  dbSetPinned: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../i18n', () => ({ default: { t: (k: string) => k } }));

import ReadingPane from './ReadingPane';
import { useFeedStore } from '../../stores/feedStore';
import { useUiStore } from '../../stores/uiStore';
import { putExtract } from '../../lib/extractCache';

const BODY_SELECTOR = '.reading-body-enter';

const article = {
  id: 'a1', title: 'Titre', summary: 's', source: 'Src', sourceId: 'feed/1',
  content: '<p>rss</p><img src="https://example.com/hero.jpg" width="800" height="450">',
  url: 'https://example.com/1', published: Date.now(), read: false, starred: false, labels: [],
} as unknown as Article;

/** Compte les écritures de `innerHTML` sur le corps de l'article. */
function spyOnBodyWrites(): { writes: string[]; restore: () => void } {
  const writes: string[] = [];
  const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')!;
  Object.defineProperty(Element.prototype, 'innerHTML', {
    ...desc,
    set(this: Element, value: string) {
      if (this.classList?.contains('reading-body-enter')) writes.push(value);
      desc.set!.call(this, value);
    },
  });
  return { writes, restore: () => Object.defineProperty(Element.prototype, 'innerHTML', desc) };
}

/** Fait défiler le conteneur et laisse passer l'image d'animation. */
async function scrollTo(el: HTMLElement, top: number): Promise<void> {
  Object.defineProperty(el, 'scrollTop', { value: top, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: 5000, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 800, configurable: true });
  await act(async () => {
    fireEvent.scroll(el);
    await new Promise((r) => setTimeout(r, 32)); // laisser courir requestAnimationFrame
  });
}

afterEach(cleanup);
beforeEach(() => { localStorage.clear(); });

describe('ReadingPane — corps d’article', () => {
  it('ne reconstruit pas le corps quand on fait défiler', async () => {
    await putExtract('a1', {
      title: 'Titre',
      content: '<p>full</p><img src="https://example.com/hero.jpg" width="800" height="450">',
      excerpt: '', byline: '', siteName: '', length: 10,
    });
    useUiStore.setState({ feedSettings: { 'feed/1': { autoExtract: true } } } as never);
    useFeedStore.setState({ selectedArticle: article, articles: [article] } as never);

    const { container } = render(<ReadingPane />);
    await act(async () => { await Promise.resolve(); });

    const scroller = container.querySelector('.nice-scroll') as HTMLElement;
    const firstImg = container.querySelector(`${BODY_SELECTOR} img`);
    expect(firstImg).toBeTruthy();

    const spy = spyOnBodyWrites();
    // Plusieurs positions distinctes : chacune change `readProgress`, donc
    // provoque bien un rendu (un état identique serait ignoré par React et le
    // test ne prouverait rien).
    const widths: string[] = [];
    for (const top of [100, 400, 900, 1500, 2400]) {
      await scrollTo(scroller, top);
      widths.push((container.querySelector('.reading-progress') as HTMLElement)?.style.width);
    }
    spy.restore();

    // Sans ceci, le test passerait pour la mauvaise raison : un défilement qui
    // ne déclencherait AUCUN rendu ne réécrirait évidemment rien. La barre de
    // progression prouve que chaque position a bien produit un rendu.
    expect(new Set(widths).size).toBe(widths.length);
    expect(widths.every((w) => /^\d+%$/.test(w))).toBe(true);

    expect(container.querySelector(`${BODY_SELECTOR} img`)).toBe(firstImg);
    expect(spy.writes).toEqual([]);
  });

  it('écrit le corps une fois quand l’extraction remplace le squelette', async () => {
    // Un AUTRE identifiant : le cache mémoire des extraits vit dans le module
    // et survit d'un test à l'autre — réutiliser « a1 » servirait déjà le corps.
    const fresh = { ...article, id: 'a2' } as Article;
    useUiStore.setState({ feedSettings: { 'feed/1': { autoExtract: true } } } as never);
    useFeedStore.setState({ selectedArticle: fresh, articles: [fresh] } as never);

    const { container } = render(<ReadingPane />);
    await act(async () => { await Promise.resolve(); });
    // Pas d'extrait : le squelette tient la place, pas le corps.
    expect(container.querySelector('.reading-skeleton')).toBeTruthy();

    // L'extraction arrive (le bouton « contenu complet » sert de déclencheur
    // synchrone : le cache mémoire répond sans réseau).
    await putExtract('a2', {
      title: 'Titre', content: '<p>full</p><img src="https://example.com/hero.jpg">',
      excerpt: '', byline: '', siteName: '', length: 10,
    });
    const btn = container.querySelector('[title="readingPane.fullContent"]') as HTMLElement;
    await act(async () => { fireEvent.click(btn); await Promise.resolve(); });

    const img = container.querySelector(`${BODY_SELECTOR} img`);
    expect(img).toBeTruthy();
    expect(container.querySelector('.reading-skeleton')).toBeNull();

    // …et le défilement qui suit ne le reconstruit toujours pas.
    const spy = spyOnBodyWrites();
    const scroller = container.querySelector('.nice-scroll') as HTMLElement;
    for (const top of [200, 800]) await scrollTo(scroller, top);
    spy.restore();
    expect(container.querySelector(`${BODY_SELECTOR} img`)).toBe(img);
    expect(spy.writes).toEqual([]);
  });
});
